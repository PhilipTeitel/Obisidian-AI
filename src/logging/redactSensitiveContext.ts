const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_KEY_PATTERNS = ["authorization", "token", "secret", "api-key", "apikey", "cookie", "password"];

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const isSensitiveKey = (key: string): boolean => {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
};

export const redactSensitiveContext = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveContext(entry));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => {
      if (isSensitiveKey(key)) {
        return [key, REDACTED_VALUE];
      }
      return [key, redactSensitiveContext(entryValue)];
    })
  );
};
