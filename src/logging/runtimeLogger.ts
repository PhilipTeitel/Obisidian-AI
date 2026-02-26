import type { RuntimeLogEvent, RuntimeLogInput, RuntimeLogLevel, RuntimeLoggerContract } from "../types";

interface RuntimeLogPayload extends RuntimeLogEvent {
  scope: string;
  timestamp: string;
}

const LOG_LEVEL_PRIORITY: Record<RuntimeLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

let activeLogLevel: RuntimeLogLevel = "info";

const shouldEmit = (level: RuntimeLogLevel): boolean => {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[activeLogLevel];
};

const generateOperationId = (): string => {
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const emit = (level: RuntimeLogEvent["level"], payload: RuntimeLogPayload): void => {
  if (!shouldEmit(level)) {
    return;
  }
  switch (level) {
    case "debug":
      console.debug(payload);
      return;
    case "info":
      console.info(payload);
      return;
    case "warn":
      console.warn(payload);
      return;
    case "error":
      console.error(payload);
      return;
  }
};

const createLogger = (scope: string, operationId?: string): RuntimeLoggerContract => {
  const toEvent = (level: RuntimeLogLevel, event: RuntimeLogInput): RuntimeLogEvent => {
    return {
      ...event,
      level,
      operationId: event.operationId ?? operationId
    };
  };

  return {
    log(event: RuntimeLogEvent): void {
      emit(event.level, {
        ...event,
        scope,
        timestamp: new Date().toISOString()
      });
    },
    debug(event: RuntimeLogInput): void {
      this.log(toEvent("debug", event));
    },
    info(event: RuntimeLogInput): void {
      this.log(toEvent("info", event));
    },
    warn(event: RuntimeLogInput): void {
      this.log(toEvent("warn", event));
    },
    error(event: RuntimeLogInput): void {
      this.log(toEvent("error", event));
    },
    withOperation(nextOperationId?: string): RuntimeLoggerContract {
      return createLogger(scope, nextOperationId ?? generateOperationId());
    }
  };
};

export const setRuntimeLogLevel = (level: RuntimeLogLevel): void => {
  activeLogLevel = level;
};

export const createRuntimeLogger = (scope: string): RuntimeLoggerContract => {
  return createLogger(scope);
};
