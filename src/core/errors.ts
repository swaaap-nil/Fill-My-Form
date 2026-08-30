/**
 * Structured application errors.
 *
 * `context` is written to logs. It must therefore carry only non-personal
 * identifiers — field ids, concept keys, tool names — never field values,
 * memory values or file contents. See `~/core/logging`.
 */

export const ErrorCode = {
  FORM_DETECTION: "form_detection",
  TOOL_EXECUTION: "tool_execution",
  MEMORY: "memory",
  LLM: "llm",
  VALIDATION: "validation",
  VERIFICATION: "verification",
  USER_CANCELLED: "user_cancelled",
  UNSUPPORTED_FIELD: "unsupported_field",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ErrorSeverity = {
  /** Expected, part of normal flow (e.g. the user cancelled). */
  INFO: "info",
  /** Degraded but the run continues. */
  WARNING: "warning",
  /** The current step failed. */
  ERROR: "error",
  /** The run cannot continue. */
  FATAL: "fatal",
} as const;

export type ErrorSeverity = (typeof ErrorSeverity)[keyof typeof ErrorSeverity];

/** Non-personal diagnostic context. Safe to log verbatim. */
export type ErrorContext = Readonly<Record<string, string | number | boolean>>;

export interface AppErrorOptions {
  readonly severity?: ErrorSeverity;
  /** Whether the runtime may retry or route around this. */
  readonly recoverable?: boolean;
  readonly context?: ErrorContext;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly severity: ErrorSeverity;
  readonly recoverable: boolean;
  readonly context: ErrorContext;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.severity = options.severity ?? ErrorSeverity.ERROR;
    this.recoverable = options.recoverable ?? false;
    this.context = options.context ?? {};
  }

  /** Log-safe projection. Deliberately omits `message`, which may quote input. */
  toLogFields(): ErrorContext {
    return {
      errorCode: this.code,
      severity: this.severity,
      recoverable: this.recoverable,
      ...this.context,
    };
  }
}

export const isAppError = (value: unknown): value is AppError =>
  value instanceof AppError;

const make =
  (code: ErrorCode, defaults: AppErrorOptions = {}) =>
  (message: string, options: AppErrorOptions = {}) =>
    new AppError(code, message, { ...defaults, ...options });

export const FormDetectionError = make(ErrorCode.FORM_DETECTION, {
  recoverable: true,
});
export const ToolExecutionError = make(ErrorCode.TOOL_EXECUTION, {
  recoverable: true,
});
export const MemoryError = make(ErrorCode.MEMORY);
export const LLMError = make(ErrorCode.LLM, { recoverable: true });
export const ValidationError = make(ErrorCode.VALIDATION);
export const VerificationError = make(ErrorCode.VERIFICATION, {
  recoverable: true,
});
export const UserCancelledError = make(ErrorCode.USER_CANCELLED, {
  severity: ErrorSeverity.INFO,
});
export const UnsupportedFieldError = make(ErrorCode.UNSUPPORTED_FIELD, {
  severity: ErrorSeverity.WARNING,
  recoverable: true,
});
