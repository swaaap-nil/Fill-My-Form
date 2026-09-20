import { describe, expect, it } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { PDFDocument } from "pdf-lib";
import { createIndexedDbFileReferenceStore } from "~/lib/files/adapters";
import { PdfPreparationAdapter } from "~/lib/files/pdf-preparation-adapter";

describe("temporary file artifacts", () => {
  it("retrieves a derived artifact as a File without changing the original", async () => {
    const store = await createIndexedDbFileReferenceStore(new IDBFactory());
    const original = new File(["original-bytes"], "photo.png", {
      type: "image/png",
    });
    const originalRef = await store.save(original);
    const derivedRef = await store.saveDerived(
      new File(["prepared-bytes"], "photo.jpg", { type: "image/jpeg" }),
      originalRef,
    );

    const derived = await store.getFile(derivedRef.id);
    expect(derived?.name).toBe("photo.jpg");
    expect(derived?.type).toBe("image/jpeg");
    expect(await derived?.text()).toBe("prepared-bytes");
    expect(await (await store.getFile(originalRef.id))?.text()).toBe(
      "original-bytes",
    );
  });

  it("keeps the original immutable and purges expired derived copies", async () => {
    const store = await createIndexedDbFileReferenceStore(new IDBFactory());
    const original = new File(["original-bytes"], "photo.png", {
      type: "image/png",
    });
    const originalRef = await store.save(original, "2026-01-01T00:00:00.000Z");
    const derived = await store.saveDerived(
      new File(["prepared-bytes"], "photo.jpg", { type: "image/jpeg" }),
      originalRef,
      "2026-01-01T00:00:00.000Z",
      60_000,
    );

    expect(derived.artifactKind).toBe("derived");
    expect(derived.derivedFrom).toBe(originalRef.id);
    expect(await (await store.get(originalRef.id))?.blob.text()).toBe(
      "original-bytes",
    );

    expect(await store.purgeExpired("2026-01-01T00:00:59.000Z")).toBe(0);
    expect(await store.purgeExpired("2026-01-01T00:01:01.000Z")).toBe(1);
    expect(await store.get(originalRef.id)).not.toBeNull();
    expect(await store.get(derived.id)).toBeNull();
  });

  it("clears original and derived artifacts for privacy wipes", async () => {
    const store = await createIndexedDbFileReferenceStore(new IDBFactory());
    const originalRef = await store.save(
      new File(["original-bytes"], "photo.png", { type: "image/png" }),
    );
    const derivedRef = await store.saveDerived(
      new File(["prepared-bytes"], "photo.jpg", { type: "image/jpeg" }),
      originalRef,
    );

    await store.clear();

    expect(await store.get(originalRef.id)).toBeNull();
    expect(await store.get(derivedRef.id)).toBeNull();
    expect(await store.list()).toEqual([]);
  });
});

describe("PDF preparation adapter", () => {
  it("creates a page-range copy without changing the original", async () => {
    const store = await createIndexedDbFileReferenceStore(new IDBFactory());
    const source = await PDFDocument.create();
    source.addPage([300, 400]);
    source.addPage([500, 600]);
    const bytes = await source.save();
    const original = new File(
      [new Uint8Array(bytes).buffer as ArrayBuffer],
      "document.pdf",
      { type: "application/pdf" },
    );
    const originalRef = await store.save(original);
    const adapter = new PdfPreparationAdapter(store);
    const result = await adapter.prepare(originalRef, {
      pageRange: { start: 2, end: 2 },
      pageWidth: 612,
      pageHeight: 792,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.inspection.pageCount).toBe(1);
    expect(await (await store.get(originalRef.id))?.blob.arrayBuffer()).toEqual(
      await original.arrayBuffer(),
    );
    const prepared = await PDFDocument.load(
      await result.artifact.blob.arrayBuffer(),
    );
    expect(prepared.getPageCount()).toBe(1);
    expect(prepared.getPage(0).getWidth()).toBe(612);
    expect(prepared.getPage(0).getHeight()).toBe(792);
  });

  it("passes through a PDF that already satisfies the upload constraints without re-encoding it", async () => {
    const store = await createIndexedDbFileReferenceStore(new IDBFactory());
    const bytes = "%PDF-1.4\n% uneditable-but-acceptable\n";
    const original = new File([bytes], "resume.pdf", {
      type: "application/pdf",
    });
    const originalRef = await store.save(original);
    const adapter = new PdfPreparationAdapter(store);

    const result = await adapter.prepareForConstraints(originalRef, [
      { kind: "accept", value: [".pdf", "application/pdf"] },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.transformed).toBe(false);
    expect(result.artifact.name).toBe("resume.pdf");
    expect(await result.artifact.blob.text()).toBe(bytes);
    expect(await (await store.get(originalRef.id))?.blob.text()).toBe(bytes);
  });
});
