import { describe, expect, it } from "bun:test";
import type { UploadIntent } from "~/core/form/types";
import { nameForUploadIntent } from "~/core/matching/upload-intent-name";
import { ontology } from "~/core/ontology";

const intent = (overrides: Partial<UploadIntent>): UploadIntent => ({
  id: "upload-0-0",
  kind: "unknown",
  requirements: [],
  constraints: [],
  confidence: "medium",
  actionability: "user_assisted",
  hasNativeTarget: false,
  ...overrides,
});

describe("nameForUploadIntent", () => {
  it("uses the ontology concept when the control label is a file alias", () => {
    expect(
      nameForUploadIntent(
        intent({ kind: "document", label: "Upload resume" }),
        ontology,
      ),
    ).toBe("documents.resume");
  });

  it("resolves resume from nearby requirement text, not the generic button label", () => {
    expect(
      nameForUploadIntent(
        intent({
          kind: "document",
          label: "Choose file",
          description: "Upload resume PDF, max 2 MB",
          requirements: ["Upload resume PDF, max 2 MB"],
        }),
        ontology,
      ),
    ).toBe("documents.resume");
  });

  it("resolves photograph and signature the same way known fields do", () => {
    expect(
      nameForUploadIntent(
        intent({ kind: "photo", label: "Passport size photo" }),
        ontology,
      ),
    ).toBe("documents.photo");
    expect(
      nameForUploadIntent(
        intent({ kind: "signature", label: "Candidate signature" }),
        ontology,
      ),
    ).toBe("documents.signature");
  });

  it("stays generic when the page only says upload or document", () => {
    expect(
      nameForUploadIntent(
        intent({
          kind: "document",
          label: "Upload",
          description: "Choose file",
        }),
        ontology,
      ),
    ).toBe("document");
    expect(
      nameForUploadIntent(
        intent({ kind: "unknown", label: "Choose file" }),
        ontology,
      ),
    ).toBe("upload");
  });
});
