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

  marked.appendText = function (this: HTMLElement, text: string) {
    this.appendChild(document.createTextNode(text));
  };

  // Obsidian's `createEl` is narrower than our test shim; runtime shape is sufficient for plugin UI tests.
  // @ts-expect-error — assign widened test helper onto HTMLElement for happy-dom
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
      if ('href' in o && (o as { href?: string }).href !== undefined) {
        (c as HTMLAnchorElement).href = String((o as { href?: string }).href);
      }
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
  app: unknown;
  plugin: unknown;
  containerEl: HTMLElement;
  constructor(app: unknown, plugin: unknown) {
    this.app = app;
    this.plugin = plugin;
    const doc = globalThis.document;
    if (!doc) {
      throw new Error('obsidian shim: PluginSettingTab requires a DOM environment (use happy-dom)');
    }
    this.containerEl = doc.createElement('div');
    augmentObsidianElement(this.containerEl);
  }
}

type TextComponent = {
  inputEl: HTMLInputElement;
  setPlaceholder(s: string): TextComponent;
  setValue(v: string): TextComponent;
  onChange(fn: (v: string) => unknown): TextComponent;
};

type TextAreaComponent = {
  setPlaceholder(s: string): TextAreaComponent;
  setValue(v: string): TextAreaComponent;
  onChange(fn: (v: string) => unknown): TextAreaComponent;
};

type ToggleComponent = {
  setValue(v: boolean): ToggleComponent;
  onChange(fn: (v: boolean) => unknown): ToggleComponent;
};

type DropdownComponent = {
  addOption(_v: string, _l: string): DropdownComponent;
  setValue(v: string): DropdownComponent;
  onChange(fn: (v: string) => unknown): DropdownComponent;
};

export class Setting {
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  private wrap: HTMLElement;

  constructor(public containerEl: HTMLElement) {
    const doc = globalThis.document;
    this.wrap = doc.createElement('div');
    this.wrap.className = 'setting-item';
    this.nameEl = doc.createElement('div');
    this.descEl = doc.createElement('div');
    augmentObsidianElement(this.descEl);
    this.controlEl = doc.createElement('div');
    this.wrap.appendChild(this.nameEl);
    this.wrap.appendChild(this.descEl);
    this.wrap.appendChild(this.controlEl);
    containerEl.appendChild(this.wrap);
  }

  setName(t: string): this {
    this.nameEl.textContent = t;
    return this;
  }

  setDesc(t: string): this {
    this.descEl.textContent = t;
    return this;
  }

  addText(cb: (t: TextComponent) => void): this {
    const doc = globalThis.document;
    const input = doc.createElement('input');
    input.type = 'text';
    const api: TextComponent = {
      inputEl: input,
      setPlaceholder(s: string) {
        input.placeholder = s;
        return api;
      },
      setValue(v: string) {
        input.value = v;
        return api;
      },
      onChange(fn: (v: string) => unknown) {
        input.addEventListener('input', () => {
          fn(input.value);
        });
        return api;
      },
    };
    cb(api);
    this.controlEl.appendChild(input);
    return this;
  }

  addTextArea(cb: (t: TextAreaComponent) => void): this {
    const doc = globalThis.document;
    const ta = doc.createElement('textarea');
    const api: TextAreaComponent = {
      setPlaceholder(s: string) {
        ta.placeholder = s;
        return api;
      },
      setValue(v: string) {
        ta.value = v;
        return api;
      },
      onChange(fn: (v: string) => unknown) {
        ta.addEventListener('input', () => fn(ta.value));
        return api;
      },
    };
    cb(api);
    this.controlEl.appendChild(ta);
    return this;
  }

  addToggle(cb: (t: ToggleComponent) => void): this {
    const doc = globalThis.document;
    const input = doc.createElement('input');
    input.type = 'checkbox';
    const api: ToggleComponent = {
      setValue(v: boolean) {
        input.checked = v;
        return api;
      },
      onChange(fn: (v: boolean) => unknown) {
        input.addEventListener('change', () => fn(input.checked));
        return api;
      },
    };
    cb(api);
    this.controlEl.appendChild(input);
    return this;
  }

  addDropdown(cb: (t: DropdownComponent) => void): this {
    const doc = globalThis.document;
    const select = doc.createElement('select');
    const api: DropdownComponent = {
      addOption(v: string, label: string) {
        const o = doc.createElement('option');
        o.value = v;
        o.textContent = label;
        select.appendChild(o);
        return api;
      },
      setValue(v: string) {
        select.value = v;
        return api;
      },
      onChange(fn: (v: string) => unknown) {
        select.addEventListener('change', () => fn(select.value));
        return api;
      },
    };
    cb(api);
    this.controlEl.appendChild(select);
    return this;
  }

  addSlider(_cb: unknown): this {
    return this;
  }
}

export class App {
  /** Minimal stub for settings UI tests (OpenAI key field). */
  secretStorage = {
    getSecret: (_id: string): string | undefined => undefined,
    setSecret: (_id: string, _value: string): void => {},
  };
}

export class TFile {}
export class Vault {}
