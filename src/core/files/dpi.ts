/**
 * Print resolution (DPI), read from and written to an image's own header.
 *
 * ## Why this exists
 *
 * Forms ask for "300 DPI" all the time, and a canvas cannot answer. Anything
 * `canvas.toBlob` produces carries no density header at all, so a perfectly
 * sized 413 × 531 photo is still rejected by a portal that checks resolution.
 * DPI is *metadata*, not a property of the pixels: the same bitmap is 300 DPI
 * or 72 DPI depending on a handful of header bytes. So the fix is to write
 * those bytes.
 *
 * It is also a hard prerequisite for physical units. "35 mm" is only a number
 * of pixels at some resolution — see `./units.ts`.
 *
 * ## Why this is hand-rolled
 *
 * The npm options are unmaintained, string-encoded or Node-`Buffer`-based, and
 * would need polyfilling under this extension's CSP. What is actually needed
 * here is about 250 lines of `Uint8Array` arithmetic with no dependencies, and
 * it stays reviewable. `scripts/check-forbidden-deps.ts` would not have
 * blocked such a package — this is a judgement call, recorded in
 * `docs/adr/008-image-metadata-writing.md` along with why reading a density
 * header does not cross the line ADR 005 draws around file *content*.
 *
 * ## The safety rule
 *
 * **Every function here is non-destructive.** `writeImageDensity` returns its
 * input unchanged on any parse doubt rather than guessing, every offset is
 * bounds-checked before it is read, and a malformed file yields `undefined`
 * instead of throwing. This module only ever runs against a derived copy; the
 * user's original is never patched.
 */

export interface ImageDensity {
  readonly x: number;
  readonly y: number;
  readonly source: "jfif" | "exif" | "phys";
}

const JPEG_SOI = [0xff, 0xd8] as const;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const INCHES_PER_METRE = 39.37007874015748;
const INCHES_PER_CM = 2.54;

/** JFIF's `units` byte. 0 means "aspect ratio only", i.e. no real density. */
const JFIF_UNIT_INCH = 1;
const JFIF_UNIT_CM = 2;

/** EXIF `ResolutionUnit`. 1 means "none", which carries no usable density. */
const EXIF_UNIT_INCH = 2;
const EXIF_UNIT_CM = 3;

const TAG_X_RESOLUTION = 0x011a;
const TAG_Y_RESOLUTION = 0x011b;
const TAG_RESOLUTION_UNIT = 0x0128;

const startsWith = (
  bytes: Uint8Array,
  prefix: readonly number[],
  offset = 0,
): boolean => {
  if (bytes.length < offset + prefix.length) return false;
  return prefix.every((byte, index) => bytes[offset + index] === byte);
};

const readU16 = (
  bytes: Uint8Array,
  offset: number,
  littleEndian = false,
): number | undefined => {
  if (offset < 0 || offset + 2 > bytes.length) return undefined;
  const a = bytes[offset] as number;
  const b = bytes[offset + 1] as number;
  return littleEndian ? a | (b << 8) : (a << 8) | b;
};

const readU32 = (
  bytes: Uint8Array,
  offset: number,
  littleEndian = false,
): number | undefined => {
  if (offset < 0 || offset + 4 > bytes.length) return undefined;
  const a = bytes[offset] as number;
  const b = bytes[offset + 1] as number;
  const c = bytes[offset + 2] as number;
  const d = bytes[offset + 3] as number;
  return (
    (littleEndian
      ? a | (b << 8) | (c << 16) | (d << 24)
      : (a << 24) | (b << 16) | (c << 8) | d) >>> 0
  );
};

const writeU16 = (bytes: Uint8Array, offset: number, value: number): void => {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
};

const writeU32 = (bytes: Uint8Array, offset: number, value: number): void => {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
};

const isUsableDpi = (value: number): boolean =>
  Number.isFinite(value) && value > 0 && value <= 100_000;

// ---------------------------------------------------------------------------
// Format detection — from magic bytes, never from a declared MIME type, which
// is routinely wrong for files a user picked off disk.
// ---------------------------------------------------------------------------

type ImageFormat = "jpeg" | "png" | "webp" | "unknown";

export const detectImageFormat = (bytes: Uint8Array): ImageFormat => {
  if (startsWith(bytes, JPEG_SOI) && bytes.length > 3) return "jpeg";
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (
    bytes.length >= 12 &&
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "webp";
  }
  return "unknown";
};

