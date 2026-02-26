import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeLogger, setRuntimeLogLevel } from "../../logging/runtimeLogger";

const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);

afterEach(() => {
  infoSpy.mockClear();
  warnSpy.mockClear();
  errorSpy.mockClear();
  debugSpy.mockClear();
  setRuntimeLogLevel("info");
});

describe("runtimeLogger", () => {
  it("A1_with_operation_id_scopes_logs", () => {
    setRuntimeLogLevel("debug");
    const logger = createRuntimeLogger("runtimeLogger.test");

    logger.withOperation("op-custom").info({
      event: "runtime.op.custom",
      message: "custom operation"
    });
    logger.withOperation().info({
      event: "runtime.op.generated",
      message: "generated operation"
    });

    expect(infoSpy).toHaveBeenCalledTimes(2);
    const [firstPayload] = infoSpy.mock.calls[0] ?? [];
    const [secondPayload] = infoSpy.mock.calls[1] ?? [];

    expect(firstPayload).toMatchObject({
      scope: "runtimeLogger.test",
      operationId: "op-custom",
      event: "runtime.op.custom"
    });
    expect(secondPayload).toMatchObject({
      scope: "runtimeLogger.test",
      event: "runtime.op.generated"
    });
    expect(secondPayload.operationId).toMatch(/^op-/);
  });

  it("A2_log_level_threshold_filters_events", () => {
    setRuntimeLogLevel("warn");
    const logger = createRuntimeLogger("runtimeLogger.test");

    logger.debug({
      event: "runtime.debug",
      message: "debug payload"
    });
    logger.info({
      event: "runtime.info",
      message: "info payload"
    });
    logger.warn({
      event: "runtime.warn",
      message: "warn payload"
    });
    logger.error({
      event: "runtime.error",
      message: "error payload"
    });

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("B1_backward_compatible_log_api", () => {
    setRuntimeLogLevel("info");
    const logger = createRuntimeLogger("runtimeLogger.test");

    logger.log({
      level: "info",
      event: "runtime.compat",
      message: "legacy API"
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [payload] = infoSpy.mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      scope: "runtimeLogger.test",
      event: "runtime.compat",
      message: "legacy API"
    });
    expect(typeof payload.timestamp).toBe("string");
  });
});
