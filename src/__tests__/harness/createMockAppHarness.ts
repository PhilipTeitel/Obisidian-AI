import { MarkdownView, type App } from "obsidian";
import { MockDomElement, getNoticeMessages } from "../setup/mockObsidianModule";

interface ViewState {
  type: string;
  active: boolean;
}

export interface MockWorkspaceLeafLike {
  state: ViewState | null;
  detached: boolean;
  setViewState(state: ViewState): Promise<void>;
  detach(): Promise<void>;
}

export interface MockWorkspaceLike {
  containerEl: MockDomElement;
  getLeavesOfType: (viewType: string) => MockWorkspaceLeafLike[];
  getRightLeaf: (_split: boolean) => MockWorkspaceLeafLike | null;
  revealLeaf: (leaf: MockWorkspaceLeafLike) => void;
  openLinkText: (linktext: string, sourcePath: string, newLeaf?: boolean) => Promise<void>;
  getActiveViewOfType: (viewClass: typeof MarkdownView) => MarkdownView | null;
}

export interface MockAppHarness {
  app: App;
  workspace: MockWorkspaceLike;
  rightLeaf: MockWorkspaceLeafLike | null;
  setSelection: (selection: string) => void;
  clearSelection: () => void;
  setVaultMarkdownFiles: (files: MockVaultMarkdownSeed[]) => void;
  getNoticeMessages: () => string[];
  getRevealedLeaves: () => MockWorkspaceLeafLike[];
  getLeavesForType: (viewType: string) => MockWorkspaceLeafLike[];
  getOpenedLinks: () => Array<{ linktext: string; sourcePath: string; newLeaf?: boolean }>;
}

export interface MockVaultMarkdownSeed {
  path: string;
  markdown: string;
  mtime?: number;
  basename?: string;
}

interface MockVaultMarkdownFile {
  path: string;
  basename: string;
  stat: {
    mtime: number;
  };
}

const inferBasename = (path: string): string => {
  const fileName = path.split("/").pop() ?? path;
  return fileName.replace(/\.md$/i, "");
};

export const createMockAppHarness = (): MockAppHarness => {
  const leavesByType = new Map<string, MockWorkspaceLeafLike[]>();
  const revealedLeaves: MockWorkspaceLeafLike[] = [];
  const openedLinks: Array<{ linktext: string; sourcePath: string; newLeaf?: boolean }> = [];
  const markdownContentByPath = new Map<string, string>();
  let markdownFiles: MockVaultMarkdownFile[] = [];
  let activeSelection = "";

  const registerLeafType = (viewType: string, leaf: MockWorkspaceLeafLike): void => {
    const existing = leavesByType.get(viewType) ?? [];
    if (!existing.includes(leaf)) {
      existing.push(leaf);
      leavesByType.set(viewType, existing);
    }
  };

  const removeLeafFromTypes = (leaf: MockWorkspaceLeafLike): void => {
    for (const [viewType, leaves] of leavesByType.entries()) {
      const nextLeaves = leaves.filter((entry) => entry !== leaf);
      if (nextLeaves.length === 0) {
        leavesByType.delete(viewType);
      } else {
        leavesByType.set(viewType, nextLeaves);
      }
    }
  };

  const createLeaf = (): MockWorkspaceLeafLike => {
    const leaf: MockWorkspaceLeafLike = {
      state: null,
      detached: false,
      setViewState: async (state: ViewState): Promise<void> => {
        leaf.state = state;
        registerLeafType(state.type, leaf);
      },
      detach: async (): Promise<void> => {
        leaf.detached = true;
        removeLeafFromTypes(leaf);
      }
    };
    return leaf;
  };

  const rightLeaf = createLeaf();

  const workspace: MockWorkspaceLike = {
    containerEl: new MockDomElement("div"),
    getLeavesOfType: (viewType: string): MockWorkspaceLeafLike[] => {
      return [...(leavesByType.get(viewType) ?? [])];
    },
    getRightLeaf: (): MockWorkspaceLeafLike | null => {
      return rightLeaf;
    },
    revealLeaf: (leaf: MockWorkspaceLeafLike): void => {
      revealedLeaves.push(leaf);
    },
    openLinkText: async (linktext: string, sourcePath: string, newLeaf?: boolean): Promise<void> => {
      openedLinks.push({ linktext, sourcePath, newLeaf });
    },
    getActiveViewOfType: (viewClass: typeof MarkdownView): MarkdownView | null => {
      void viewClass;
      return {
        editor: {
          getSelection: () => activeSelection
        }
      } as unknown as MarkdownView;
    }
  };

  const vault = {
    getMarkdownFiles: (): MockVaultMarkdownFile[] => {
      return [...markdownFiles];
    },
    cachedRead: async (file: MockVaultMarkdownFile): Promise<string> => {
      return markdownContentByPath.get(file.path) ?? "";
    }
  };

  const app = {
    workspace,
    vault
  } as unknown as App;

  return {
    app,
    workspace,
    rightLeaf,
    setSelection: (selection: string): void => {
      activeSelection = selection;
    },
    clearSelection: (): void => {
      activeSelection = "";
    },
    setVaultMarkdownFiles: (files: MockVaultMarkdownSeed[]): void => {
      markdownContentByPath.clear();
      markdownFiles = files.map((file, index) => {
        const mtime = file.mtime ?? Date.now() + index;
        const basename = file.basename ?? inferBasename(file.path);
        markdownContentByPath.set(file.path, file.markdown);
        return {
          path: file.path,
          basename,
          stat: {
            mtime
          }
        };
      });
    },
    getNoticeMessages: (): string[] => {
      return getNoticeMessages();
    },
    getRevealedLeaves: (): MockWorkspaceLeafLike[] => {
      return [...revealedLeaves];
    },
    getLeavesForType: (viewType: string): MockWorkspaceLeafLike[] => {
      return [...(leavesByType.get(viewType) ?? [])];
    },
    getOpenedLinks: (): Array<{ linktext: string; sourcePath: string; newLeaf?: boolean }> => {
      return [...openedLinks];
    }
  };
};
