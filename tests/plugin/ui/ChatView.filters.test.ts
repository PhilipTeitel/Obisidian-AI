import { describe, expect, it } from 'vitest';
import { compilePathGlobs } from '@src/core/domain/pathGlob.js';
import { parseChatInput } from '@src/core/domain/chatInputParser.js';

describe('ChatView filters (RET-6)', () => {
  it('C5_chat_input_slash_commands', () => {
    const raw = 'path:Daily/**/*.md last:14d what are the open questions?';
    const parsed = parseChatInput(raw);
    expect(parsed.text).toBe('what are the open questions?');
    expect(parsed.pathGlobs).toEqual(['Daily/**/*.md']);
    expect(parsed.dateRange?.start).toBeDefined();
    compilePathGlobs(parsed.pathGlobs!);
  });
});
