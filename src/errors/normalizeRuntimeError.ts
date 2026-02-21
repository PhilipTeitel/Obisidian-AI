import type {
  NormalizedRuntimeError,
  RuntimeErrorDomain,
  RuntimeLogContext,
  RuntimeLogContextValue
} from "../types";

const DOMAIN_HINTS: RuntimeErrorDomain[] = ["provider", "network", "storage", "runtime"];

const PROVIDER_PATTERN = /(provider|openai|ollama|api key|unauthorized|forbidden|rate.?limit|model)/i;
const NETWORK_PATTERN = /(network|timeout|timed out|econn|enotfound|dns|offline|socket|fetch failed)/i;
const STORAGE_PATTERN = /(storage|sqlite|vector|vault|file|filesystem|permission|eacces|eprem|enoent|disk|readonly|i\/o)/i;

const isRuntimeErrorDomain = (value: unknown): value is RuntimeErrorDomain => {
  return typeof value === "string" && DOMAIN_HINTS.includes(value as RuntimeErrorDomain);
};

const isNormalizedRuntimeError = (error: unknown): error is NormalizedRuntimeError => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeError = error as Partial<NormalizedRuntimeError>;
  return (
    typeof maybeError.domain === "string" &&
    typeof maybeError.code === "string" &&
    typeof maybeError.message === "string" &&
    typeof maybeError.userMessage === "string" &&
    typeof maybeError.retryable === "boolean"
  );
};

const toLogContextValue = (value: unknown): RuntimeLogContextValue => {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint" || typeof value === "symbol") {
    return value.toString();
  }
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "function") {
    return "[function]";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const sanitizeContext = (context?: Record<string, unknown>): RuntimeLogContext | undefined => {
  if (!context) {
    return undefined;
  }

  const sanitized: RuntimeLogContext = {};
  for (const [key, value] of Object.entries(context)) {
    sanitized[key] = toLogContextValue(value);
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
};

const inferDomain = (message: string, context?: Record<string, unknown>): RuntimeErrorDomain => {
  if (context && isRuntimeErrorDomain(context.domainHint)) {
    return context.domainHint;
  }
  if (PROVIDER_PATTERN.test(message)) {
    return "provider";
  }
  if (NETWORK_PATTERN.test(message)) {
    return "network";
  }
  if (STORAGE_PATTERN.test(message)) {
    return "storage";
  }
  return "runtime";
};

const inferCode = (domain: RuntimeErrorDomain, message: string): string => {
  switch (domain) {
    case "provider":
      if (/401|unauthorized|forbidden|invalid api key/i.test(message)) {
        return "PROVIDER_AUTH_FAILURE";
      }
      if (/429|rate.?limit/i.test(message)) {
        return "PROVIDER_RATE_LIMIT";
      }
      if (/timeout|timed out/i.test(message)) {
        return "PROVIDER_TIMEOUT";
      }
      return "PROVIDER_FAILURE";
    case "network":
      if (/timeout|timed out/i.test(message)) {
        return "NETWORK_TIMEOUT";
      }
      if (/econn|enotfound|dns|offline|socket|fetch failed/i.test(message)) {
        return "NETWORK_CONNECTION_FAILURE";
      }
      return "NETWORK_FAILURE";
    case "storage":
      if (/eacces|eprem|permission/i.test(message)) {
        return "STORAGE_PERMISSION_DENIED";
      }
      if (/enoent|not found/i.test(message)) {
        return "STORAGE_NOT_FOUND";
      }
      if (/sqlite|disk|readonly|i\/o|filesystem|file/i.test(message)) {
        return "STORAGE_IO_FAILURE";
      }
      return "STORAGE_FAILURE";
    case "runtime":
      return "RUNTIME_FAILURE";
  }
};

const isRetryable = (domain: RuntimeErrorDomain, code: string): boolean => {
  if (domain === "network") {
    return true;
  }
  return code === "PROVIDER_RATE_LIMIT" || code === "PROVIDER_TIMEOUT";
};

const toUserMessage = (domain: RuntimeErrorDomain): string => {
  switch (domain) {
    case "provider":
      return "Provider request failed. Check provider selection, credentials, and model settings.";
    case "network":
      return "Network request failed. Check endpoint reachability and your connection, then retry.";
    case "storage":
      return "Storage operation failed. Check vault/plugin file permissions and available disk space.";
    case "runtime":
      return "Unexpected runtime error. Retry the action and check console logs for details.";
  }
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "Unknown runtime error";
};

export const normalizeRuntimeError = (
  error: unknown,
  context?: Record<string, unknown>
): NormalizedRuntimeError => {
  const sanitizedContext = sanitizeContext(context);
  if (isNormalizedRuntimeError(error)) {
    const mergedContext =
      error.context || sanitizedContext ? { ...(error.context ?? {}), ...(sanitizedContext ?? {}) } : undefined;
    return {
      ...error,
      context: mergedContext
    };
  }

  const message = toErrorMessage(error);
  const domain = inferDomain(message, context);
  const code = inferCode(domain, message);

  return {
    domain,
    code,
    message,
    userMessage: toUserMessage(domain),
    retryable: isRetryable(domain, code),
    cause: error,
    context: sanitizedContext
  };
};
