import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { ErrorCode, isAppError } from "~/core/errors";
import { MockLLMProvider } from "~/core/llm/mock";
import type { LLMProvider } from "~/core/llm/provider";

const mapping = z.object({
  fieldId: z.string(),
  conceptKey: z.string(),
  certainty: z.enum(["known", "unknown", "ambiguous", "requires_confirmation"]),
});

describe("MockLLMProvider", () => {
  it("satisfies the LLMProvider port", () => {
    // If this compiles, a provider can be swapped in without touching callers.
    const provider: LLMProvider = new MockLLMProvider();
    expect(provider.id).toBe("mock");
  });

  it("returns scripted structured output validated against the schema", async () => {
    const provider = new MockLLMProvider({
      replies: [
        {
          value: {
            fieldId: "f1",
            conceptKey: "education.secondary.completion_year",
            certainty: "known",
          },
        },
      ],
    });

    const response = await provider.generate({
      messages: [{ role: "user", content: "map this field" }],
      schema: mapping,
    });

    expect(response.value.conceptKey).toBe(
      "education.secondary.completion_year",
    );
    expect(response.finishReason).toBe("stop");
  });

  it("rejects structured output that does not match the schema", async () => {
    const provider = new MockLLMProvider({
      replies: [{ value: { fieldId: "f1", conceptKey: 7 } }],
    });

    const attempt = provider.generate({
      messages: [{ role: "user", content: "map this field" }],
      schema: mapping,
    });

    await expect(attempt).rejects.toThrow();
    await attempt.catch((error: unknown) => {
      expect(isAppError(error) && error.code).toBe(ErrorCode.LLM);
    });
  });

  it("records requests so a test can assert which tools were exposed", async () => {
    const provider = new MockLLMProvider({ fallback: { text: "ok" } });

    await provider.generate({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "search_memory", description: "", parameters: {} }],
    });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.tools?.map((t) => t.name)).toEqual([
      "search_memory",
    ]);
  });

  it("fails loudly when a test under-scripts it", async () => {
    const provider = new MockLLMProvider();

    await expect(
      provider.generate({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/ran out of scripted replies/);
  });
});
