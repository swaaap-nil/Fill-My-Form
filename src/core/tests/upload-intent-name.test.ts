import { describe, expect, it } from "bun:test";
import type { UploadIntent } from "~/core/form/types";
import {
  conceptKeyForUploadIntent,
  recognizedUploadRequirements,
} from "~/core/matching/upload-intent-name";
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

describe("conceptKeyForUploadIntent", () => {
  it("uses the ontology concept when the control label is a file alias", () => {
    expect(
      conceptKeyForUploadIntent(
        intent({ kind: "document", label: "Upload resume" }),
        ontology,
      ),
    ).toBe("documents.resume");
  });

  it("resolves resume from nearby requirement text, not the generic button label", () => {
    expect(
      conceptKeyForUploadIntent(
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
      conceptKeyForUploadIntent(
        intent({ kind: "photo", label: "Passport size photo" }),
        ontology,
      ),
    ).toBe("documents.photo");
    expect(
      conceptKeyForUploadIntent(
        intent({ kind: "signature", label: "Candidate signature" }),
        ontology,
      ),
    ).toBe("documents.signature");
  });

  it("returns nothing when the page only says upload or document", () => {
    expect(
      conceptKeyForUploadIntent(
        intent({
          kind: "document",
          label: "Upload",
          description: "Choose file",
        }),
        ontology,
      ),
    ).toBeUndefined();
    expect(
      conceptKeyForUploadIntent(
        intent({ kind: "unknown", label: "Choose file" }),
        ontology,
      ),
    ).toBeUndefined();
  });
});

describe("recognizedUploadRequirements", () => {
  it("keeps recognized upload widgets and drops generic ones", () => {
    const requirements = recognizedUploadRequirements(
      [
        intent({ id: "upload-0-0", kind: "document", label: "Upload resume" }),
        intent({
          id: "upload-0-1",
          kind: "document",
          label: "Upload",
          description: "Choose file",
        }),
      ],
      [],
      new Set(),
      ontology,
    );

    expect(requirements.map((requirement) => requirement.conceptKey)).toEqual([
      "documents.resume",
    ]);
  });

  it("includes file concepts from no_value proposals when extraction missed the widget", () => {
    const requirements = recognizedUploadRequirements(
      [],
      ["documents.photo"],
      new Set(),
      ontology,
    );

    expect(requirements).toEqual([{ conceptKey: "documents.photo" }]);
  });

  it("dedupes a widget and a no_value proposal for the same concept", () => {
    const resume = intent({
      id: "upload-0-0",
      kind: "document",
      label: "Upload resume",
    });
    const requirements = recognizedUploadRequirements(
      [resume],
      ["documents.resume"],
      new Set(),
      ontology,
    );

    expect(requirements).toEqual([
      { conceptKey: "documents.resume", intent: resume },
    ]);
  });

  it("hides concepts already remembered for this scan", () => {
    const requirements = recognizedUploadRequirements(
      [intent({ kind: "document", label: "Upload resume" })],
      ["documents.photo"],
      new Set(["documents.resume"]),
      ontology,
    );

    expect(requirements.map((requirement) => requirement.conceptKey)).toEqual([
      "documents.photo",
    ]);
  });
});
