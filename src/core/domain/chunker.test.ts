import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  chunkNote,
  chunkNoteToDocumentNodes,
  partitionFrontmatter,
  phrasingToMarkdown,
} from './chunker.js';
import type { ChunkNoteInput, DocumentNode } from './types.js';
import { splitIntoSentences } from './sentenceSplitter.js';

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function baseInput(
  overrides: Partial<ChunkNoteInput> & Pick<ChunkNoteInput, 'markdown'>,
): ChunkNoteInput {
  const { markdown, ...rest } = overrides;
  return {
    noteId: 'n1',
    noteTitle: 'T',
    vaultPath: 'notes/x.md',
    markdown,
    ...rest,
  };
}

function byType(nodes: DocumentNode[], t: DocumentNode['type']): DocumentNode[] {
  return nodes.filter((n) => n.type === t);
}

describe('chunker', () => {
  it('A1_single_root_and_parent_refs', () => {
    const { nodes } = chunkNote(
      baseInput({ markdown: '# H\n\nBody.' }),
    );
    const roots = nodes.filter((n) => n.parentId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.type).toBe('note');
    const ids = new Set(nodes.map((n) => n.id));
    for (const n of nodes) {
      if (n.parentId !== null) expect(ids.has(n.parentId)).toBe(true);
    }
  });

  it('A2_heading_hierarchy_and_trail', () => {
    const { nodes } = chunkNote(
      baseInput({ markdown: '# A\n\n## B\n\nText under B.' }),
    );
    const topics = byType(nodes, 'topic');
    const subs = byType(nodes, 'subtopic');
    expect(topics.map((t) => t.content)).toContain('A');
    const b = subs.find((s) => s.content === 'B');
    expect(b).toBeDefined();
    expect(b!.headingTrail).toEqual(['A']);
    const paras = byType(nodes, 'paragraph');
    const body = paras.find((p) => p.content === 'Text under B.');
    expect(body?.headingTrail).toEqual(['A', 'B']);
  });

  it('A3_sibling_order_matches_source', () => {
    const { nodes } = chunkNote(
      baseInput({ markdown: '# S\n\nOne.\n\nTwo.\n\nThree.' }),
    );
    const section = byType(nodes, 'topic').find((t) => t.content === 'S')!;
    const kids = nodes
      .filter((n) => n.parentId === section.id)
      .sort((a, b) => a.siblingOrder - b.siblingOrder);
    expect(kids.map((k) => k.content)).toEqual(['One.', 'Two.', 'Three.']);
    expect(kids.map((k) => k.siblingOrder)).toEqual([0, 1, 2]);
  });

  it('A4_list_items_are_bullets', () => {
    const { nodes } = chunkNote(
      baseInput({ markdown: '# S\n\n- a\n- b' }),
    );
    const groups = byType(nodes, 'bullet_group');
    expect(groups).toHaveLength(1);
    const bullets = nodes.filter((n) => n.parentId === groups[0]!.id);
    expect(bullets.map((b) => b.content)).toEqual(['a', 'b']);
    expect(bullets.every((b) => b.type === 'bullet')).toBe(true);
  });

  it('A5_frontmatter_stripped', () => {
    const { nodes } = chunkNote(
      baseInput({
        markdown: '---\nfoo: bar\n---\n\nHello.',
      }),
    );
    const paras = byType(nodes, 'paragraph').map((p) => p.content);
    expect(paras.some((c) => c.includes('foo:'))).toBe(false);
    expect(paras).toContain('Hello.');
  });

  it('A6_contenthash_stable', () => {
    const { nodes } = chunkNote(baseInput({ markdown: '# H\n\nX.' }));
    for (const n of nodes) {
      expect(n.contentHash).toBe(sha256(n.content));
    }
    const again = chunkNote(baseInput({ markdown: '# H\n\nX.' }));
    const byContent = new Map(again.nodes.map((n) => [n.content, n.contentHash]));
    for (const n of nodes) {
      expect(byContent.get(n.content)).toBe(n.contentHash);
    }
  });

  it('B1_unique_ids', () => {
    const { nodes } = chunkNote(baseInput({ markdown: '# A\n\n- x\n- y' }));
    const ids = nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('B2_note_root_title', () => {
    const { nodes } = chunkNote(
      baseInput({ noteTitle: '  My Title  ', markdown: 'Hi.' }),
    );
    const root = nodes.find((n) => n.type === 'note')!;
    expect(root.content).toBe('My Title');
  });

  it('B3_iso_timestamps', () => {
    const { nodes } = chunkNote(baseInput({ markdown: 'x' }));
    for (const n of nodes) {
      expect(n.createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
      );
      expect(n.updatedAt).toBe(n.createdAt);
    }
  });

  it('Y2_no_deferred_node_types_when_no_list_or_split', () => {
    const { nodes } = chunkNote(
      baseInput({
        markdown: '# H\n\nShort.',
        maxEmbeddingTokens: 8000,
      }),
    );
    expect(nodes.some((n) => n.type === 'sentence_part')).toBe(false);
    expect(nodes.some((n) => n.type === 'bullet_group')).toBe(false);
  });

  it('Z5_no_content_logging', () => {
    const src = readFileSync(new URL('./chunker.ts', import.meta.url), 'utf8');
    expect(src.includes('console.log')).toBe(false);
  });

  it('chunkNoteToDocumentNodes', () => {
    const nodes = chunkNoteToDocumentNodes(baseInput({ markdown: 'Note.' }));
    expect(nodes[0]!.type).toBe('note');
  });
});

describe('CHK-2 sentence split', () => {
  it('A1_no_split_under_threshold', () => {
    const { nodes } = chunkNote(
      baseInput({
        markdown: '# H\n\nHello world.',
        maxEmbeddingTokens: 8000,
      }),
    );
    expect(nodes.some((n) => n.type === 'sentence_part')).toBe(false);
  });

  it('A2_split_over_threshold', () => {
    const { nodes } = chunkNote(
      baseInput({
        markdown: '# H\n\nFirst. Second. Third.',
        maxEmbeddingTokens: 1,
      }),
    );
    const para = nodes.find((n) => n.type === 'paragraph')!;
    const parts = nodes.filter(
      (n) => n.parentId === para.id && n.type === 'sentence_part',
    );
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.every((p) => p.type === 'sentence_part')).toBe(true);
  });

  it('A3_reassembly_matches_parent_content', () => {
    const { nodes } = chunkNote(
      baseInput({
        markdown: '# H\n\nAlpha. Beta.',
        maxEmbeddingTokens: 1,
      }),
    );
    const para = nodes.find((n) => n.type === 'paragraph')!;
    const parts = nodes
      .filter((n) => n.parentId === para.id && n.type === 'sentence_part')
      .sort((a, b) => a.siblingOrder - b.siblingOrder);
    expect(parts.map((p) => p.content).join('')).toBe(para.content);
  });

  it('A4_sentence_part_sibling_order', () => {
    const { nodes } = chunkNote(
      baseInput({
        markdown: '# H\n\nA. B. C.',
        maxEmbeddingTokens: 1,
      }),
    );
    const para = nodes.find((n) => n.type === 'paragraph')!;
    const parts = nodes
      .filter((n) => n.parentId === para.id && n.type === 'sentence_part')
      .sort((a, b) => a.siblingOrder - b.siblingOrder);
    expect(parts.map((p) => p.siblingOrder)).toEqual(
      parts.map((_, i) => i),
    );
  });

  it('A5_abbreviation_dr', () => {
    const s = splitIntoSentences('Dr. Smith went to Washington. He stayed.');
    expect(s).toHaveLength(2);
  });

  it('B1_trail_and_depth_inherit', () => {
    const { nodes } = chunkNote(
      baseInput({
        markdown: '# A\n\n## B\n\nLong first. Long second.',
        maxEmbeddingTokens: 1,
      }),
    );
    const para = nodes.find(
      (n) => n.type === 'paragraph' && n.content.includes('Long first'),
    )!;
    const parts = nodes.filter(
      (n) => n.parentId === para.id && n.type === 'sentence_part',
    );
    expect(parts.length).toBeGreaterThan(0);
    for (const p of parts) {
      expect(p.headingTrail).toEqual(para.headingTrail);
      expect(p.depth).toBe(para.depth + 1);
    }
  });

  it('B2_contenthash_split_nodes', () => {
    const { nodes } = chunkNote(
      baseInput({
        markdown: '# H\n\nOne. Two.',
        maxEmbeddingTokens: 1,
      }),
    );
    const para = nodes.find((n) => n.type === 'paragraph')!;
    expect(para.contentHash).toBe(sha256(para.content));
    const parts = nodes.filter(
      (n) => n.parentId === para.id && n.type === 'sentence_part',
    );
    for (const p of parts) {
      expect(p.contentHash).toBe(sha256(p.content));
    }
  });

  it('Y2_token_estimator_has_no_native_tokenizer', () => {
    const src = readFileSync(
      new URL('./tokenEstimator.ts', import.meta.url),
      'utf8',
    );
    const nativeSqlMarker = `${'better'}-${'sqlite'}${3}`;
    expect(src.includes(nativeSqlMarker)).toBe(false);
    expect(src.includes('tiktoken')).toBe(false);
  });
});

describe('CHK-3 bullet_group', () => {
  it('A1_list_wrapped_in_bullet_group', () => {
    const { nodes } = chunkNote(baseInput({ markdown: '# S\n\n- a' }));
    const bullets = byType(nodes, 'bullet');
    expect(bullets.every((b) => b.parentId !== null)).toBe(true);
    const parent = nodes.find((n) => n.id === bullets[0]!.parentId)!;
    expect(parent.type).toBe('bullet_group');
  });

  it('A2_nested_bullets_under_parent_bullet', () => {
    const { nodes } = chunkNote(
      baseInput({ markdown: '# S\n\n- outer\n  - inner' }),
    );
    const outer = byType(nodes, 'bullet').find((b) => b.content === 'outer')!;
    const inner = byType(nodes, 'bullet').find((b) => b.content === 'inner')!;
    expect(inner.parentId).toBe(outer.id);
  });

  it('A3_two_groups_blank_line', () => {
    // CommonMark merges `- a` + blank line + `- b` into one list; a block between lists
    // yields two AST lists (Obsidian users often insert a spacer — thematic break works).
    const { nodes } = chunkNote(
      baseInput({ markdown: '# S\n\n- a\n\n---\n\n- b' }),
    );
    expect(byType(nodes, 'bullet_group')).toHaveLength(2);
  });

  it('A4_paragraph_then_list_order', () => {
    const { nodes } = chunkNote(
      baseInput({ markdown: '# S\n\nPara.\n\n- x' }),
    );
    const section = byType(nodes, 'topic')[0]!;
    const kids = nodes
      .filter((n) => n.parentId === section.id)
      .sort((a, b) => a.siblingOrder - b.siblingOrder);
    expect(kids[0]!.type).toBe('paragraph');
    expect(kids[1]!.type).toBe('bullet_group');
  });

  it('B1_bullet_trail_matches_paragraph_sibling', () => {
    const { nodes } = chunkNote(
      baseInput({ markdown: '# S\n\nP.\n\n- b' }),
    );
    const p = byType(nodes, 'paragraph').find((x) => x.content === 'P.')!;
    const b = byType(nodes, 'bullet').find((x) => x.content === 'b')!;
    expect(b.headingTrail).toEqual(p.headingTrail);
  });

  it('B2_group_hashes_and_ids', () => {
    const { nodes } = chunkNote(baseInput({ markdown: '- x' }));
    const g = byType(nodes, 'bullet_group')[0]!;
    expect(g.contentHash).toBe(sha256(''));
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
  });

  it('Y2_no_orphan_top_level_bullets', () => {
    const { nodes } = chunkNote(baseInput({ markdown: '# H\n\n- a\n- b' }));
    const bullets = byType(nodes, 'bullet');
    for (const b of bullets) {
      const p = nodes.find((n) => n.id === b.parentId)!;
      expect(p.type === 'bullet' || p.type === 'bullet_group').toBe(true);
    }
  });
});

describe('CHK-4 crossRefs', () => {
  it('A1_wikilink_simple', () => {
    const { nodes, crossRefs } = chunkNote(
      baseInput({
        vaultPath: 'folder/note.md',
        markdown: '# H\n\nSee [[Simple]] here.',
      }),
    );
    const para = byType(nodes, 'paragraph')[0]!;
    expect(crossRefs).toContainEqual({
      sourceNodeId: para.id,
      targetPath: 'Simple.md',
      linkText: null,
    });
  });

  it('A2_wikilink_pipe_alias', () => {
    const { crossRefs } = chunkNote(
      baseInput({
        markdown: '[[Target|Alias]]',
      }),
    );
    expect(crossRefs[0]).toMatchObject({
      targetPath: 'Target.md',
      linkText: 'Alias',
    });
  });

  it('A3_markdown_relative_link', () => {
    const { crossRefs } = chunkNote(
      baseInput({
        vaultPath: 'notes/foo/bar.md',
        markdown: '[l](./other.md)',
      }),
    );
    expect(crossRefs[0]?.targetPath).toBe('notes/foo/other.md');
  });

  it('A4_http_skipped', () => {
    const { crossRefs } = chunkNote(
      baseInput({
        markdown: '[x](https://example.com/a.md)',
      }),
    );
    expect(crossRefs).toHaveLength(0);
  });

  it('B1_result_shape_nodes', () => {
    const r = chunkNote(baseInput({ markdown: '# A' }));
    expect(Array.isArray(r.nodes)).toBe(true);
    expect(r.nodes.filter((n) => n.parentId === null)).toHaveLength(1);
  });

  it('B2_tags_empty_until_chk5', () => {
    const r = chunkNote(baseInput({ markdown: 'x' }));
    expect(r.tags).toEqual([]);
  });

  it('Y2_all_source_ids_resolve', () => {
    const r = chunkNote(
      baseInput({
        markdown: '[[L]] and [t](./x.md)',
        vaultPath: 'a.md',
      }),
    );
    const ids = new Set(r.nodes.map((n) => n.id));
    for (const c of r.crossRefs) {
      expect(ids.has(c.sourceNodeId)).toBe(true);
    }
  });
});

describe('CHK-5 tags', () => {
  it('A1_frontmatter_tags_array', () => {
    const r = chunkNote(
      baseInput({
        markdown: '---\ntags: [reading, inbox]\n---\n\nHi.',
      }),
    );
    const note = r.nodes.find((n) => n.type === 'note')!;
    const tags = r.tags.filter((t) => t.source === 'frontmatter');
    expect(tags).toEqual(
      expect.arrayContaining([
        { nodeId: note.id, tag: 'reading', source: 'frontmatter' },
        { nodeId: note.id, tag: 'inbox', source: 'frontmatter' },
      ]),
    );
  });

  it('A2_frontmatter_tag_singular', () => {
    const r = chunkNote(
      baseInput({
        markdown: '---\ntag: single\n---\n\nX',
      }),
    );
    const note = r.nodes.find((n) => n.type === 'note')!;
    expect(r.tags).toContainEqual({
      nodeId: note.id,
      tag: 'single',
      source: 'frontmatter',
    });
  });

  it('A3_frontmatter_not_in_body_nodes', () => {
    const r = chunkNote(
      baseInput({
        markdown: '---\ntags: [a]\n---\n\nBody.',
      }),
    );
    const paras = byType(r.nodes, 'paragraph');
    expect(paras.every((p) => !p.content.includes('tags:'))).toBe(true);
  });

  it('B1_inline_paragraph_tag', () => {
    const r = chunkNote(baseInput({ markdown: 'Hello #idea world.' }));
    const para = byType(r.nodes, 'paragraph')[0]!;
    expect(r.tags).toContainEqual({
      nodeId: para.id,
      tag: 'idea',
      source: 'inline',
    });
  });

  it('B2_no_tag_in_fence', () => {
    const r = chunkNote(
      baseInput({
        markdown: '```\n#secret\n```\n\nok.',
      }),
    );
    expect(r.tags.every((t) => t.tag !== 'secret')).toBe(true);
  });

  it('B3_no_tag_in_inline_code', () => {
    const r = chunkNote(baseInput({ markdown: 'Use `#nope` here.' }));
    expect(r.tags.some((t) => t.tag === 'nope')).toBe(false);
  });

  it('C1_combined_tags_and_links', () => {
    const r = chunkNote(
      baseInput({
        markdown: '---\ntags: [fm]\n---\n\nText [[L]] #inline',
        vaultPath: 'n.md',
      }),
    );
    expect(r.tags.length).toBeGreaterThanOrEqual(2);
    expect(r.crossRefs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('partitionFrontmatter', () => {
  it('splits closing delimiter', () => {
    const { body, frontmatter } = partitionFrontmatter(
      '---\na: 1\n---\n\nBody',
    );
    expect(frontmatter).toContain('a: 1');
    expect(body.trim()).toBe('Body');
  });
});

describe('phrasingToMarkdown', () => {
  it('roundtrips link', () => {
    const md = phrasingToMarkdown([
      { type: 'text', value: 'x ' },
      {
        type: 'link',
        url: './y.md',
        children: [{ type: 'text', value: 'l' }],
      },
    ]);
    expect(md).toBe('x [l](./y.md)');
  });
});
