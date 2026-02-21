import type { App, PluginManifest } from "obsidian";
import ObsidianAIPlugin from "../../main";
import type { ObsidianAICommandId, RuntimeServices } from "../../types";
import type {
  MockPluginRegistrationState,
  MockRegisteredCommand,
  MockRegisteredView
} from "../setup/mockObsidianModule";
import { createMockAppHarness, type MockAppHarness } from "./createMockAppHarness";

interface RuntimeServicesHolder {
  runtimeServices: RuntimeServices | null;
}

const createManifest = (): PluginManifest => {
  return {
    id: "obsidian-ai-mvp",
    name: "Obsidian AI MVP",
    version: "0.0.1",
    minAppVersion: "1.0.0",
    description: "Mock manifest for integration tests",
    author: "test",
    authorUrl: "",
    isDesktopOnly: false
  };
};

export interface PluginTestHarness {
  plugin: ObsidianAIPlugin;
  appHarness: MockAppHarness;
  runOnload: () => Promise<void>;
  runOnunload: () => Promise<void>;
  invokeCommand: (commandId: ObsidianAICommandId) => Promise<void>;
  getRegisteredCommands: () => MockRegisteredCommand[];
  getRegisteredViews: () => MockRegisteredView[];
  getSettingTabCount: () => number;
  getRuntimeServices: () => RuntimeServices | null;
  setRuntimeServices: (services: RuntimeServices | null) => void;
}

export const createPluginTestHarness = (): PluginTestHarness => {
  const appHarness = createMockAppHarness();
  const plugin = new ObsidianAIPlugin(appHarness.app as App, createManifest());

  const getRegistrationState = (): MockPluginRegistrationState => {
    return plugin as unknown as MockPluginRegistrationState;
  };

  const getRuntimeHolder = (): RuntimeServicesHolder => {
    return plugin as unknown as RuntimeServicesHolder;
  };

  const invokeCommand = async (commandId: ObsidianAICommandId): Promise<void> => {
    const command = getRegistrationState().__commands.find((entry) => entry.id === commandId);
    if (!command) {
      throw new Error(`Command is not registered: ${commandId}`);
    }
    await command.callback();
  };

  return {
    plugin,
    appHarness,
    runOnload: async (): Promise<void> => {
      await plugin.onload();
    },
    runOnunload: async (): Promise<void> => {
      await plugin.onunload();
    },
    invokeCommand,
    getRegisteredCommands: (): MockRegisteredCommand[] => {
      return [...getRegistrationState().__commands];
    },
    getRegisteredViews: (): MockRegisteredView[] => {
      return [...getRegistrationState().__views];
    },
    getSettingTabCount: (): number => {
      return getRegistrationState().__settingTabs.length;
    },
    getRuntimeServices: (): RuntimeServices | null => {
      return getRuntimeHolder().runtimeServices;
    },
    setRuntimeServices: (services: RuntimeServices | null): void => {
      getRuntimeHolder().runtimeServices = services;
    }
  };
};
