import { describe, expect, it } from "vitest";
import { PluginSecretStore } from "../../secrets/PluginSecretStore";

describe("PluginSecretStore", () => {
  it("reads, writes, and deletes secrets when plugin APIs are available", async () => {
    const secretMap = new Map<string, string>([["openai-api-key", "initial-key"]]);
    const plugin = {
      loadSecret: async (key: string) => secretMap.get(key) ?? null,
      saveSecret: async (key: string, value: string) => {
        secretMap.set(key, value);
      },
      deleteSecret: async (key: string) => {
        secretMap.delete(key);
      }
    };

    const store = new PluginSecretStore(plugin as never);

    expect(await store.getSecret("openai-api-key")).toBe("initial-key");
    expect(await store.setSecret("openai-api-key", "updated-key")).toBe(true);
    expect(await store.getSecret("openai-api-key")).toBe("updated-key");
    expect(await store.deleteSecret("openai-api-key")).toBe(true);
    expect(await store.getSecret("openai-api-key")).toBeNull();
  });

  it("returns false for write/delete when secret APIs are unavailable", async () => {
    const plugin = {
      loadSecret: async () => null
    };
    const store = new PluginSecretStore(plugin as never);

    expect(await store.getSecret("openai-api-key")).toBeNull();
    expect(await store.setSecret("openai-api-key", "ignored")).toBe(false);
    expect(await store.deleteSecret("openai-api-key")).toBe(false);
  });
});
