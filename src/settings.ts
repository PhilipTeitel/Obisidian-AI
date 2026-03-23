import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { PluginSecretStore } from "./secrets/PluginSecretStore";
import { MVP_PROVIDER_IDS, type MVPProviderId, type ObsidianAISettings, type RuntimeLogLevel } from "./types";

type SettingsHostPlugin = Plugin & {
  settings: ObsidianAISettings;
  saveSettings: () => Promise<void>;
};

export const DEFAULT_SETTINGS: ObsidianAISettings = {
  embeddingProvider: "openai",
  chatProvider: "openai",
  embeddingModel: "text-embedding-3-small",
  chatModel: "gpt-4o-mini",
  ollamaEndpoint: "http://localhost:11434",
  openaiEndpoint: "https://api.openai.com/v1",
  indexedFolders: ["/"],
  excludedFolders: [],
  agentOutputFolders: [],
  maxGeneratedNoteSize: 5000,
  chatTimeout: 30000,
  logLevel: "info",
  summaryMaxTokens: 100,
  matchedContentBudget: 2000,
  siblingContextBudget: 1000,
  parentSummaryBudget: 1000
};

export const snapshotSettings = (settings: ObsidianAISettings): ObsidianAISettings => {
  return {
    ...settings,
    indexedFolders: [...settings.indexedFolders],
    excludedFolders: [...settings.excludedFolders],
    agentOutputFolders: [...settings.agentOutputFolders]
  };
};

