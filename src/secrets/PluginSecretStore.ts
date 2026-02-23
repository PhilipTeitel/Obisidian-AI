import type { RuntimeBootstrapContext, SecretStoreContract } from "../types";

interface SecretCapablePlugin {
  loadSecret: (key: string) => Promise<string | null>;
}

const supportsSecretLoading = (plugin: RuntimeBootstrapContext["plugin"]): plugin is RuntimeBootstrapContext["plugin"] &
  SecretCapablePlugin => {
  return typeof (plugin as Partial<SecretCapablePlugin>).loadSecret === "function";
};

export class PluginSecretStore implements SecretStoreContract {
  private readonly plugin: RuntimeBootstrapContext["plugin"];

  public constructor(plugin: RuntimeBootstrapContext["plugin"]) {
    this.plugin = plugin;
  }

  public async getSecret(key: string): Promise<string | null> {
    if (!supportsSecretLoading(this.plugin)) {
      return null;
    }
    const value = await this.plugin.loadSecret(key);
    if (!value || value.trim().length === 0) {
      return null;
    }
    return value;
  }
}
