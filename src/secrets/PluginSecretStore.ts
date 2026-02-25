import type { RuntimeBootstrapContext, SecretStoreContract } from "../types";

interface SecretCapablePlugin {
  loadSecret: (key: string) => Promise<string | null>;
}

interface SecretWritablePlugin {
  saveSecret: (key: string, value: string) => Promise<void>;
}

interface SecretDeleteCapablePlugin {
  deleteSecret?: (key: string) => Promise<void>;
  removeSecret?: (key: string) => Promise<void>;
}

const supportsSecretLoading = (plugin: RuntimeBootstrapContext["plugin"]): plugin is RuntimeBootstrapContext["plugin"] &
  SecretCapablePlugin => {
  return typeof (plugin as Partial<SecretCapablePlugin>).loadSecret === "function";
};

const supportsSecretSaving = (plugin: RuntimeBootstrapContext["plugin"]): plugin is RuntimeBootstrapContext["plugin"] &
  SecretWritablePlugin => {
  return typeof (plugin as Partial<SecretWritablePlugin>).saveSecret === "function";
};

const supportsSecretDeletion = (plugin: RuntimeBootstrapContext["plugin"]): plugin is RuntimeBootstrapContext["plugin"] &
  SecretDeleteCapablePlugin => {
  const deleteCapable = plugin as Partial<SecretDeleteCapablePlugin>;
  return typeof deleteCapable.deleteSecret === "function" || typeof deleteCapable.removeSecret === "function";
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

  public async setSecret(key: string, value: string): Promise<boolean> {
    if (!supportsSecretSaving(this.plugin)) {
      return false;
    }
    await this.plugin.saveSecret(key, value);
    return true;
  }

  public async deleteSecret(key: string): Promise<boolean> {
    if (supportsSecretDeletion(this.plugin)) {
      if (typeof this.plugin.deleteSecret === "function") {
        await this.plugin.deleteSecret(key);
        return true;
      }
      if (typeof this.plugin.removeSecret === "function") {
        await this.plugin.removeSecret(key);
        return true;
      }
    }

    if (!supportsSecretSaving(this.plugin)) {
      return false;
    }

    await this.plugin.saveSecret(key, "");
    return true;
  }
}