/**
 * WebP is read-only here. A WebP file has no native density field — DPI could
 * only ride in an optional `EXIF ` chunk, and adding one to a simple-format
 * file means rewriting the whole container into extended (VP8X) form. That is
 * a lot of risk for a format no portal demands at a given DPI. Callers should
 * steer the user to JPEG or PNG when they need a DPI.
 */
export const canWriteImageDensity = (mimeType: string): boolean =>
  mimeType === "image/jpeg" || mimeType === "image/png";

// ---------------------------------------------------------------------------
// CRC32 — needed because a PNG chunk carries its own checksum, and a chunk
// with a stale CRC makes the file invalid rather than merely wrong.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

interface JpegSegment {
  readonly marker: number;
  /** Offset of the 0xFF that opens the segment. */
  readonly start: number;
  /** Offset of the first payload byte, after the 2-byte length. */
  readonly payload: number;
  /** Payload length, excluding the 2 length bytes themselves. */
  readonly payloadLength: number;
}

/**
 * Walks the marker segments between SOI and the start of scan data. Stops at
 * SOS (0xDA), because everything past it is entropy-coded and must not be
 * scanned for markers.
 */
const jpegSegments = (bytes: Uint8Array): readonly JpegSegment[] => {
  const segments: JpegSegment[] = [];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1] as number;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) break;
    // Standalone markers (RSTn, TEM) carry no length.
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }
    const length = readU16(bytes, offset + 2);
    if (length === undefined || length < 2) break;
    if (offset + 2 + length > bytes.length) break;
    segments.push({
      marker,
      start: offset,
      payload: offset + 4,
      payloadLength: length - 2,
    });
    offset += 2 + length;
  }
  return segments;
};

const findJfif = (
  bytes: Uint8Array,
  segments: readonly JpegSegment[],
): JpegSegment | undefined =>
  segments.find(
    (segment) =>
      segment.marker === 0xe0 &&
      segment.payloadLength >= 12 &&
      startsWith(bytes, [0x4a, 0x46, 0x49, 0x46, 0x00], segment.payload),
  );

const readJfifDensity = (
  bytes: Uint8Array,
  segment: JpegSegment,
): ImageDensity | undefined => {
  const units = bytes[segment.payload + 7];
  const x = readU16(bytes, segment.payload + 8);
  const y = readU16(bytes, segment.payload + 10);
  if (units === undefined || x === undefined || y === undefined)
    return undefined;
  // units 0 means the values are an aspect ratio, not a resolution.
  if (units !== JFIF_UNIT_INCH && units !== JFIF_UNIT_CM) return undefined;
  const scale = units === JFIF_UNIT_CM ? INCHES_PER_CM : 1;
  const dpiX = x * scale;
  const dpiY = y * scale;
  if (!isUsableDpi(dpiX) || !isUsableDpi(dpiY)) return undefined;
  return { x: dpiX, y: dpiY, source: "jfif" };
};

const findExif = (
  bytes: Uint8Array,
  segments: readonly JpegSegment[],
): JpegSegment | undefined =>
  segments.find(
    (segment) =>
      segment.marker === 0xe1 &&
      segment.payloadLength >= 8 &&
      startsWith(bytes, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00], segment.payload),
  );

interface TiffEntry {
  readonly tag: number;
  readonly type: number;
  readonly count: number;
  /** Offset of the entry's 4-byte value/offset field. */
  readonly valueFieldOffset: number;
}

interface TiffContext {
  readonly tiffStart: number;
  readonly littleEndian: boolean;
  readonly entries: readonly TiffEntry[];
}

