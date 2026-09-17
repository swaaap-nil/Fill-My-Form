import { describe, expect, it } from "bun:test";
import { evaluateManifest, type ManifestLike } from "../check-release-manifest";
import {
  applyHostPermissionsPolicy,
  type HostPermissionsManifest,
} from "../manifest-hook";

describe("applyHostPermissionsPolicy", () => {
  it("strips host_permissions for a release build", () => {
    const manifest: HostPermissionsManifest = {
      host_permissions: ["https://*/*"],
    };
    applyHostPermissionsPolicy(manifest, {});
    expect(manifest.host_permissions).toBeUndefined();
  });

  it("leaves host_permissions absent when it was never inferred", () => {
    const manifest: HostPermissionsManifest = {};
    applyHostPermissionsPolicy(manifest, {});
    expect("host_permissions" in manifest).toBe(false);
  });

  it("adds only the localhost fixture origin under WXT_E2E=1", () => {
    const manifest: HostPermissionsManifest = {
      host_permissions: ["https://*/*"],
    };
    applyHostPermissionsPolicy(manifest, { WXT_E2E: "1" });
    expect(manifest.host_permissions).toEqual(["http://localhost:4173/*"]);
  });

  it("does not add host_permissions for any other WXT_E2E value", () => {
    const manifest: HostPermissionsManifest = {};
    applyHostPermissionsPolicy(manifest, { WXT_E2E: "true" });
    expect(manifest.host_permissions).toBeUndefined();
  });
});

describe("a WXT_E2E=1 build still fails scripts/check-release-manifest.ts", () => {
  it("evaluateManifest flags the e2e-only host_permissions", () => {
    const manifest: ManifestLike = {
      permissions: ["storage", "sidePanel", "activeTab", "tabs", "scripting"],
      content_scripts: [],
      content_security_policy: {
        extension_pages: "script-src 'self'; object-src 'self'",
      },
    };
    applyHostPermissionsPolicy(manifest, { WXT_E2E: "1" });

    const findings = evaluateManifest(manifest);
    expect(findings.some((f) => f.includes("host_permissions"))).toBe(true);
  });

  it("passes clean once the same manifest is built for release", () => {
    const manifest: ManifestLike = {
      permissions: ["storage", "sidePanel", "activeTab", "tabs", "scripting"],
      content_scripts: [],
      content_security_policy: {
        extension_pages: "script-src 'self'; object-src 'self'",
      },
    };
    applyHostPermissionsPolicy(manifest, {});

    expect(evaluateManifest(manifest)).toEqual([]);
  });
});
