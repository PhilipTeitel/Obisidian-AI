import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RRF_K, fuseRankings } from '@src/core/domain/rrf.js';

describe('rrf (RET-5)', () => {
  it('B1_fused_order_deterministic', () => {
    const listA = [{ id: 'X' }, { id: 'Y' }, { id: 'Z' }];
    const listB = [{ id: 'Z' }, { id: 'X' }, { id: 'Y' }];
    const fused = fuseRankings([
      listA.map((x) => ({ id: x.id })),
      listB.map((x) => ({ id: x.id })),
    ]);
    const xScore = 1 / (RRF_K + 1) + 1 / (RRF_K + 2);
    const yScore = 1 / (RRF_K + 2) + 1 / (RRF_K + 3);
    expect(xScore).toBeGreaterThan(yScore);
    expect(fused[0]!.id).toBe('X');
    expect(fused[1]!.id).toBe('Z');
  });

  it('B2_tie_break', () => {
    const listA = [{ id: 'b' }, { id: 'a' }];
    const listB = [{ id: 'a' }, { id: 'b' }];
    const fused = fuseRankings([
      listA.map((x) => ({ id: x.id })),
      listB.map((x) => ({ id: x.id })),
    ]);
    const sa = 1 / (RRF_K + 2) + 1 / (RRF_K + 1);
    const sb = 1 / (RRF_K + 1) + 1 / (RRF_K + 2);
    expect(sa).toBe(sb);
    expect(fused.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('Y5_fixed_k60_constant', () => {
    expect(RRF_K).toBe(60);
    const sw = readFileSync(
      fileURLToPath(new URL('../../../src/core/workflows/SearchWorkflow.ts', import.meta.url)),
      'utf8',
    );
    expect(sw).toMatch(/fuseRankings\(/);
    expect(sw).not.toMatch(/fuseRankings\([\s\S]*,\s*\d+/);
  });
});
