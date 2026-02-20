import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { ObsidianAISettings } from "./types";

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
  chatTimeout: 30000
};

const parseCsvList = (value: string): string[] => {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

const formatCsvList = (values: string[]): string => values.join(", ");

export class ObsidianAISettingTab extends PluginSettingTab {
  private readonly plugin: SettingsHostPlugin;

  public constructor(app: App, plugin: SettingsHostPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  public display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Obsidian AI MVP" });
    containerEl.createEl("p", {
      text: "Runtime shell settings for FND-2. Provider integration and indexing logic are added in later stories."
    });

    new Setting(containerEl)
      .setName("Embedding provider")
      .setDesc("Placeholder provider choice for upcoming embedding service wiring.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("openai", "OpenAI")
          .addOption("ollama", "Ollama")
          .setValue(this.plugin.settings.embeddingProvider)
          .onChange(async (value) => {
            this.plugin.settings.embeddingProvider = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Chat provider")
      .setDesc("Placeholder provider choice for upcoming chat service wiring.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("openai", "OpenAI")
          .addOption("ollama", "Ollama")
          .setValue(this.plugin.settings.chatProvider)
          .onChange(async (value) => {
            this.plugin.settings.chatProvider = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Indexed folders")
      .setDesc("Comma-separated vault paths included in indexing.")
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
      .setName("Agent output folders")
      .setDesc("Comma-separated vault paths where the agent can create or update notes.")
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
      .setDesc("Maximum characters allowed when creating or updating notes from chat.")
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
      .setDesc("Maximum time to wait for chat responses.")
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

    containerEl.createEl("p", {
      text: "Secrets are intentionally excluded from plugin settings and should be stored in Obsidian's keychain."
    });
  }
}