/** Parses IFD0 of a TIFF header. Returns undefined on anything malformed. */
const readTiffIfd0 = (
  bytes: Uint8Array,
  tiffStart: number,
): TiffContext | undefined => {
  const order = readU16(bytes, tiffStart);
  if (order === undefined) return undefined;
  const littleEndian = order === 0x4949;
  if (!littleEndian && order !== 0x4d4d) return undefined;

  if (readU16(bytes, tiffStart + 2, littleEndian) !== 42) return undefined;

  const ifdOffset = readU32(bytes, tiffStart + 4, littleEndian);
  if (ifdOffset === undefined) return undefined;

  const ifdStart = tiffStart + ifdOffset;
  const count = readU16(bytes, ifdStart, littleEndian);
  if (count === undefined || count > 512) return undefined;
  if (ifdStart + 2 + count * 12 > bytes.length) return undefined;

  const entries: TiffEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const entryOffset = ifdStart + 2 + index * 12;
    const tag = readU16(bytes, entryOffset, littleEndian);
    const type = readU16(bytes, entryOffset + 2, littleEndian);
    const valueCount = readU32(bytes, entryOffset + 4, littleEndian);
    if (tag === undefined || type === undefined || valueCount === undefined) {
      return undefined;
    }
    entries.push({
      tag,
      type,
      count: valueCount,
      valueFieldOffset: entryOffset + 8,
    });
  }
  return { tiffStart, littleEndian, entries };
};

/** Resolves a RATIONAL tag to a number, bounds-checking the indirection. */
const readRational = (
  bytes: Uint8Array,
  context: TiffContext,
  entry: TiffEntry,
): number | undefined => {
  if (entry.type !== 5) return undefined;
  const pointer = readU32(bytes, entry.valueFieldOffset, context.littleEndian);
  if (pointer === undefined) return undefined;
  const at = context.tiffStart + pointer;
  const numerator = readU32(bytes, at, context.littleEndian);
  const denominator = readU32(bytes, at + 4, context.littleEndian);
  if (numerator === undefined || denominator === undefined) return undefined;
  if (denominator === 0) return undefined;
  return numerator / denominator;
};

const readExifDensity = (
  bytes: Uint8Array,
  segment: JpegSegment,
): ImageDensity | undefined => {
  const context = readTiffIfd0(bytes, segment.payload + 6);
  if (!context) return undefined;

  const unitEntry = context.entries.find(
    (entry) => entry.tag === TAG_RESOLUTION_UNIT,
  );
  const unit =
    unitEntry && unitEntry.type === 3
      ? readU16(bytes, unitEntry.valueFieldOffset, context.littleEndian)
      : undefined;
  if (unit !== EXIF_UNIT_INCH && unit !== EXIF_UNIT_CM) return undefined;

  const xEntry = context.entries.find(
    (entry) => entry.tag === TAG_X_RESOLUTION,
  );
  const yEntry = context.entries.find(
    (entry) => entry.tag === TAG_Y_RESOLUTION,
  );
  if (!xEntry || !yEntry) return undefined;

  const rawX = readRational(bytes, context, xEntry);
  const rawY = readRational(bytes, context, yEntry);
  if (rawX === undefined || rawY === undefined) return undefined;

  const scale = unit === EXIF_UNIT_CM ? INCHES_PER_CM : 1;
  const x = rawX * scale;
  const y = rawY * scale;
  if (!isUsableDpi(x) || !isUsableDpi(y)) return undefined;
  return { x, y, source: "exif" };
};

/**
 * Patches existing XResolution/YResolution rationals in place, and only those.
 * Inserting new tags would mean rebuilding the IFD and rewriting every offset
 * after it, which is exactly where this kind of code corrupts files. If the
 * tags are absent, JFIF carries the value instead.
 */
const patchExifDensity = (
  bytes: Uint8Array,
  segment: JpegSegment,
  dpi: number,
): void => {
  const context = readTiffIfd0(bytes, segment.payload + 6);
  if (!context) return;

  const unitEntry = context.entries.find(
    (entry) => entry.tag === TAG_RESOLUTION_UNIT,
  );
  if (unitEntry?.type !== 3) return;

  for (const tag of [TAG_X_RESOLUTION, TAG_Y_RESOLUTION]) {
    const entry = context.entries.find((candidate) => candidate.tag === tag);
    if (entry?.type !== 5) continue;
    const pointer = readU32(
      bytes,
      entry.valueFieldOffset,
      context.littleEndian,
    );
    if (pointer === undefined) continue;
    const at = context.tiffStart + pointer;
    if (at + 8 > bytes.length) continue;
    if (context.littleEndian) {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      view.setUint32(at, Math.round(dpi), true);
      view.setUint32(at + 4, 1, true);
    } else {
      writeU32(bytes, at, Math.round(dpi));
      writeU32(bytes, at + 4, 1);
    }
  }

  // Normalise the unit to inches so the patched numerator reads as DPI.
  if (context.littleEndian) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint16(unitEntry.valueFieldOffset, EXIF_UNIT_INCH, true);
  } else {
    writeU16(bytes, unitEntry.valueFieldOffset, EXIF_UNIT_INCH);
  }
};

