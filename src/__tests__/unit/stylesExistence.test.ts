import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesPath = resolve(__dirname, "../../../styles.css");

const readStyles = (): string => {
  return readFileSync(stylesPath, "utf-8");
};

describe("UX-1 styles.css", () => {
  /* ====================================================================
     Phase A: File Existence and Design Tokens
     ==================================================================== */

  it("A1_styles_css_exists_at_project_root", () => {
    const css = readStyles();
    expect(css.length).toBeGreaterThan(0);
  });

  it("A2_design_tokens_reference_obsidian_variables", () => {
    const css = readStyles();

    const expectedTokens = [
      "--obsidian-ai-bg-primary",
      "--obsidian-ai-bg-card",
      "--obsidian-ai-bg-user-bubble",
      "--obsidian-ai-bg-assistant-bubble",
      "--obsidian-ai-border-radius",
      "--obsidian-ai-border-radius-lg",
      "--obsidian-ai-spacing-sm",
      "--obsidian-ai-spacing-md",
      "--obsidian-ai-spacing-lg"
    ];

    for (const token of expectedTokens) {
      expect(css).toContain(token);
    }

    const colorTokens = [
      "--obsidian-ai-bg-primary",
      "--obsidian-ai-bg-card",
      "--obsidian-ai-bg-user-bubble",
      "--obsidian-ai-bg-assistant-bubble"
    ];

    for (const token of colorTokens) {
      const pattern = new RegExp(`${escapeRegex(token)}\\s*:\\s*var\\(--`);
      expect(css).toMatch(pattern);
    }
  });

  /* ====================================================================
     Phase B: Search Pane Styles
     ==================================================================== */

  it("B1_search_result_card_styles_defined", () => {
    const css = readStyles();
    expect(css).toContain(".obsidian-ai-search-result");
    expect(css).toMatch(/\.obsidian-ai-search-result\s*\{[^}]*background/);
    expect(css).toMatch(/\.obsidian-ai-search-result\s*\{[^}]*border-radius/);
    expect(css).toMatch(/\.obsidian-ai-search-result\s*\{[^}]*padding/);
    expect(css).toMatch(
      /\.obsidian-ai-search-result\s*\{[^}]*var\(--obsidian-ai-bg-card\)/
    );
    expect(css).toMatch(
      /\.obsidian-ai-search-result\s*\{[^}]*var\(--obsidian-ai-border-radius\)/
    );
  });

  it("B2_search_result_action_link_styled", () => {
    const css = readStyles();
    expect(css).toMatch(/\.obsidian-ai-search-result__action\s*\{[^}]*background:\s*transparent/);
    expect(css).toMatch(/\.obsidian-ai-search-result__action\s*\{[^}]*border:\s*none/);
    expect(css).toMatch(/\.obsidian-ai-search-result__action\s*\{[^}]*cursor:\s*pointer/);
    expect(css).toMatch(/\.obsidian-ai-search-result__action\s*\{[^}]*var\(--interactive-accent\)/);
    expect(css).toContain(".obsidian-ai-search-result__action:hover");
  });

  it("B3_search_result_path_muted", () => {
    const css = readStyles();
    expect(css).toMatch(/\.obsidian-ai-search-result__path\s*\{[^}]*var\(--text-muted\)/);
    expect(css).toMatch(/\.obsidian-ai-search-result__path\s*\{[^}]*font-size/);
  });

  it("B4_search_result_snippet_selectable", () => {
    const css = readStyles();
    expect(css).toMatch(/\.obsidian-ai-search-result__snippet\s*\{[^}]*user-select:\s*text/);
    expect(css).toMatch(/\.obsidian-ai-search-result__snippet\s*\{[^}]*cursor:\s*text/);
  });

  it("B5_search_result_score_pill_badge", () => {
    const css = readStyles();
    expect(css).toMatch(/\.obsidian-ai-search-result__score\s*\{[^}]*border-radius/);
    expect(css).toMatch(/\.obsidian-ai-search-result__score\s*\{[^}]*font-size/);
    expect(css).toMatch(/\.obsidian-ai-search-result__score\s*\{[^}]*background/);
  });

  it("B6_search_controls_rounded_flex", () => {
    const css = readStyles();
    expect(css).toMatch(/\.obsidian-ai-search-controls__query\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.obsidian-ai-search-controls__query\s*\{[^}]*gap/);
    expect(css).toMatch(/\.obsidian-ai-search-input\s*\{[^}]*border-radius/);
    expect(css).toMatch(/\.obsidian-ai-search-submit\s*\{[^}]*border-radius/);
    expect(css).toMatch(/\.obsidian-ai-search-controls__quality\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.obsidian-ai-search-controls__quality\s*\{[^}]*gap/);
    expect(css).toMatch(/\.obsidian-ai-search-controls__quality\s*\{[^}]*align-items/);
  });

  /* ====================================================================
     Phase C: Chat Pane Styles
     ==================================================================== */

  it("C1_chat_view_flex_column", () => {
    const css = readStyles();
    expect(css).toMatch(/\.obsidian-ai-chat-view\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.obsidian-ai-chat-view\s*\{[^}]*flex-direction:\s*column/);
    expect(css).toMatch(/\.obsidian-ai-chat-view\s*\{[^}]*height:\s*100%/);
    expect(css).toMatch(/\.obsidian-ai-chat-view\s*\{[^}]*var\(--obsidian-ai-bg-primary\)/);
  });

  it("C2_chat_history_scrollable", () => {
    const css = readStyles();
    expect(css).toMatch(/\.obsidian-ai-chat-history\s*\{[^}]*flex:\s*1/);
    expect(css).toMatch(/\.obsidian-ai-chat-history\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.obsidian-ai-chat-history\s*\{[^}]*padding/);
  });

  it("C3_user_bubble_right_aligned", () => {
    const css = readStyles();
    expect(css).toMatch(/\.obsidian-ai-chat-turn__user\s*\{[^}]*margin-left:\s*auto/);
    expect(css).toMatch(/\.obsidian-ai-chat-turn__user\s*\{[^}]*max-width/);
    expect(css).toMatch(/\.obsidian-ai-chat-turn__user\s*\{[^}]*border-radius/);
    expect(css).toMatch(/\.obsidian-ai-chat-turn__user\s*\{[^}]*padding/);
    expect(css).toMatch(
      /\.obsidian-ai-chat-turn__user\s*\{[^}]*var\(--obsidian-ai-bg-user-bubble\)/
    );
    expect(css).toMatch(/\.obsidian-ai-chat-turn__user\s*\{[^}]*var\(--text-on-accent\)/);
  });

  it("C4_assistant_bubble_left_aligned_selectable", () => {
    const css = readStyles();
    expect(css).toMatch(/\.obsidian-ai-chat-turn__assistant\s*\{[^}]*margin-right:\s*auto/);
    expect(css).toMatch(/\.obsidian-ai-chat-turn__assistant\s*\{[^}]*max-width/);
    expect(css).toMatch(/\.obsidian-ai-chat-turn__assistant\s*\{[^}]*border-radius/);
    expect(css).toMatch(/\.obsidian-ai-chat-turn__assistant\s*\{[^}]*padding/);
    expect(css).toMatch(
      /\.obsidian-ai-chat-turn__assistant\s*\{[^}]*var\(--obsidian-ai-bg-assistant-bubble\)/
    );
    expect(css).toMatch(/\.obsidian-ai-chat-turn__assistant\s*\{[^}]*position:\s*relative/);
    expect(css).toMatch(/\.obsidian-ai-chat-turn__assistant\s*\{[^}]*user-select:\s*text/);
  });

  it("C5_copy_button_positioned", () => {
    const css = readStyles();
    expect(css).toMatch(/\.obsidian-ai-chat-turn__copy-btn\s*\{[^}]*position:\s*absolute/);
    expect(css).toMatch(/\.obsidian-ai-chat-turn__copy-btn\s*\{[^}]*top/);
    expect(css).toMatch(/\.obsidian-ai-chat-turn__copy-btn\s*\{[^}]*right/);
    expect(css).toMatch(/\.obsidian-ai-chat-turn__copy-btn\s*\{[^}]*cursor:\s*pointer/);
  });

  it("C6_source_pill_buttons", () => {
    const css = readStyles();
    expect(css).toMatch(/\.obsidian-ai-chat-turn__sources\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.obsidian-ai-chat-turn__sources\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.obsidian-ai-chat-turn__sources\s*\{[^}]*gap/);
    expect(css).toMatch(/\.obsidian-ai-chat-turn__source-item\s*\{[^}]*border-radius/);
    expect(css).toMatch(/\.obsidian-ai-chat-turn__source-item\s*\{[^}]*padding/);
    expect(css).toMatch(/\.obsidian-ai-chat-turn__source-item\s*\{[^}]*background/);
    expect(css).toMatch(
      /\.obsidian-ai-chat-turn__source-item\s*\{[^}]*var\(--interactive-accent\)/
    );
    expect(css).toMatch(/\.obsidian-ai-chat-turn__source-item\s*\{[^}]*cursor:\s*pointer/);
  });

  it("C7_chat_controls_pinned_rounded", () => {
    const css = readStyles();
    expect(css).toMatch(/\.obsidian-ai-chat-controls\s*\{[^}]*border-top/);
    expect(css).toMatch(/\.obsidian-ai-chat-controls\s*\{[^}]*padding/);
    expect(css).toMatch(/\.obsidian-ai-chat-input\s*\{[^}]*width:\s*100%/);
    expect(css).toMatch(/\.obsidian-ai-chat-input\s*\{[^}]*border-radius/);
    expect(css).toMatch(/\.obsidian-ai-chat-input\s*\{[^}]*resize:\s*vertical/);
    expect(css).toMatch(/\.obsidian-ai-chat-send\s*\{[^}]*border-radius/);
    expect(css).toMatch(/\.obsidian-ai-chat-cancel\s*\{[^}]*border-radius/);
    expect(css).toMatch(/\.obsidian-ai-chat-new-conversation\s*\{[^}]*border-radius/);
  });
});

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
