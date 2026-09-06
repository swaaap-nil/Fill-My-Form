import { describe, expect, it } from "bun:test";
import {
  forbiddenDependencyNames,
  isForbiddenDependencyName,
} from "../check-forbidden-deps";

describe("check-forbidden-deps", () => {
  it("rejects OCR, vision and document parsing dependencies", () => {
    expect(isForbiddenDependencyName("tesseract.js")).toBe(true);
    expect(isForbiddenDependencyName("pdfjs-dist")).toBe(true);
    expect(isForbiddenDependencyName("pdf-parse")).toBe(true);
    expect(isForbiddenDependencyName("@google-cloud/vision")).toBe(true);
    expect(isForbiddenDependencyName("some-ocr-engine")).toBe(true);
    expect(isForbiddenDependencyName("@vendor/local-vision")).toBe(true);
  });

  it("allows unrelated package names", () => {
    expect(isForbiddenDependencyName("react")).toBe(false);
    expect(isForbiddenDependencyName("@vitejs/plugin-react")).toBe(false);
    expect(isForbiddenDependencyName("provisioner")).toBe(false);
  });

  it("scans package manifests and bun lock package names", () => {
    const found = forbiddenDependencyNames(
      {
        dependencies: { react: "^19.0.0" },
        devDependencies: { "pdf-parse": "^1.0.0" },
      },
      {
        packages: {
          "safe-package": [],
          "@scope/image-ocr@1.0.0": [],
          "@types/node": [],
        },
      },
    );

    expect(found).toEqual(["@scope/image-ocr", "pdf-parse"]);
  });
});
