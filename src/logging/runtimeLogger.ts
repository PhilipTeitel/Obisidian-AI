import type { RuntimeLogEvent, RuntimeLoggerContract } from "../types";

interface RuntimeLogPayload extends RuntimeLogEvent {
  scope: string;
  timestamp: string;
}

const emit = (level: RuntimeLogEvent["level"], payload: RuntimeLogPayload): void => {
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

export const createRuntimeLogger = (scope: string): RuntimeLoggerContract => {
  return {
    log(event: RuntimeLogEvent): void {
      emit(event.level, {
        ...event,
        scope,
        timestamp: new Date().toISOString()
      });
    }
  };
};
