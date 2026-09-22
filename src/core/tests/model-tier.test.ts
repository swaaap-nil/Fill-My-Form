import { describe, expect, it } from "bun:test";
import { Certainty } from "~/core/agent/types";
import { FieldKind, type Form, type FormField } from "~/core/form/types";
import { MockLLMProvider } from "~/core/llm/mock";
import {
  computeMetrics,
  MetricBucket,
  runEvalWithModel,
} from "~/core/matching/eval";
import {
  buildModelMappingMessages,
  mapFieldWithModel,
} from "~/core/matching/model-tier";
import { createConceptIndex } from "~/core/ontology";

const index = createConceptIndex([
  {
    key: "identity.favorite_color",
    label: "Favorite color",
    sensitivity: "personal",
    volatility: "stable",
    expects: "text",
    aliases: { en: ["favorite color"] },
  },
]);

const field = (overrides: Partial<FormField> & { id: string }): FormField => ({
  kind: FieldKind.TEXT,
  required: false,
  hasValue: false,
  constraints: [],
  disabled: false,
  readOnly: false,
  ...overrides,
});

describe("model mapping prompt construction", () => {
  it("does not include full context from fields the model was not asked about", () => {
    const sentinel = "DO_NOT_SEND_FULL_CONTEXT";
    const form: Form = {
      id: "form-1",
      fields: [
        field({ id: "target", label: "Colour preference" }),
        field({
          id: "other",
          label: "Other field",
          placeholder: sentinel,
          description: sentinel,
          nearbyText: [sentinel],
        }),
      ],
    };

    const messages = buildModelMappingMessages({
      fieldSummaries: form.fields,
      field: form.fields[0] as FormField,
      concepts: index.all,
    });
    const prompt = messages.map((message) => message.content).join("\n");

    expect(prompt).not.toContain(sentinel);
    expect(prompt).toContain("Colour preference");
    expect(prompt).toContain("Other field");
  });

  it("instructs the model to reason across languages rather than by keyword overlap", () => {
    const messages = buildModelMappingMessages({
      fieldSummaries: [],
      field: field({ id: "target" }),
      concepts: index.all,
    });
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    expect(system).toContain("may be in any language");
  });
});

describe("model concept-key output", () => {
  it("returns a model-tier match for a known ontology key", async () => {
    const provider = new MockLLMProvider({
      replies: [
        {
          value: {
            fieldId: "target",
            conceptKey: "identity.favorite_color",
            certainty: Certainty.KNOWN,
          },
        },
      ],
    });

    const result = await mapFieldWithModel(
      provider,
      {
        fieldSummaries: [field({ id: "target", label: "Colour preference" })],
        field: field({ id: "target", label: "Colour preference" }),
        concepts: index.all,
      },
      index,
    );

    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]).toMatchObject({
      conceptKey: "identity.favorite_color",
      tier: "model",
    });
  });

  it("rejects an unknown key instead of passing it through", async () => {
    const provider = new MockLLMProvider({
      replies: [
        {
          value: {
            fieldId: "target",
            conceptKey: "identity.unknown_concept",
            certainty: Certainty.KNOWN,
          },
        },
      ],
    });

    await expect(
      mapFieldWithModel(
        provider,
        {
          fieldSummaries: [field({ id: "target", label: "Mystery" })],
          field: field({ id: "target", label: "Mystery" }),
          concepts: index.all,
        },
        index,
      ),
    ).rejects.toThrow(/unknown ontology concept key/);
  });

  it("rejects a malformed key at the schema boundary", async () => {
    const provider = new MockLLMProvider({
      replies: [
        {
          value: {
            fieldId: "target",
            conceptKey: "not a key",
            certainty: Certainty.KNOWN,
          },
        },
      ],
    });

    await expect(
      mapFieldWithModel(
        provider,
        {
          fieldSummaries: [field({ id: "target", label: "Mystery" })],
          field: field({ id: "target", label: "Mystery" }),
          concepts: index.all,
        },
        index,
      ),
    ).rejects.toThrow();
  });
});

describe("eval with model tier", () => {
  it("can reduce missed fields without changing deterministic results", async () => {
    const fields = [field({ id: "target", label: "Colour preference" })];
    const provider = new MockLLMProvider({
      replies: [
        {
          value: {
            fieldId: "target",
            conceptKey: "identity.favorite_color",
            certainty: Certainty.KNOWN,
          },
        },
      ],
    });

    const outcomes = await runEvalWithModel(
      fields,
      [
        {
          fieldId: "target",
          expectedConcept: "identity.favorite_color",
          expectedCertainty: Certainty.KNOWN,
        },
      ],
      index,
      provider,
    );

    expect(computeMetrics(outcomes)[MetricBucket.RESOLVED_CORRECT]).toBe(1);
    expect(computeMetrics(outcomes)[MetricBucket.MISSED]).toBe(0);
  });
});