const parseCsvList = (value: string): string[] => {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

const formatCsvList = (values: string[]): string => values.join(", ");

const PROVIDER_LABELS: Record<MVPProviderId, string> = {
  openai: "OpenAI",
  ollama: "Ollama"
};

const LOG_LEVEL_OPTIONS: Record<RuntimeLogLevel, string> = {
  debug: "Debug",
  info: "Info",
  warn: "Warn",
  error: "Error"
};

const toKnownLogLevel = (value: string): RuntimeLogLevel => {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return "info";
};

const toKnownProviderId = (value: string): MVPProviderId => {
  if (MVP_PROVIDER_IDS.includes(value as MVPProviderId)) {
    return value as MVPProviderId;
  }
  return "openai";
};

export class ObsidianAISettingTab extends PluginSettingTab {
  private readonly plugin: SettingsHostPlugin;
  private readonly secretStore: PluginSecretStore;

  public constructor(app: App, plugin: SettingsHostPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.secretStore = new PluginSecretStore(plugin);
  }

  public display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Obsidian AI MVP" });
    containerEl.createEl("p", {
      text: "Configure providers, indexing scope, and guardrails for local semantic search and chat."
    });

    new Setting(containerEl)
      .setName("Embedding provider")
      .setDesc("Provider used to generate embeddings for indexing and query vectors.")
      .addDropdown((dropdown) => {
        for (const providerId of MVP_PROVIDER_IDS) {
          dropdown.addOption(providerId, PROVIDER_LABELS[providerId]);
        }

        dropdown
          .setValue(toKnownProviderId(this.plugin.settings.embeddingProvider))
          .onChange(async (value) => {
            this.plugin.settings.embeddingProvider = toKnownProviderId(value);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Embedding model")
      .setDesc("Model name used for embedding generation.")
      .addText((text) => {
        text
          .setPlaceholder("text-embedding-3-small")
          .setValue(this.plugin.settings.embeddingModel)
          .onChange(async (value) => {
            this.plugin.settings.embeddingModel = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Chat provider")
      .setDesc("Provider used for streamed chat completions.")
      .addDropdown((dropdown) => {
        for (const providerId of MVP_PROVIDER_IDS) {
          dropdown.addOption(providerId, PROVIDER_LABELS[providerId]);
        }

        dropdown
          .setValue(toKnownProviderId(this.plugin.settings.chatProvider))
          .onChange(async (value) => {
            this.plugin.settings.chatProvider = toKnownProviderId(value);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Chat model")
      .setDesc("Model name used for chat completions.")
      .addText((text) => {
        text
          .setPlaceholder("gpt-4o-mini")
          .setValue(this.plugin.settings.chatModel)
          .onChange(async (value) => {
            this.plugin.settings.chatModel = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("OpenAI endpoint")
      .setDesc("Base API URL for OpenAI-compatible requests.")
      .addText((text) => {
        text
          .setPlaceholder("https://api.openai.com/v1")
          .setValue(this.plugin.settings.openaiEndpoint)
          .onChange(async (value) => {
            this.plugin.settings.openaiEndpoint = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Ollama endpoint")
      .setDesc("Base API URL for Ollama requests.")
      .addText((text) => {
        text
          .setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.ollamaEndpoint)
          .onChange(async (value) => {
            this.plugin.settings.ollamaEndpoint = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Indexed folders")
      .setDesc("Comma-separated vault paths included in indexing scope.")
      .addText((text) => {
        text
          .setPlaceholder("/")
          .setValue(formatCsvList(this.plugin.settings.indexedFolders))
          .onChange(async (value) => {
            this.plugin.settings.indexedFolders = parseCsvList(value);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Excluded folders")
      .setDesc("Comma-separated folders excluded from indexing even if included above.")
      .addText((text) => {
        text
          .setPlaceholder("templates, archive")
          .setValue(formatCsvList(this.plugin.settings.excludedFolders))
          .onChange(async (value) => {
            this.plugin.settings.excludedFolders = parseCsvList(value);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Agent output folders")
      .setDesc("Comma-separated vault paths where the chat agent can create or update notes.")
      .addText((text) => {
        text
          .setPlaceholder("projects/notes")
          .setValue(formatCsvList(this.plugin.settings.agentOutputFolders))
          .onChange(async (value) => {
            this.plugin.settings.agentOutputFolders = parseCsvList(value);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Max generated note size")
      .setDesc("Maximum characters allowed when the chat agent creates or updates notes.")
      .addText((text) => {
        text
          .setPlaceholder("5000")
          .setValue(String(this.plugin.settings.maxGeneratedNoteSize))
          .onChange(async (value) => {
            const parsedValue = Number.parseInt(value, 10);
            if (Number.isFinite(parsedValue) && parsedValue > 0) {
              this.plugin.settings.maxGeneratedNoteSize = parsedValue;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName("Chat timeout (ms)")
      .setDesc("Maximum time to wait for chat responses (default 30000ms).")
      .addText((text) => {
        text
          .setPlaceholder("30000")
          .setValue(String(this.plugin.settings.chatTimeout))
          .onChange(async (value) => {
            const parsedValue = Number.parseInt(value, 10);
            if (Number.isFinite(parsedValue) && parsedValue > 0) {
              this.plugin.settings.chatTimeout = parsedValue;
              await this.plugin.saveSettings();
            }
          });
      });

    containerEl.createEl("h3", { text: "Hierarchical Indexing" });

    new Setting(containerEl)
      .setName("Summary max tokens")
      .setDesc("Maximum tokens for LLM-generated summaries of document nodes.")
      .addText((text) => {
        text
          .setPlaceholder("100")
          .setValue(String(this.plugin.settings.summaryMaxTokens))
          .onChange(async (value) => {
            const parsedValue = Number.parseInt(value, 10);
            if (Number.isFinite(parsedValue) && parsedValue > 0) {
              this.plugin.settings.summaryMaxTokens = parsedValue;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName("Matched content budget")
      .setDesc("Token budget for matched content in hierarchical retrieval context assembly.")
      .addText((text) => {
        text
          .setPlaceholder("2000")
          .setValue(String(this.plugin.settings.matchedContentBudget))
          .onChange(async (value) => {
            const parsedValue = Number.parseInt(value, 10);
            if (Number.isFinite(parsedValue) && parsedValue > 0) {
              this.plugin.settings.matchedContentBudget = parsedValue;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName("Sibling context budget")
      .setDesc("Token budget for sibling context in hierarchical retrieval context assembly.")
      .addText((text) => {
        text
          .setPlaceholder("1000")
          .setValue(String(this.plugin.settings.siblingContextBudget))
          .onChange(async (value) => {
            const parsedValue = Number.parseInt(value, 10);
            if (Number.isFinite(parsedValue) && parsedValue > 0) {
              this.plugin.settings.siblingContextBudget = parsedValue;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName("Parent summary budget")
      .setDesc("Token budget for parent summaries in hierarchical retrieval context assembly.")
      .addText((text) => {
        text
          .setPlaceholder("1000")
          .setValue(String(this.plugin.settings.parentSummaryBudget))
          .onChange(async (value) => {
            const parsedValue = Number.parseInt(value, 10);
            if (Number.isFinite(parsedValue) && parsedValue > 0) {
              this.plugin.settings.parentSummaryBudget = parsedValue;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName("Log level")
      .setDesc("Minimum log severity emitted to the runtime console.")
      .addDropdown((dropdown) => {
        for (const [level, label] of Object.entries(LOG_LEVEL_OPTIONS) as Array<[RuntimeLogLevel, string]>) {
          dropdown.addOption(level, label);
        }
        dropdown.setValue(toKnownLogLevel(this.plugin.settings.logLevel)).onChange(async (value) => {
          this.plugin.settings.logLevel = toKnownLogLevel(value);
          await this.plugin.saveSettings();
        });
      });

    let pendingOpenAIApiKey = "";
    new Setting(containerEl)
      .setName("OpenAI API key")
      .setDesc("Stored in Obsidian keychain only. It is never written to plugin settings data.")
      .addText((text) => {
        text.setPlaceholder("sk-...").onChange((value) => {
          pendingOpenAIApiKey = value.trim();
        });
      })
      .addButton((button) => {
        button.setButtonText("Save").onClick(async () => {
          if (pendingOpenAIApiKey.length === 0) {
            new Notice("Enter an OpenAI API key before saving.");
            return;
          }
          const saved = await this.secretStore.setSecret("openai-api-key", pendingOpenAIApiKey);
          if (!saved) {
            new Notice("Unable to save API key: Secret storage is unavailable in this environment.");
            return;
          }
          pendingOpenAIApiKey = "";
          new Notice("OpenAI API key saved to Obsidian keychain.");
          this.display();
        });
      })
      .addButton((button) => {
        button.setButtonText("Clear").onClick(async () => {
          const removed = await this.secretStore.deleteSecret("openai-api-key");
          if (!removed) {
            new Notice("Unable to clear API key: Secret storage is unavailable in this environment.");
            return;
          }
          pendingOpenAIApiKey = "";
          new Notice("OpenAI API key removed from Obsidian keychain.");
          this.display();
        });
      });

    const secretStatusEl = containerEl.createEl("p", {
      text: "OpenAI API key status: checking keychain..."
    });
    void this.secretStore.getSecret("openai-api-key").then((secret) => {
      const configured = secret !== null && secret.length > 0;
      secretStatusEl.setText(configured ? "OpenAI API key status: configured in keychain." : "OpenAI API key status: not set.");
    });
  }
}
