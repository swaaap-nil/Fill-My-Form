/**
 * Submit a Firefox add-on version to AMO.
 *
 * `wxt submit` wraps publish-browser-extension, which creates the version as
 * multipart form-data with only `upload` and `source`. A first listed version
 * also needs a license and add-on categories. AMO will not accept a nested
 * `custom_license` object in that same form-data request, so this script
 * sends the predefined slug `all-rights-reserved` alongside `source`, and
 * PATCHes `privacy-security` onto the add-on if categories are missing.
 *
 * See: https://mozilla.github.io/addons-server/topics/api/licenses.html
 */

import { createHmac } from "node:crypto";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };

const AMO_API = "https://addons.mozilla.org/api/v5";
const DEFAULT_LICENSE = "all-rights-reserved";
const POLL_MS = 5_000;
const UPLOAD_TIMEOUT_MS = 10 * 60_000;

export interface FirefoxSubmitConfig {
  readonly extensionId: string;
  readonly jwtIssuer: string;
  readonly jwtSecret: string;
  readonly zip: string;
  readonly sourcesZip: string;
  readonly channel: "listed" | "unlisted";
  readonly license: string;
  readonly categories: readonly string[];
  readonly dryRun: boolean;
}

export const amoJwt = (
  issuer: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
  timeoutInS = 240,
): string => {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: issuer,
      jti: crypto.randomUUID(),
      iat: now,
      exp: now + timeoutInS,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
};

export const defaultArtifactPaths = (
  version = packageJson.version,
): { zip: string; sourcesZip: string } => ({
  zip: `build/${packageJson.name}-${version}-firefox.zip`,
  sourcesZip: `build/${packageJson.name}-${version}-sources.zip`,
});

export const configFromEnv = (
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): FirefoxSubmitConfig => {
  const dryRun = argv.includes("--dry-run");
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const defaults = defaultArtifactPaths();

  return {
    extensionId: requireFrom(env, "FIREFOX_EXTENSION_ID"),
    jwtIssuer: requireFrom(env, "FIREFOX_JWT_ISSUER"),
    jwtSecret: requireFrom(env, "FIREFOX_JWT_SECRET"),
    zip: resolve(positional[0] ?? env.FIREFOX_ZIP ?? defaults.zip),
    sourcesZip: resolve(
      positional[1] ??
        env.FIREFOX_SOURCES_ZIP ??
        env.SOURCES_ZIP ??
        defaults.sourcesZip,
    ),
    channel: env.FIREFOX_CHANNEL === "unlisted" ? "unlisted" : "listed",
    license: env.FIREFOX_LICENSE?.trim() || DEFAULT_LICENSE,
    categories: parseCategories(env.FIREFOX_CATEGORIES),
    dryRun,
  };
};

const DEFAULT_CATEGORIES = ["privacy-security"] as const;

const parseCategories = (value: string | undefined): string[] => {
  const parsed = (value ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...DEFAULT_CATEGORIES];
};

const requireFrom = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
};

export const retryAfterSeconds = (
  response: Response,
  body: unknown,
): number | undefined => {
  const header = response.headers.get("Retry-After");
  if (header && /^\d+$/.test(header.trim())) {
    return Number(header.trim());
  }
  const detail =
    typeof body === "object" &&
    body !== null &&
    "detail" in body &&
    typeof body.detail === "string"
      ? body.detail
      : "";
  const match = detail.match(/available in (\d+) seconds/i);
  return match ? Number(match[1]) : undefined;
};

class AmoError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: unknown,
  ) {
    super(`AMO ${status} ${url}: ${JSON.stringify(body)}`);
    this.name = "AmoError";
  }
}

const authHeader = (config: FirefoxSubmitConfig): string =>
  `JWT ${amoJwt(config.jwtIssuer, config.jwtSecret)}`;

const amoFetch = async <T>(
  config: FirefoxSubmitConfig,
  url: string,
  init: RequestInit = {},
  attempt = 0,
): Promise<T> => {
  const headers = new Headers(init.headers);
  headers.set("Authorization", authHeader(config));
  const isForm = init.body instanceof FormData;
  if (init.body && !isForm && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, { ...init, headers });
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 429 && attempt < 2) {
    const waitS = Math.max(retryAfterSeconds(response, body) ?? 60, 1);
    console.log(`AMO 429; waiting ${waitS}s before retry`);
    await sleep(waitS * 1000);
    return amoFetch(config, url, init, attempt + 1);
  }
  if (!response.ok) {
    throw new AmoError(response.status, url, body);
  }
  return body as T;
};

interface AddonDetails {
  readonly id: number;
  readonly guid: string;
  readonly slug: string;
  readonly categories?: string[] | Record<string, string[]>;
  readonly current_version?: {
    readonly version: string;
    readonly license?: {
      readonly slug?: string | null;
      readonly name?: unknown;
    };
  };
}

