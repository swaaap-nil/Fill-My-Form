import { LLMError } from "../errors";
import {
  FinishReason,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type LLMToolCall,
} from "./provider";

export interface MockReply {
  readonly text?: string;
  /** Returned as `value` when the request carries a schema. */
  readonly value?: unknown;
  readonly toolCalls?: readonly LLMToolCall[];
  readonly finishReason?: FinishReason;
}

export interface MockLLMProviderOptions {
  readonly id?: string;
  /** Replies are returned in order, one per `generate` call. */
  readonly replies?: readonly MockReply[];
  /** Used when the scripted replies run out. Throws if not set. */
  readonly fallback?: MockReply;
}

/**
 * Scripted provider for tests and evaluation baselines. Never touches the
 * network, so the whole agent can be exercised offline and deterministically.
 *
 * It validates structured output against the request schema exactly like a
 * real provider must, which is what makes it a useful stand-in: a test that
 * scripts a malformed reply proves the caller handles a malformed reply.
 */
export class MockLLMProvider implements LLMProvider {
  readonly id: string;
  private readonly replies: readonly MockReply[];
  private readonly fallback?: MockReply;
  private cursor = 0;

  /** Every request seen, for assertions about prompt and tool exposure. */
  readonly calls: LLMRequest<unknown>[] = [];

  constructor(options: MockLLMProviderOptions = {}) {
    this.id = options.id ?? "mock";
    this.replies = options.replies ?? [];
    this.fallback = options.fallback;
  }

  async generate<T = string>(request: LLMRequest<T>): Promise<LLMResponse<T>> {
    this.calls.push(request as LLMRequest<unknown>);

    const reply = this.replies[this.cursor++] ?? this.fallback;
    if (!reply) {
      throw LLMError("MockLLMProvider ran out of scripted replies.", {
        context: { providerId: this.id, count: this.cursor },
      });
    }

    const text = reply.text ?? "";

    let value: T;
    if (request.schema) {
      const parsed = request.schema.safeParse(reply.value);
      if (!parsed.success) {
        throw LLMError("Model output did not match the requested schema.", {
          context: {
            providerId: this.id,
            issues: parsed.error.issues.length,
          },
        });
      }
      value = parsed.data;
    } else {
      value = text as T;
    }

    return {
      value,
      text,
      toolCalls: reply.toolCalls ?? [],
      finishReason: reply.finishReason ?? FinishReason.STOP,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  reset(): void {
    this.cursor = 0;
    this.calls.length = 0;
  }
}
