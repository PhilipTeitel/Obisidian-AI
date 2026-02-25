import { describe, expect, it } from "vitest";
import { COMMAND_IDS } from "../../constants";
import type { ChatRequest, ChatStreamEvent } from "../../types";
import { createPluginTestHarness } from "../harness/createPluginTestHarness";

const collectChatEvents = async (stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> => {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

describe("core user journeys e2e integration", () => {
  it("covers reindex, index changes, semantic search, chat, and agent note writes", async () => {
    const harness = createPluginTestHarness();
    harness.appHarness.setVaultMarkdownFiles([
      {
        path: "notes/alpha.md",
        markdown: "# Alpha\n\nVector retrieval topic alpha baseline.",
        mtime: 10
      },
      {
        path: "notes/beta.md",
        markdown: "# Beta\n\nVector retrieval topic beta baseline.",
        mtime: 20
      }
    ]);

    await harness.runOnload();
    harness.plugin.settings.agentOutputFolders = ["notes/generated"];

    await harness.invokeCommand(COMMAND_IDS.REINDEX_VAULT);

    harness.appHarness.setVaultMarkdownFiles([
      {
        path: "notes/alpha.md",
        markdown: "# Alpha\n\nVector retrieval topic alpha revised.",
        mtime: 30
      },
      {
        path: "notes/beta.md",
        markdown: "# Beta\n\nVector retrieval topic beta baseline.",
        mtime: 20
      },
      {
        path: "notes/gamma.md",
        markdown: "# Gamma\n\nVector retrieval topic gamma added.",
        mtime: 40
      }
    ]);

    await harness.invokeCommand(COMMAND_IDS.INDEX_CHANGES);

    const runtime = await harness.ensureRuntimeServices();
    const searchResults = await runtime.searchService.search({
      query: "Vector retrieval topic",
      topK: 5
    });
    expect(searchResults.length).toBeGreaterThan(0);

    let providerContextSize = 0;
    runtime.providerRegistry.getChatProvider = () => ({
      id: "openai",
      name: "Mock Integration Chat Provider",
      async *complete(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
        providerContextSize = request.context.length;
        yield {
          type: "token",
          text: "Integration chat response."
        };
        yield {
          type: "done",
          finishReason: "stop"
        };
      }
    });

    const chatEvents = await collectChatEvents(
      runtime.chatService.chat({
        providerId: harness.plugin.settings.chatProvider,
        model: harness.plugin.settings.chatModel,
        messages: [
          {
            role: "user",
            content: "Summarize vector retrieval topic updates."
          }
        ],
        context: [],
        timeoutMs: harness.plugin.settings.chatTimeout
      })
    );

    expect(providerContextSize).toBeGreaterThan(0);
    expect(chatEvents).toEqual([
      {
        type: "token",
        text: "Integration chat response."
      },
      {
        type: "done",
        finishReason: "stop"
      }
    ]);

    await runtime.agentService.createNote("notes/generated/summary.md", "# Summary\n\nDraft content");
    expect(harness.appHarness.getVaultFileContent("notes/generated/summary.md")).toContain("Draft content");

    await runtime.agentService.updateNote("notes/generated/summary.md", "# Summary\n\nUpdated content");
    expect(harness.appHarness.getVaultFileContent("notes/generated/summary.md")).toContain("Updated content");

    const notices = harness.appHarness.getNoticeMessages();
    expect(notices.some((message) => message.startsWith("Reindex vault completed."))).toBe(true);
    expect(notices.some((message) => message.startsWith("Index changes completed."))).toBe(true);
    expect(notices).toContain("Created note: notes/generated/summary.md");
    expect(notices).toContain("Updated note: notes/generated/summary.md");

    await harness.runOnunload();
  });
});