interface AddonVersion {
  readonly id: number;
  readonly version: string;
  readonly file?: { readonly id: number };
  readonly license?: { readonly slug?: string | null };
  readonly source?: string | null;
}

interface UploadDetails {
  readonly uuid: string;
  readonly processed: boolean;
  readonly valid: boolean;
  readonly version: string;
  readonly validation?: {
    readonly errors: number;
    readonly warnings: number;
    readonly notices: number;
  };
}

export const hasCategories = (
  categories: AddonDetails["categories"],
): boolean => {
  if (Array.isArray(categories)) return categories.length > 0;
  return Object.values(categories ?? {}).some(
    (slugs) => Array.isArray(slugs) && slugs.length > 0,
  );
};

const ensureListedMetadata = async (
  config: FirefoxSubmitConfig,
  addon: AddonDetails,
): Promise<void> => {
  if (config.channel !== "listed" || hasCategories(addon.categories)) {
    return;
  }

  console.log(`Setting listed categories: ${config.categories.join(", ")}`);
  await amoFetch<AddonDetails>(
    config,
    `${AMO_API}/addons/addon/${config.extensionId}/`,
    {
      method: "PATCH",
      body: JSON.stringify({
        categories: { firefox: [...config.categories] },
      }),
    },
  );
};

const sleep = (ms: number) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const ensureFilesExist = async (config: FirefoxSubmitConfig): Promise<void> => {
  for (const [label, path] of [
    ["firefox zip", config.zip],
    ["sources zip", config.sourcesZip],
  ] as const) {
    try {
      await access(path);
    } catch {
      throw new Error(`Missing ${label}: ${path}`);
    }
  }
};

const uploadAndPoll = async (
  config: FirefoxSubmitConfig,
): Promise<UploadDetails> => {
  const form = new FormData();
  form.set("channel", config.channel);
  form.set("upload", Bun.file(config.zip), "addon.zip");

  let details = await amoFetch<UploadDetails>(
    config,
    `${AMO_API}/addons/upload/`,
    { method: "POST", body: form },
  );

  const deadline = Date.now() + UPLOAD_TIMEOUT_MS;
  while (!details.processed) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for AMO to validate ${details.uuid}`);
    }
    console.log("Waiting for AMO validation…");
    await sleep(POLL_MS);
    details = await amoFetch<UploadDetails>(
      config,
      `${AMO_API}/addons/upload/${details.uuid}/`,
    );
  }

  return details;
};

const createVersion = async (
  config: FirefoxSubmitConfig,
  uploadUuid: string,
): Promise<AddonVersion> => {
  const form = new FormData();
  form.set("upload", uploadUuid);
  form.set("license", config.license);
  form.set("source", Bun.file(config.sourcesZip), "sources.zip");

  return amoFetch<AddonVersion>(
    config,
    `${AMO_API}/addons/addon/${config.extensionId}/versions/`,
    { method: "POST", body: form },
  );
};

export const submitFirefox = async (
  config: FirefoxSubmitConfig,
): Promise<void> => {
  await ensureFilesExist(config);

  console.log(
    `Checking AMO add-on ${config.extensionId} (${config.channel}, license=${config.license})`,
  );
  const addon = await amoFetch<AddonDetails>(
    config,
    `${AMO_API}/addons/addon/${config.extensionId}/`,
  );
  console.log(
    `Found add-on id=${addon.id} slug=${addon.slug} current=${addon.current_version?.version ?? "none"} license=${addon.current_version?.license?.slug ?? "none"}`,
  );

  if (config.dryRun) {
    if (config.channel === "listed" && !hasCategories(addon.categories)) {
      console.log(
        `DRY RUN: would set categories=${config.categories.join(",")}`,
      );
    }
    console.log("DRY RUN: skipped upload and version create");
    return;
  }

  await ensureListedMetadata(config, addon);

  console.log(`Uploading ${config.zip}`);
  const upload = await uploadAndPoll(config);
  const counts = upload.validation;
  if (counts) {
    console.log(
      `Validation: ${counts.errors} errors, ${counts.warnings} warnings, ${counts.notices} notices`,
    );
  }
  if (!upload.valid) {
    throw new Error(`AMO rejected the upload for ${upload.version}`);
  }

  console.log(
    `Creating version ${upload.version} with license=${config.license} and sources`,
  );
  const version = await createVersion(config, upload.uuid);
  const validationUrl = `https://addons.mozilla.org/en-US/developers/addon/${addon.id}/file/${version.file?.id}/validation`;
  console.log(`✔ Firefox ${version.version} submitted`);
  console.log(`  Validation: ${validationUrl}`);
};

if (import.meta.main) {
  try {
    const config = configFromEnv(process.argv.slice(2));
    await submitFirefox(config);
  } catch (error) {
    console.error(
      "✖ Firefox submission failed:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}
