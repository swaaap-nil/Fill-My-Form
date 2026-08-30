/**
 * Fails the build if anything that looks like a server secret reached the
 * bundle. Only public, client-safe configuration belongs in an extension:
 * everything in `build/` ships to every user who installs it.
 *
 * This is a backstop, not the control. The control is that no code reads a
 * secret in the first place — see `env.config.ts` and docs/privacy.md.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const BUILD_DIR = "build";

const FORBIDDEN: readonly {
  readonly name: string;
  readonly pattern: RegExp;
}[] = [
  { name: "OpenAI key", pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: "Anthropic key", pattern: /\bsk-ant-[A-Za-z0-9-]{20,}\b/ },
  { name: "Stripe secret key", pattern: /\bsk_(live|test)_[A-Za-z0-9]{20,}\b/ },
  { name: "Supabase service role key", pattern: /service_role/ },
  { name: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "Private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

const TEXT_EXTENSIONS = [
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".html",
  ".css",
  ".map",
];

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return TEXT_EXTENSIONS.some((ext) => path.endsWith(ext)) ? [path] : [];
    }),
  );
  return files.flat();
};

const files = await walk(BUILD_DIR).catch(() => {
  console.error(`No ${BUILD_DIR}/ directory. Run \`bun run build\` first.`);
  process.exit(1);
});
const findings: string[] = [];

for (const path of files) {
  const contents = await Bun.file(path).text();
  for (const { name, pattern } of FORBIDDEN) {
    if (pattern.test(contents)) findings.push(`${path}: ${name}`);
  }
}

if (findings.length > 0) {
  console.error("Secret-shaped values found in the extension bundle:");
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(`Scanned ${files.length} bundled files. No secrets found.`);
