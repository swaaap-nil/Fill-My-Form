/**
 * Structured logging with a closed field allowlist.
 *
 * The allowlist is the point. `LogFields` has no index signature, so passing
 * an unlisted key — `value`, `email`, `answer` — is a type error rather than a
 * privacy incident. Adding a key here is a deliberate act that should be
 * reviewed against docs/privacy.md.
 *
 * Never log: memory values, form field values, file contents or names, page
 * text, URLs with query strings, tokens, API keys.
 */

export const LogLevel = {
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

/**
 * Every field permitted in a log line. All are non-personal identifiers,
 * enumerations or measurements.
 */
export interface LogFields {
  /** Correlates every line emitted by one agent run. */
  readonly runId?: string;
  readonly sessionId?: string;
  readonly stepIndex?: number;
  readonly phase?: string;
  readonly status?: string;
  readonly toolName?: string;
  readonly domain?: string;
  /** Ontology concept key, e.g. "contact.email". A key, never its value. */
  readonly conceptKey?: string;
  /** Opaque in-page field identifier. Not the label, not the value. */
  readonly fieldId?: string;
  readonly fieldKind?: string;
  /** Registrable origin only — never a full URL with a query string. */
  readonly origin?: string;
  readonly durationMs?: number;
  readonly count?: number;
  readonly confidence?: number;
  readonly providerId?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly errorCode?: string;
  readonly severity?: string;
  readonly recoverable?: boolean;
}

export const REDACTED = "[redacted]";

/**
 * Marks a value as unloggable. Use at the boundary where a personal value
 * would otherwise flow into a diagnostic string.
 */
export const redact = (_value: unknown): string => REDACTED;

/** Reports shape without disclosing content. Safe for diagnostics. */
export const describe = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "string") return `string(${value.length})`;
  return typeof value;
};

export interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: LogFields;
  readonly time: string;
}

export type LogSink = (record: LogRecord) => void;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Derives a logger that stamps `fields` onto every subsequent line. */
  child(fields: LogFields): Logger;
}

export const consoleSink: LogSink = (record) => {
  const line = `[${record.level}] ${record.message}`;
  const method =
    record.level === LogLevel.ERROR
      ? console.error
      : record.level === LogLevel.WARN
        ? console.warn
        : console.log;
  method(line, record.fields);
};

export const createLogger = (
  base: LogFields = {},
  sink: LogSink = consoleSink,
): Logger => {
  const emit = (level: LogLevel, message: string, fields: LogFields = {}) => {
    sink({
      level,
      message,
      fields: { ...base, ...fields },
      time: new Date().toISOString(),
    });
  };

  return {
    debug: (message, fields) => emit(LogLevel.DEBUG, message, fields),
    info: (message, fields) => emit(LogLevel.INFO, message, fields),
    warn: (message, fields) => emit(LogLevel.WARN, message, fields),
    error: (message, fields) => emit(LogLevel.ERROR, message, fields),
    child: (fields) => createLogger({ ...base, ...fields }, sink),
  };
};

/** Discards everything. Default for tests. */
export const nullLogger: Logger = createLogger({}, () => {});
