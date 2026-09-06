const EXACT_BANNED = new Set([
  "tesseract.js",
  "pdfjs-dist",
  "pdf-parse",
  "@google-cloud/vision",
]);

const SEGMENT_BANNED = /(^|[/@_-])(ocr|vision)($|[/@_-])/i;

export const isForbiddenDependencyName = (name: string): boolean =>
  EXACT_BANNED.has(name.toLowerCase()) || SEGMENT_BANNED.test(name);

const packageNameFromLockKey = (key: string): string => {
  if (!key.includes("@")) return key;
  if (key.startsWith("@")) {
    const slash = key.indexOf("/");
    const versionMarker = key.indexOf("@", slash);
    return versionMarker > 0 ? key.slice(0, versionMarker) : key;
  }
  return key.split("@")[0] ?? key;
};

const dependencyNamesFromManifest = (
  manifest: Record<string, unknown>,
): string[] => {
  const sections = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ];
  return sections.flatMap((section) => {
    const value = manifest[section];
    return value && typeof value === "object" ? Object.keys(value) : [];
  });
};

export const forbiddenDependencyNames = (
  manifest: Record<string, unknown>,
  lockfile: Record<string, unknown>,
): string[] => {
  const lockPackages = lockfile.packages;
  const lockNames =
    lockPackages && typeof lockPackages === "object"
      ? Object.keys(lockPackages).map(packageNameFromLockKey)
      : [];
  return [...new Set([...dependencyNamesFromManifest(manifest), ...lockNames])]
    .filter(isForbiddenDependencyName)
    .sort();
};

export const forbiddenDependencyNamesFromLockText = (
  manifest: Record<string, unknown>,
  lockText: string,
): string[] => {
  const lockNames = Array.from(lockText.matchAll(/"([^"]+)":/g), ([, key]) =>
    packageNameFromLockKey(key ?? ""),
  );
  return [...new Set([...dependencyNamesFromManifest(manifest), ...lockNames])]
    .filter(isForbiddenDependencyName)
    .sort();
};

if (import.meta.main) {
  const root = process.argv[2] ?? ".";
  const manifest = (await Bun.file(`${root}/package.json`).json()) as Record<
    string,
    unknown
  >;
  const lockText = await Bun.file(`${root}/bun.lock`).text();
  const forbidden = forbiddenDependencyNamesFromLockText(manifest, lockText);
  if (forbidden.length > 0) {
    console.error(
      `Forbidden document-reading dependencies found: ${forbidden.join(", ")}`,
    );
    process.exit(1);
  }
  console.log("No forbidden document-reading dependencies found.");
}