const buildJfifSegment = (dpi: number): Uint8Array => {
  const segment = new Uint8Array(18);
  segment[0] = 0xff;
  segment[1] = 0xe0;
  writeU16(segment, 2, 16); // length, including these two bytes
  segment.set([0x4a, 0x46, 0x49, 0x46, 0x00], 4); // "JFIF\0"
  segment[9] = 1; // version major
  segment[10] = 1; // version minor
  segment[11] = JFIF_UNIT_INCH;
  writeU16(segment, 12, Math.round(dpi));
  writeU16(segment, 14, Math.round(dpi));
  segment[16] = 0; // thumbnail width
  segment[17] = 0; // thumbnail height
  return segment;
};

const writeJpegDensity = (bytes: Uint8Array, dpi: number): Uint8Array => {
  const segments = jpegSegments(bytes);
  const jfif = findJfif(bytes, segments);

  if (jfif) {
    const patched = new Uint8Array(bytes);
    patched[jfif.payload + 7] = JFIF_UNIT_INCH;
    writeU16(patched, jfif.payload + 8, Math.round(dpi));
    writeU16(patched, jfif.payload + 10, Math.round(dpi));
    const exif = findExif(patched, jpegSegments(patched));
    if (exif) patchExifDensity(patched, exif, dpi);
    return patched;
  }

  // No JFIF APP0 — the common case for canvas output. Insert one directly
  // after SOI, which is where the spec requires it.
  const segment = buildJfifSegment(dpi);
  const result = new Uint8Array(bytes.length + segment.length);
  result.set(bytes.subarray(0, 2), 0);
  result.set(segment, 2);
  result.set(bytes.subarray(2), 2 + segment.length);
  const exif = findExif(result, jpegSegments(result));
  if (exif) patchExifDensity(result, exif, dpi);
  return result;
};

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

interface PngChunk {
  readonly type: string;
  /** Offset of the 4-byte length field. */
  readonly start: number;
  readonly dataStart: number;
  readonly dataLength: number;
  /** Total bytes: 4 length + 4 type + data + 4 CRC. */
  readonly totalLength: number;
}

const pngChunks = (bytes: Uint8Array): readonly PngChunk[] => {
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    if (length === undefined || length > bytes.length) break;
    const type = String.fromCharCode(
      bytes[offset + 4] as number,
      bytes[offset + 5] as number,
      bytes[offset + 6] as number,
      bytes[offset + 7] as number,
    );
    const totalLength = 12 + length;
    if (offset + totalLength > bytes.length) break;
    chunks.push({
      type,
      start: offset,
      dataStart: offset + 8,
      dataLength: length,
      totalLength,
    });
    if (type === "IEND") break;
    offset += totalLength;
  }
  return chunks;
};

const readPhysDensity = (
  bytes: Uint8Array,
  chunk: PngChunk,
): ImageDensity | undefined => {
  if (chunk.dataLength !== 9) return undefined;
  const x = readU32(bytes, chunk.dataStart);
  const y = readU32(bytes, chunk.dataStart + 4);
  const unit = bytes[chunk.dataStart + 8];
  if (x === undefined || y === undefined) return undefined;
  // unit 0 means "unknown", i.e. an aspect ratio rather than a resolution.
  if (unit !== 1) return undefined;
  const dpiX = x / INCHES_PER_METRE;
  const dpiY = y / INCHES_PER_METRE;
  if (!isUsableDpi(dpiX) || !isUsableDpi(dpiY)) return undefined;
  return { x: dpiX, y: dpiY, source: "phys" };
};

