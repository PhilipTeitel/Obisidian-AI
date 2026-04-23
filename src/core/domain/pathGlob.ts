/**
 * Compile vault path globs (`**`, `*`, `?`) to a union regex plus per-glob SQL LIKE patterns (ADR-014 / RET-6).
 * Separators are normalized to `/` before matching.
 *
 * **Case:** Vault folder names vary in casing (`Daily/` vs `daily/`). Use {@link VAULT_PATH_GLOB_REGEX_FLAGS}
 * whenever compiling {@link CompiledPathGlob.regex} or {@link CompiledPathGlobs.pathRegex} into a `RegExp`.
 */
export const VAULT_PATH_GLOB_REGEX_FLAGS = 'i';

function escapeRegexChar(c: string): string {
  return /[\\^$+?.()|[\]{}]/.test(c) ? `\\${c}` : c;
}

/** Glob body → regex fragment (no anchors). */
function compileGlobBody(normalized: string): string {
  let i = 0;
  let out = '';
  while (i < normalized.length) {
    if (normalized[i] === '*' && normalized[i + 1] === '*') {
      /** `**` + `/` + `*` — zero or more directory segments, then one filename stem (REQ-004 / RET-6). */
      if (normalized[i + 2] === '/' && normalized[i + 3] === '*') {
        out += '(?:.*/)*[^/]*';
        i += 4;
        continue;
      }
      out += '.*';
      i += 2;
    } else if (normalized[i] === '*') {
      out += '[^/]*';
      i += 1;
    } else if (normalized[i] === '?') {
      out += '[^/]';
      i += 1;
    } else {
      out += escapeRegexChar(normalized[i]!);
      i += 1;
    }
  }
  return out;
}

/** Glob → SQL LIKE pattern (approximate prefilter; `*` is `%`, `?` is `_`). */
function compileGlobLike(normalized: string): string {
  let i = 0;
  let out = '';
  while (i < normalized.length) {
    if (normalized[i] === '*' && normalized[i + 1] === '*') {
      /** Double-star slash star may match zero directory segments; use SQL `%` not `%/%`. */
      if (normalized[i + 2] === '/' && normalized[i + 3] === '*') {
        out += '%';
        i += 4;
        continue;
      }
      out += '%';
      i += 2;
    } else if (normalized[i] === '*') {
      out += '%';
      i += 1;
    } else if (normalized[i] === '?') {
      out += '_';
      i += 1;
    } else if (normalized[i] === '%' || normalized[i] === '_') {
      out += '\\' + normalized[i];
      i += 1;
    } else {
      out += normalized[i]!;
      i += 1;
    }
  }
  return out;
}

export interface CompiledPathGlob {
  /** Full anchored regex for `vault_path`. */
  regex: string;
  /** LIKE pattern for this glob. */
  like: string;
}

/**
 * Compile one glob. Throws if the pattern is empty or invalid.
 */
export function compilePathGlob(raw: string): CompiledPathGlob {
  const normalized = raw.replace(/\\/g, '/').trim();
  if (normalized.length === 0) {
    throw new Error('path glob is empty');
  }
  const body = compileGlobBody(normalized);
  return {
    regex: `^${body}$`,
    like: compileGlobLike(normalized),
  };
}

export interface CompiledPathGlobs {
  pathRegex: string;
  pathLikes: string[];
}

/**
 * Compile a non-empty list of globs into a union regex and LIKE patterns (OR semantics).
 */
export function compilePathGlobs(globs: string[]): CompiledPathGlobs {
  if (globs.length === 0) {
    throw new Error('pathGlobs is empty');
  }
  const parts = globs.map((g) => compilePathGlob(g));
  if (parts.length === 1) {
    return { pathRegex: parts[0]!.regex, pathLikes: [parts[0]!.like] };
  }
  const inner = parts.map((p) => p.regex.slice(1, -1)).join('|');
  return {
    pathRegex: `^(?:${inner})$`,
    pathLikes: parts.map((p) => p.like),
  };
}

/**
 * True if `vaultPath` matches any compiled glob regex.
 */
export function vaultPathMatchesAnyGlob(vaultPath: string, globs: string[]): boolean {
  const norm = vaultPath.replace(/\\/g, '/');
  return globs.some((g) => {
    const { regex } = compilePathGlob(g);
    return new RegExp(regex, VAULT_PATH_GLOB_REGEX_FLAGS).test(norm);
  });
}
