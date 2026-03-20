# Search and Chat Pane UX Improvements

## Overview

Improve the user experience of the Semantic Search and Chat panes. The current UI lacks visual formatting, text selectability, and clear separation between elements. Both panes need styling, and the Chat pane needs a conversational bubble layout with copy support and proper input placement.

## Semantic Search Pane

### Problems
- Search results run together with no visual separation
- Text in results is not reliably selectable (title is a `<button>`)
- No visual distinction between the note title, file path, snippet text, and score

### Requirements
- Each result should be displayed as a visually distinct card with clear separation between results
- Within each card, the following elements must be visually distinguished:
  - **Note title** (with optional heading): clickable link that opens the note, styled in accent color
  - **File path**: small muted text below the title
  - **Snippet text**: normal readable text, must be selectable for copying
  - **Score**: displayed as a small pill/badge
- All text in the search results must be selectable
- Controls (inputs, buttons) should have rounded corners

## Chat Pane

### Problems
- All results run together with no separation
- No visual distinction between prompts, answers, and sources
- Input is a single-line field at the top of the pane
- Response text is not easily selectable or copyable

### Requirements

#### Message Layout
- User prompts should appear in bubbles aligned to the **right** side of the pane
- Assistant responses should appear in bubbles aligned to the **left** side of the pane
- This is alignment within a single column, not separate columns
- The background color of the pane must be visually different from the bubble colors

#### Response Interaction
- All response text must be selectable for copying
- Each assistant response bubble must have a **copy button** in the upper-right corner that copies the full response text to clipboard
- Sources should be displayed as **pill-shaped buttons** (similar to the search result title style) below the response bubble
- Clicking a source button opens the corresponding note in Obsidian (same behavior as search result navigation)

#### Conversation Context
- Subsequent prompts in the same conversation must include prior user and assistant messages (conversation history) when submitted to the API
- A **"New Conversation"** button should be available to clear the history and start fresh

#### Input Area
- The prompt input must be at the **bottom** of the pane (not the top)
- The input should be a **multi-line textarea** stretching the full width of the pane, several lines high
- Send and Cancel buttons below the textarea

#### Visual Style
- All controls (buttons, inputs, textarea) should have **rounded corners**
- Bubble colors must contrast with the pane background color
- Use Obsidian's CSS variables for theme compatibility (light and dark mode)

## Technical Notes
- A `styles.css` file needs to be created at the project root (Obsidian auto-loads it)
- No CSS file currently exists in the project
- The existing `ChatPaneModel.buildMessagesForNextRequest()` already maintains conversation context
- A `clearConversation()` method needs to be added to `ChatPaneModel`
- Source navigation in the chat pane needs to be wired using the same `openResult` pattern from the search pane
