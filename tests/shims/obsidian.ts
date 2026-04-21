/**
 * Vitest shim: the published `obsidian` package ships types only (`main` is empty), so Vite cannot
 * resolve it for plugin UI tests. Re-export minimal runtime stubs for modules under test.
 */

function augmentObsidianElement(el: HTMLElement): void {
  const marked = el as HTMLElement & { __obsidianAiAugmented?: boolean };
  if (marked.__obsidianAiAugmented) return;
  marked.__obsidianAiAugmented = true;

  marked.empty = function (this: HTMLElement) {
    this.replaceChildren();
  };

  marked.createDiv = function (this: HTMLElement, opts?: { cls?: string }) {
    const d = document.createElement('div');
    if (opts?.cls) d.className = opts.cls;
    augmentObsidianElement(d);
    this.appendChild(d);
    return d;
  };

  marked.createSpan = function (this: HTMLElement, opts?: { text?: string; cls?: string }) {
    const s = document.createElement('span');
    if (opts?.text !== undefined) s.textContent = opts.text;
    if (opts?.cls) s.className = opts.cls;
    augmentObsidianElement(s);
    this.appendChild(s);
    return s;
  };

  marked.createEl = function (
    this: HTMLElement,
    tag: string,
    o?: string | { text?: string; cls?: string; attr?: Record<string, string | number> },
  ) {
    const c = document.createElement(tag);
    if (typeof o === 'string') c.className = o;
    else if (o) {
      if (o.text !== undefined) c.textContent = String(o.text);
      if (o.cls) c.className = o.cls;
      if (o.attr) {
        for (const [k, v] of Object.entries(o.attr)) c.setAttribute(k, String(v));
      }
    }
    augmentObsidianElement(c);
    this.appendChild(c);
    return c;
  };
}

export class Notice {
  constructor(_message?: string, _duration?: number) {}
}

export class ItemView {
  contentEl: HTMLElement;
  containerEl: HTMLElement;
  app: { workspace: { openLinkText: (...args: unknown[]) => Promise<unknown> | unknown } };
  constructor(_leaf: unknown) {
    const doc = globalThis.document;
    if (!doc) {
      throw new Error('obsidian shim: ItemView requires a DOM environment (use happy-dom)');
    }
    this.contentEl = doc.createElement('div');
    this.containerEl = doc.createElement('div');
    augmentObsidianElement(this.contentEl);
    augmentObsidianElement(this.containerEl);
    this.app = { workspace: { openLinkText: async () => undefined } };
  }
}

export class WorkspaceLeaf {}

export class Plugin {
  app!: unknown;
  manifest!: unknown;
  async loadData(): Promise<unknown> {
    return {};
  }
  async saveData(_data: unknown): Promise<void> {}
  addSettingTab(_tab: unknown): void {}
  registerView(_type: string, _factory: unknown): void {}
}

export class PluginSettingTab {
  constructor(_app: unknown, _plugin: unknown) {}
}

export class Setting {
  setName(_n: string): Setting {
    return this;
  }
  setDesc(_d: string): Setting {
    return this;
  }
  addText(_cb: unknown): Setting {
    return this;
  }
  addToggle(_cb: unknown): Setting {
    return this;
  }
  addDropdown(_cb: unknown): Setting {
    return this;
  }
  addSlider(_cb: unknown): Setting {
    return this;
  }
}

export class App {}

export class TFile {}
export class Vault {}
