import {
  generateObject,
  generateText,
  jsonSchema,
  type LanguageModel,
  type Tool,
  tool,
} from "ai";
import { z } from "zod";
import { LLMError } from "../errors";
import {
  FinishReason,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type LLMToolCall,
} from "./provider";

/**
 * The ONLY file in `src/core` permitted to import a model SDK. `biome.json`
 * enforces that; see docs/adr/002-llm-port-over-vercel-ai-sdk.md for why the
 * port sits on top of the AI SDK rather than replacing it.
 *
 * The adapter takes a `LanguageModel`, so which vendor is in use is decided at
 * wiring time — `chromeai()` today, an OpenAI-compatible endpoint or a local
 * model later — without any change here or anywhere upstream.
 *
 * Note that tools are declared to the SDK WITHOUT an `execute` function. The
 * model may therefore propose a call, but the SDK cannot run it: execution
 * stays with our registry, behind schema validation and policy. That is
 * deliberate and should not be "fixed".
 */

/**
 * Derived from the SDK rather than imported from `@ai-sdk/provider`, which is
 * a transitive dependency we do not declare.
 */
type JsonSchemaInput = Parameters<typeof jsonSchema>[0];

const toFinishReason = (reason: string): FinishReason => {
  switch (reason) {
    case "stop":
      return FinishReason.STOP;
    case "length":
      return FinishReason.LENGTH;
    case "tool-calls":
      return FinishReason.TOOL_CALL;
    case "content-filter":
      return FinishReason.CONTENT_FILTER;
    case "error":
      return FinishReason.ERROR;
    default:
      return FinishReason.STOP;
  }
};

export class AiSdkProvider implements LLMProvider {
  readonly id: string;
  private readonly model: LanguageModel;

  constructor(model: LanguageModel, id = "ai-sdk") {
    this.model = model;
    this.id = id;
  }

  async generate<T = string>(request: LLMRequest<T>): Promise<LLMResponse<T>> {
    const system =
      request.system ??
      request.messages.find((m) => m.role === "system")?.content;
    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const shared = {
      model: this.model,
      system,
      messages,
      temperature: request.temperature,
      maxTokens: request.maxOutputTokens,
      abortSignal: request.signal,
    };

    try {
      if (request.schema) {
        const result = await generateObject({
          ...shared,
          schema: jsonSchema(
            z.toJSONSchema(request.schema) as JsonSchemaInput,
          ) as never,
        });

        // Validate with our own schema rather than trusting the SDK's parse.
        // The model is untrusted input all the way to the last boundary.
        const parsed = request.schema.safeParse(result.object);
        if (!parsed.success) {
          throw LLMError("Model output did not match the requested schema.", {
            context: {
              providerId: this.id,
              issues: parsed.error.issues.length,
            },
          });
        }

        return {
          value: parsed.data,
          text: JSON.stringify(result.object),
          toolCalls: [],
          finishReason: toFinishReason(result.finishReason),
          usage: {
            inputTokens: result.usage.promptTokens,
            outputTokens: result.usage.completionTokens,
          },
        };
      }

      const tools: Record<string, Tool> | undefined = request.tools?.length
        ? Object.fromEntries(
            request.tools.map((descriptor) => [
              descriptor.name,
              tool({
                description: descriptor.description,
                parameters: jsonSchema(
                  descriptor.parameters as JsonSchemaInput,
                ),
              }),
            ]),
          )
        : undefined;

      const result = await generateText({ ...shared, tools });

      const toolCalls: LLMToolCall[] = result.toolCalls.map((call) => ({
        id: call.toolCallId,
        name: call.toolName,
        input: call.args,
      }));

      return {
        value: result.text as T,
        text: result.text,
        toolCalls,
        finishReason: toFinishReason(result.finishReason),
        usage: {
          inputTokens: result.usage.promptTokens,
          outputTokens: result.usage.completionTokens,
        },
      };
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AppError") throw cause;
      throw LLMError("Provider call failed.", {
        context: { providerId: this.id },
        cause,
      });
    }
  }
}
