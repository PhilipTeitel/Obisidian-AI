import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJsonWithTimeout } from "../../providers/embeddings/httpEmbeddingUtils";

describe("httpEmbeddingUtils", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts_authorization_header_in_request_logs", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] })
    }));
    vi.stubGlobal("fetch", fetchMock);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await fetchJsonWithTimeout(
      "https://api.openai.com/v1/embeddings",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-token",
          "Content-Type": "application/json"
        },
        body: "{}"
      },
      1000
    );

    const requestStartPayload = infoSpy.mock.calls
      .map(([payload]) => payload)
      .find((payload) => payload?.event === "provider.http.request.start");

    expect(requestStartPayload?.context?.headers).toContain("[REDACTED]");
    expect(requestStartPayload?.context?.headers).not.toContain("secret-token");
  });
});
