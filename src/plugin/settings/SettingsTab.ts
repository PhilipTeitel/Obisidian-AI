import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import {
  COMBINED_SYSTEM_PROMPT_TOKEN_BUDGET,
  estimateCombinedBuiltinAndUserPromptTokens,
} from '../../core/domain/chatUserPromptBudget.js';
import { normalizeChatCoarseKFromUserInput } from './chatCoarseK.js';
import { getOpenAIApiKey, setOpenAIApiKey } from './secretSettings.js';
import type { ObsidianAISettings } from './types.js';

type AIPlugin = Plugin & {
  settings: ObsidianAISettings;
  saveSettings(): Promise<void>;
};

export class ObsidianAISettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly aiPlugin: AIPlugin,
  ) {
    super(app, aiPlugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Obsidian AI' });

    const s = this.aiPlugin.settings;

    new Setting(containerEl)
      .setName('Node executable path')
      .setDesc(
        'Absolute path to your Node binary (run `which node` in Terminal). Set this when the sidecar fails to start from Dock/Finder; reload the plugin after changing.',
      )
      .addText((t) =>
        t
          .setPlaceholder('/opt/homebrew/bin/node')
          .setValue(s.nodeExecutablePath)
          .onChange(async (v) => {
            s.nodeExecutablePath = v.trim();
            await this.aiPlugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Enable sidecar inspector')
      .setDesc(
        'Launch the sidecar with `--inspect=0` so you can attach a Node debugger. The inspector URL is printed by the sidecar on stderr; reload the plugin after changing.',
      )
      .addToggle((t) =>
        t.setValue(s.sidecarInspector).onChange(async (v) => {
          s.sidecarInspector = v;
          await this.aiPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Transport')
      .setDesc('stdio (default) or HTTP (127.0.0.1 only; requires sidecar restart).')
      .addDropdown((d) =>
        d
          .addOption('stdio', 'stdio (NDJSON)')
          .addOption('http', 'HTTP + WebSocket')
          .setValue(s.transport)
          .onChange(async (v) => {
            s.transport = v as ObsidianAISettings['transport'];
            await this.aiPlugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Indexed folders')
      .setDesc('One vault-relative path per line. Empty = all folders.')
      .addTextArea((ta) => {
        ta.setValue(s.indexedFolders.join('\n')).onChange(async (v) => {
          s.indexedFolders = v
            .split('\n')
            .map((x) => x.trim())
            .filter(Boolean);
          await this.aiPlugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Excluded folders')
      .setDesc('One path per line; excluded wins over indexed list.')
      .addTextArea((ta) => {
        ta.setValue(s.excludedFolders.join('\n')).onChange(async (v) => {
          s.excludedFolders = v
            .split('\n')
            .map((x) => x.trim())
            .filter(Boolean);
          await this.aiPlugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Agent output folders')
      .setDesc('Allowed folders for future agent writes (§16).')
      .addTextArea((ta) => {
        ta.setValue(s.agentOutputFolders.join('\n')).onChange(async (v) => {
          s.agentOutputFolders = v
            .split('\n')
            .map((x) => x.trim())
            .filter(Boolean);
          if (s.agentOutputFolders.length === 0) s.agentOutputFolders = ['AI-Generated'];
          await this.aiPlugin.saveSettings();
        });
      });

    new Setting(containerEl).setName('Max generated note size (chars)').addText((t) =>
      t.setValue(String(s.maxGeneratedNoteSize)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n > 0) {
          s.maxGeneratedNoteSize = n;
          await this.aiPlugin.saveSettings();
        }
      }),
    );

    new Setting(containerEl)
      .setName('Database path')
      .setDesc('Leave empty for default ~/.obsidian-ai/<vault>.db (ADR-004).')
      .addText((t) =>
        t.setValue(s.dbPath).onChange(async (v) => {
          s.dbPath = v;
          await this.aiPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('OpenAI API key')
      .setDesc('Stored in Obsidian SecretStorage only (never in data.json).')
      .addText((tc) => {
        tc.inputEl.type = 'password';
        tc.setPlaceholder('sk-...');
        tc.setValue(getOpenAIApiKey(this.app) ?? '');
        tc.onChange(async (v) => {
          const t = v.trim();
          if (t) setOpenAIApiKey(this.app, t);
        });
      });

    new Setting(containerEl).setName('Embedding provider').addDropdown((d) =>
      d
        .addOption('openai', 'OpenAI')
        .addOption('ollama', 'Ollama')
        .setValue(s.embeddingProvider)
        .onChange(async (v) => {
          s.embeddingProvider = v as ObsidianAISettings['embeddingProvider'];
          await this.aiPlugin.saveSettings();
        }),
    );

    new Setting(containerEl).setName('Embedding model').addText((t) =>
      t.setValue(s.embeddingModel).onChange(async (v) => {
        s.embeddingModel = v;
        await this.aiPlugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName('Embedding base URL').addText((t) =>
      t.setValue(s.embeddingBaseUrl).onChange(async (v) => {
        s.embeddingBaseUrl = v;
        await this.aiPlugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName('Chat provider').addDropdown((d) =>
      d
        .addOption('openai', 'OpenAI')
        .addOption('ollama', 'Ollama')
        .setValue(s.chatProvider)
        .onChange(async (v) => {
          s.chatProvider = v as ObsidianAISettings['chatProvider'];
          await this.aiPlugin.saveSettings();
        }),
    );

    new Setting(containerEl).setName('Chat model').addText((t) =>
      t.setValue(s.chatModel).onChange(async (v) => {
        s.chatModel = v;
        await this.aiPlugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName('Chat base URL').addText((t) =>
      t.setValue(s.chatBaseUrl).onChange(async (v) => {
        s.chatBaseUrl = v;
        await this.aiPlugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName('Chat timeout (ms)').addText((t) =>
      t.setValue(String(s.chatTimeout)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n > 0) {
          s.chatTimeout = n;
          await this.aiPlugin.saveSettings();
        }
      }),
    );

    new Setting(containerEl).setName('Embedding dimension').addText((t) =>
      t.setValue(String(s.embeddingDimension)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n > 0) {
          s.embeddingDimension = n;
          await this.aiPlugin.saveSettings();
        }
      }),
    );

    new Setting(containerEl).setName('Queue concurrency').addText((t) =>
      t.setValue(String(s.queueConcurrency)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n > 0) {
          s.queueConcurrency = n;
          await this.aiPlugin.saveSettings();
        }
      }),
    );

    new Setting(containerEl).setName('Max retries (queue / job steps)').addText((t) =>
      t.setValue(String(s.maxRetries)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n > 0) {
          s.maxRetries = n;
          await this.aiPlugin.saveSettings();
        }
      }),
    );

    new Setting(containerEl).setName('Sidecar log level').addDropdown((d) =>
      d
        .addOption('debug', 'debug')
        .addOption('info', 'info')
        .addOption('warn', 'warn')
        .addOption('error', 'error')
        .setValue(s.logLevel)
        .onChange(async (v) => {
          s.logLevel = v as ObsidianAISettings['logLevel'];
          await this.aiPlugin.saveSettings();
        }),
    );

    containerEl.createEl('h3', { text: 'Chat grounding' });

    const budgetWarnEl = containerEl.createDiv({ cls: 'mod-warning' });
    budgetWarnEl.style.display = 'none';

    const refreshBudgetBanner = (): void => {
      const over =
        estimateCombinedBuiltinAndUserPromptTokens(s.vaultOrganizationPrompt, s.chatSystemPrompt) >
        COMBINED_SYSTEM_PROMPT_TOKEN_BUDGET;
      if (!over) {
        budgetWarnEl.style.display = 'none';
        budgetWarnEl.empty();
        return;
      }
      budgetWarnEl.style.display = 'block';
      budgetWarnEl.empty();
      budgetWarnEl.appendText(
        'Combined system prompts exceed the budget; user prompts will be truncated at request time. ',
      );
      budgetWarnEl.createEl('a', {
        text: 'Chat behavior tuning guide',
        href: './docs/guides/chat-behavior-tuning.md',
      });
    };
    refreshBudgetBanner();

    let promptDebounce: ReturnType<typeof setTimeout> | null = null;
    const schedulePromptSave = (): void => {
      if (promptDebounce) clearTimeout(promptDebounce);
      promptDebounce = setTimeout(() => {
        promptDebounce = null;
        void this.aiPlugin.saveSettings().then(() => refreshBudgetBanner());
      }, 400);
    };

    const tuningGuideHref = './docs/guides/chat-behavior-tuning.md';

    const vaultOrgSetting = new Setting(containerEl).setName('Vault organization prompt');
    vaultOrgSetting.descEl.appendText(
      'Describe folders, daily notes, tags, and headings so retrieval matches your intent. ',
    );
    vaultOrgSetting.descEl.createEl('a', {
      text: 'Chat behavior tuning guide',
      href: tuningGuideHref,
    });
    vaultOrgSetting.addTextArea((ta) => {
      ta.setPlaceholder('e.g. daily notes in Daily/YYYY-MM-DD.md, job-search tag #job-search');
      ta.setValue(s.vaultOrganizationPrompt).onChange((v) => {
        s.vaultOrganizationPrompt = v;
        refreshBudgetBanner();
        schedulePromptSave();
      });
    });

    const chatSysSetting = new Setting(containerEl).setName('Chat system prompt');
    chatSysSetting.descEl.appendText('Persona, tone, and style (vault-only answers still apply). ');
    chatSysSetting.descEl.createEl('a', {
      text: 'Chat behavior tuning guide',
      href: tuningGuideHref,
    });
    chatSysSetting.addTextArea((ta) => {
      ta.setPlaceholder('e.g. concise bullets, friendly tone');
      ta.setValue(s.chatSystemPrompt).onChange((v) => {
        s.chatSystemPrompt = v;
        refreshBudgetBanner();
        schedulePromptSave();
      });
    });

    containerEl.createEl('h3', { text: 'Retrieval' });

    const coarseWarnEl = containerEl.createDiv({ cls: 'mod-warning' });
    coarseWarnEl.style.minHeight = '1.25em';

    let coarseDebounce: ReturnType<typeof setTimeout> | null = null;
    new Setting(containerEl)
      .setName('Coarse candidate count (chatCoarseK)')
      .setDesc(
        'Phase-1 summary ANN limit (1–256, default 32). Applies to chat and semantic search on the next query; no reindex required.',
      )
      .addText((t) => {
        t.setValue(String(s.chatCoarseK));
        const commit = async () => {
          const { value, warning } = normalizeChatCoarseKFromUserInput(t.getValue());
          s.chatCoarseK = value;
          if (t.getValue().trim() === '') {
            t.setValue(String(value));
          }
          coarseWarnEl.setText(warning ?? '');
          await this.aiPlugin.saveSettings();
        };
        t.inputEl.addEventListener('blur', () => {
          void commit();
        });
        t.onChange(() => {
          if (coarseDebounce) clearTimeout(coarseDebounce);
          coarseDebounce = setTimeout(() => {
            coarseDebounce = null;
            void commit();
          }, 400);
        });
      });

    new Setting(containerEl)
      .setName('Enable hybrid keyword + vector retrieval')
      .setDesc(
        'Phase-1 merges summary-vector ANN with SQLite FTS5 (BM25) via reciprocal rank fusion. Requires FTS5 populated (reindex after enabling STO-4 migrations if keyword search is empty).',
      )
      .addToggle((tg) =>
        tg.setValue(s.enableHybridSearch).onChange(async (v) => {
          s.enableHybridSearch = v;
          await this.aiPlugin.saveSettings();
        }),
      );

    containerEl.createEl('h4', { text: 'Advanced retrieval — daily notes' });

    new Setting(containerEl)
      .setName('Daily note path globs')
      .setDesc(
        'One vault-relative glob per line (default Daily/**/*.md). Used when indexing to parse dates from filenames into note_meta.note_date. Reindex after changing.',
      )
      .addTextArea((ta) => {
        ta.setValue(s.dailyNotePathGlobs.join('\n')).onChange(async (v) => {
          const lines = v
            .split('\n')
            .map((x) => x.trim())
            .filter(Boolean);
          s.dailyNotePathGlobs = lines.length > 0 ? lines : ['Daily/**/*.md'];
          await this.aiPlugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Daily note date pattern')
      .setDesc('Filename stem pattern using tokens YYYY, MM, DD (e.g. YYYY-MM-DD).')
      .addText((t) =>
        t.setValue(s.dailyNoteDatePattern).onChange(async (v) => {
          const x = v.trim();
          s.dailyNoteDatePattern = x.length > 0 ? x : 'YYYY-MM-DD';
          await this.aiPlugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName('Search result count (k)').addText((t) =>
      t.setValue(String(s.searchResultCount)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n > 0) {
          s.searchResultCount = n;
          await this.aiPlugin.saveSettings();
        }
      }),
    );

    new Setting(containerEl).setName('Matched content budget').addText((t) =>
      t.setValue(String(s.matchedContentBudget)).onChange(async (v) => {
        const n = parseFloat(v);
        if (Number.isFinite(n) && n > 0 && n < 1) {
          s.matchedContentBudget = n;
          await this.aiPlugin.saveSettings();
        }
      }),
    );

    new Setting(containerEl).setName('Sibling context budget').addText((t) =>
      t.setValue(String(s.siblingContextBudget)).onChange(async (v) => {
        const n = parseFloat(v);
        if (Number.isFinite(n) && n > 0 && n < 1) {
          s.siblingContextBudget = n;
          await this.aiPlugin.saveSettings();
        }
      }),
    );

    new Setting(containerEl).setName('Parent summary budget').addText((t) =>
      t.setValue(String(s.parentSummaryBudget)).onChange(async (v) => {
        const n = parseFloat(v);
        if (Number.isFinite(n) && n > 0 && n < 1) {
          s.parentSummaryBudget = n;
          await this.aiPlugin.saveSettings();
        }
      }),
    );
  }
}