const buildPhysChunk = (dpi: number): Uint8Array => {
  const chunk = new Uint8Array(21);
  writeU32(chunk, 0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  const perMetre = Math.round(dpi * INCHES_PER_METRE);
  writeU32(chunk, 8, perMetre);
  writeU32(chunk, 12, perMetre);
  chunk[16] = 1; // unit: metre
  // The CRC covers the type and data — 13 bytes — not the length field.
  writeU32(chunk, 17, crc32(chunk.subarray(4, 17)));
  return chunk;
};

const writePngDensity = (bytes: Uint8Array, dpi: number): Uint8Array => {
  const chunks = pngChunks(bytes);
  if (chunks.length === 0) return bytes;

  const existing = chunks.find((chunk) => chunk.type === "pHYs");
  if (existing && existing.dataLength === 9) {
    const patched = new Uint8Array(bytes);
    const perMetre = Math.round(dpi * INCHES_PER_METRE);
    writeU32(patched, existing.dataStart, perMetre);
    writeU32(patched, existing.dataStart + 4, perMetre);
    patched[existing.dataStart + 8] = 1;
    writeU32(
      patched,
      existing.dataStart + 9,
      crc32(patched.subarray(existing.start + 4, existing.dataStart + 9)),
    );
    return patched;
  }

  // pHYs must appear before the first IDAT.
  const firstIdat = chunks.find((chunk) => chunk.type === "IDAT");
  const anchor = firstIdat ?? chunks.find((chunk) => chunk.type === "IEND");
  if (!anchor) return bytes;

  const chunk = buildPhysChunk(dpi);
  const result = new Uint8Array(bytes.length + chunk.length);
  result.set(bytes.subarray(0, anchor.start), 0);
  result.set(chunk, anchor.start);
  result.set(bytes.subarray(anchor.start), anchor.start + chunk.length);
  return result;
};

// ---------------------------------------------------------------------------
// WebP — reading only, via an EXIF chunk if the container happens to have one.
// ---------------------------------------------------------------------------

const readWebpDensity = (bytes: Uint8Array): ImageDensity | undefined => {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(
      bytes[offset] as number,
      bytes[offset + 1] as number,
      bytes[offset + 2] as number,
      bytes[offset + 3] as number,
    );
    const size = readU32(bytes, offset + 4, true);
    if (size === undefined) return undefined;
    if (type === "EXIF") {
      const tiffStart = offset + 8;
      if (tiffStart >= bytes.length) return undefined;
      const context = readTiffIfd0(bytes, tiffStart);
      if (!context) return undefined;
      // Reuse the JPEG path by describing the chunk as an APP1 payload: the
      // TIFF block is identical, only its container differs.
      return readExifDensity(bytes, {
        marker: 0xe1,
        start: offset,
        payload: tiffStart - 6,
        payloadLength: size + 6,
      });
    }
    // RIFF chunks are padded to an even length.
    offset += 8 + size + (size % 2);
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Reads the declared print resolution, preferring EXIF over JFIF when both are
 * present and valid — that matches what image tools and portals report.
 * Returns `undefined` when the file declares none, which is the normal case
 * for anything a canvas produced.
 */
export const readImageDensity = (
  bytes: Uint8Array,
): ImageDensity | undefined => {
  try {
    switch (detectImageFormat(bytes)) {
      case "jpeg": {
        const segments = jpegSegments(bytes);
        const exif = findExif(bytes, segments);
        const fromExif = exif ? readExifDensity(bytes, exif) : undefined;
        if (fromExif) return fromExif;
        const jfif = findJfif(bytes, segments);
        return jfif ? readJfifDensity(bytes, jfif) : undefined;
      }
      case "png": {
        const chunk = pngChunks(bytes).find(
          (candidate) => candidate.type === "pHYs",
        );
        return chunk ? readPhysDensity(bytes, chunk) : undefined;
      }
      case "webp":
        return readWebpDensity(bytes);
      default:
        return undefined;
    }
  } catch {
    // A malformed file is data, not an exception. Callers treat "no density"
    // and "unreadable density" identically.
    return undefined;
  }
};

/**
 * Returns a copy carrying `dpi`, or the input **unchanged** when the format
 * cannot hold one or anything about the parse looks wrong. Never throws.
 *
 * The result may be longer than the input — by 18 bytes when a JFIF segment is
 * inserted, 21 when a `pHYs` chunk is — so a caller enforcing a byte ceiling
 * must re-check the size after calling this.
 */
export const writeImageDensity = (
  bytes: Uint8Array,
  dpi: number,
): Uint8Array => {
  if (!isUsableDpi(dpi)) return bytes;
  try {
    switch (detectImageFormat(bytes)) {
      case "jpeg":
        return writeJpegDensity(bytes, dpi);
      case "png":
        return writePngDensity(bytes, dpi);
      default:
        return bytes;
    }
  } catch {
    return bytes;
  }
};
