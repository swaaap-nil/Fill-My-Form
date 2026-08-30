import { describe, expect, it } from "bun:test";
import { AppError, ErrorCode, ErrorSeverity } from "~/core/errors";
import {
  createLogger,
  describe as describeValue,
  type LogRecord,
  redact,
} from "~/core/logging";

const capture = () => {
  const records: LogRecord[] = [];
  return { records, sink: (r: LogRecord) => records.push(r) };
};

describe("logger", () => {
  it("stamps base fields onto every line", () => {
    const { records, sink } = capture();
    const logger = createLogger({ runId: "run_1" }, sink);

    logger.info("observed", { phase: "observe" });

    expect(records[0]?.fields).toMatchObject({
      runId: "run_1",
      phase: "observe",
    });
  });

  it("inherits base fields through child loggers", () => {
    const { records, sink } = capture();

    createLogger({ runId: "run_1" }, sink)
      .child({ toolName: "fill_field" })
      .warn("slow");

    expect(records[0]?.fields).toMatchObject({
      runId: "run_1",
      toolName: "fill_field",
    });
  });
});

describe("redaction helpers", () => {
  it("redact never returns the input", () => {
    expect(redact("swapnil@example.com")).toBe("[redacted]");
  });

  it("describe reports shape without content", () => {
    expect(describeValue("swapnil@example.com")).toBe("string(19)");
    expect(describeValue(["a", "b"])).toBe("array(2)");
    expect(describeValue(null)).toBe("null");
  });
});

describe("AppError", () => {
  it("projects to log fields without leaking the message", () => {
    const error = new AppError(ErrorCode.MEMORY, "no value for contact.email", {
      severity: ErrorSeverity.WARNING,
      context: { conceptKey: "contact.email" },
    });

    const fields = error.toLogFields();

    expect(fields).toEqual({
      errorCode: "memory",
      severity: "warning",
      recoverable: false,
      conceptKey: "contact.email",
    });
    expect(JSON.stringify(fields)).not.toContain("no value");
  });

  it("preserves the cause chain", () => {
    const cause = new Error("IndexedDB unavailable");
    const error = new AppError(ErrorCode.MEMORY, "read failed", { cause });

    expect(error.cause).toBe(cause);
  });
});
