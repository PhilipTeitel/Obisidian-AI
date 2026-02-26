import { describe, expect, it } from "vitest";
import { redactSensitiveContext } from "../../logging/redactSensitiveContext";

describe("redactSensitiveContext", () => {
  it("B1_redacts_nested_sensitive_fields", () => {
    const input = {
      Authorization: "Bearer abc123",
      metadata: {
        apiKey: "secret-key",
        nested: {
          sessionToken: "session-token",
          safeValue: "ok"
        }
      },
      headers: [
        {
          Cookie: "cookie-value"
        },
        {
          "Content-Type": "application/json"
        }
      ]
    };

    const redacted = redactSensitiveContext(input) as {
      Authorization: string;
      metadata: { apiKey: string; nested: { sessionToken: string; safeValue: string } };
      headers: Array<Record<string, string>>;
    };

    expect(redacted.Authorization).toBe("[REDACTED]");
    expect(redacted.metadata.apiKey).toBe("[REDACTED]");
    expect(redacted.metadata.nested.sessionToken).toBe("[REDACTED]");
    expect(redacted.metadata.nested.safeValue).toBe("ok");
    expect(redacted.headers[0]?.Cookie).toBe("[REDACTED]");
    expect(redacted.headers[1]?.["Content-Type"]).toBe("application/json");
  });
});
