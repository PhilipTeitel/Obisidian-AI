import { beforeEach } from "vitest";

type ViewState = {
  type: string;
  active: boolean;
};

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  description: string;
  author: string;
  authorUrl: string;
  isDesktopOnly: boolean;
}

export interface EditorLike {
  getSelection: () => string;
}

export interface MockRegisteredView {
  type: string;
  viewCreator: (leaf: WorkspaceLeaf) => unknown;
}

export interface MockRegisteredCommand {
  id: string;
  name: string;
  callback: () => Promise<void> | void;
}

export interface MockPluginRegistrationState {
  __views: MockRegisteredView[];
  __commands: MockRegisteredCommand[];
  __settingTabs: unknown[];
}

interface MockDomElementOptions {
  text?: string;
  cls?: string;
}

export class MockDomElement {
  public readonly children: MockDomElement[] = [];
  public readonly style: { display: string } = { display: "block" };
  public readonly dataset: Record<string, string> = {};
  public textContent = "";
  public className = "";
  private parent: MockDomElement | null = null;

  public constructor(public readonly tagName: string, options?: MockDomElementOptions) {
    if (options?.text) {
      this.textContent = options.text;
    }
    if (options?.cls) {
      this.className = options.cls;
    }
  }

  public createEl(tagName: string, options?: MockDomElementOptions): MockDomElement {
    const child = new MockDomElement(tagName, options);
    child.parent = this;
    this.children.push(child);
    return child;
  }

  public createDiv(options?: MockDomElementOptions): MockDomElement {
    return this.createEl("div", options);
  }

  public empty(): void {
    this.children.length = 0;
    this.textContent = "";
  }

  public setText(value: string): void {
    this.textContent = value;
  }

  public querySelector(selector: string): MockDomElement | null {
    if (!selector.startsWith(".")) {
      throw new Error(`MockDomElement.querySelector only supports class selectors. Received: ${selector}`);
    }
    const className = selector.slice(1);
    return this.findByClassName(className);
  }

  public remove(): void {
    if (!this.parent) {
      return;
    }
    const index = this.parent.children.indexOf(this);
    if (index >= 0) {
      this.parent.children.splice(index, 1);
    }
    this.parent = null;
  }

  private findByClassName(className: string): MockDomElement | null {
    for (const child of this.children) {
      if (child.className.split(/\s+/).includes(className)) {
        return child;
      }
      const nested = child.findByClassName(className);
      if (nested) {
        return nested;
      }
    }
    return null;
  }
}

const noticeMessages: string[] = [];

export const getNoticeMessages = (): string[] => {
  return [...noticeMessages];
};

export const clearNoticeMessages = (): void => {
  noticeMessages.length = 0;
};

const setWindowShim = (): void => {
  const globalObject = globalThis as unknown as {
    window?: {
      setTimeout: typeof setTimeout;
      clearTimeout: typeof clearTimeout;
    };
  };
  if (!globalObject.window) {
    globalObject.window = {
      setTimeout: setTimeout.bind(globalThis),
      clearTimeout: clearTimeout.bind(globalThis)
    };
  }
};

const setFetchShim = (): void => {
  const globalObject = globalThis as unknown as {
    fetch?: typeof fetch;
  };

  globalObject.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const bodyText = typeof init?.body === "string" ? init.body : "";
    let inputCount = 1;
    if (bodyText.length > 0) {
      try {
        const parsedBody = JSON.parse(bodyText) as Record<string, unknown>;
        if (Array.isArray(parsedBody.input)) {
          inputCount = parsedBody.input.length;
        }
      } catch {
        inputCount = 1;
      }
    }

    if (url.includes("/embeddings")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: Array.from({ length: inputCount }, () => ({ embedding: [0.1, 0.2] }))
        })
      } as Response;
    }

    if (url.includes("/api/embed")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          embeddings: Array.from({ length: inputCount }, () => [0.1, 0.2])
        })
      } as Response;
    }

    return {
      ok: false,
      status: 404,
      json: async () => ({})
    } as Response;
  }) as typeof fetch;
};

setWindowShim();
setFetchShim();

beforeEach(() => {
  clearNoticeMessages();
});

export class WorkspaceLeaf {
  public state: ViewState | null = null;
  public detached = false;

  public async setViewState(state: ViewState): Promise<void> {
    this.state = state;
  }

  public async detach(): Promise<void> {
    this.detached = true;
  }
}

export class MarkdownView {
  public readonly editor: EditorLike;

  public constructor(selection = "") {
    this.editor = {
      getSelection: () => selection
    };
  }
}

export class ItemView {
  public readonly contentEl = new MockDomElement("div");

  public constructor(public readonly leaf: WorkspaceLeaf) {}
}

export class Notice {
  public constructor(message: string) {
    noticeMessages.push(message);
  }
}

export class Plugin {
  public readonly __views: MockRegisteredView[] = [];
  public readonly __commands: MockRegisteredCommand[] = [];
  public readonly __settingTabs: unknown[] = [];
  private data: unknown = null;
  private readonly secrets = new Map<string, string>([["openai-api-key", "test-openai-api-key"]]);

  public constructor(public readonly app: unknown, public readonly manifest: unknown) {}

  public registerView(type: string, viewCreator: (leaf: WorkspaceLeaf) => unknown): void {
    this.__views.push({ type, viewCreator });
  }

  public addSettingTab(settingTab: unknown): void {
    this.__settingTabs.push(settingTab);
  }

  public addCommand(command: MockRegisteredCommand): void {
    this.__commands.push(command);
  }

  public async loadData(): Promise<unknown> {
    return this.data;
  }

  public async saveData(data: unknown): Promise<void> {
    this.data = data;
  }

  public async loadSecret(key: string): Promise<string | null> {
    return this.secrets.get(key) ?? null;
  }

  public async saveSecret(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  public async deleteSecret(key: string): Promise<void> {
    this.secrets.delete(key);
  }
}

export class PluginSettingTab {
  public readonly containerEl = new MockDomElement("div");

  public constructor(public readonly app: unknown, public readonly plugin: unknown) {}
}

class DropdownComponent {
  public addOption(value: string, label: string): this {
    void value;
    void label;
    return this;
  }

  public setValue(value: string): this {
    void value;
    return this;
  }

  public onChange(callback: (value: string) => void | Promise<void>): this {
    void callback;
    return this;
  }
}

class TextComponent {
  public setPlaceholder(value: string): this {
    void value;
    return this;
  }

  public setValue(value: string): this {
    void value;
    return this;
  }

  public onChange(callback: (value: string) => void | Promise<void>): this {
    void callback;
    return this;
  }
}

class ButtonComponent {
  public setButtonText(value: string): this {
    void value;
    return this;
  }

  public onClick(callback: () => void | Promise<void>): this {
    void callback;
    return this;
  }
}

export class Setting {
  public constructor(containerEl: MockDomElement) {
    if (!containerEl) {
      throw new Error("Setting requires a container element.");
    }
  }

  public setName(name: string): this {
    void name;
    return this;
  }

  public setDesc(description: string): this {
    void description;
    return this;
  }

  public addDropdown(callback: (dropdown: DropdownComponent) => unknown): this {
    callback(new DropdownComponent());
    return this;
  }

  public addText(callback: (text: TextComponent) => unknown): this {
    callback(new TextComponent());
    return this;
  }

  public addButton(callback: (button: ButtonComponent) => unknown): this {
    callback(new ButtonComponent());
    return this;
  }
}

export class App {
  public constructor(public readonly workspace: unknown) {}
}
