# DOC-1: Authoring guide — headings, bullets, tags, links

**Story**: Add a short **authoring-oriented** guide (REQUIREMENTS §5 user-facing documentation) explaining how **headings**, **bullet structure**, **tags**, and **wikilinks** affect **hierarchical indexing and retrieval**, with pointers to the chunker/node model.
**Epic**: 10 — Testing, authoring guide, and release hardening
**Size**: Small
**Status**: Complete

---

## 1. Summary

Users get better search and chat grounding when notes match the model described in [README §5](../../README.md#5-bottom-up-summaries) and [ADR-002](../decisions/ADR-002-hierarchical-document-model.md). This doc is **not** a marketing page; it is practical guidance stored in-repo for packaging or wiki export later.

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                            | Why it binds this story                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| [ADR-002](../decisions/ADR-002-hierarchical-document-model.md) | Explains node types and tree shape users indirectly influence. |

---

## 3. Definition of Ready (DoR)

- [x] REQUIREMENTS §5 “User-facing documentation” cited
- [x] Section 4 filled

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Guide must mention **heading hierarchy**, **bullet groups vs nested bullets**, **frontmatter and inline tags**, and **wikilinks** as behavioral inputs to indexing.
2. **Y2** — File lives under `docs/guides/` and is linked from README or Epic 10 table.

---

## 5–6. (n/a)

---

## 7. File Touchpoints

| Path                                       | Purpose                           |
| ------------------------------------------ | --------------------------------- |
| `docs/guides/authoring-for-ai-indexing.md` | New guide                         |
| `README.md`                                | Link from backlog or docs section |

---

## 8. Acceptance Criteria Checklist

### Phase A

- [x] **A1** — `docs/guides/authoring-for-ai-indexing.md` exists and covers headings, bullets, tags, links per Y1.
  - Evidence: file content review

### Phase Z

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes
- [x] **Z3** — **N/A** (markdown)
- [x] **Z4** — **N/A**
- [x] **Z5** — **N/A**

---

## 9. Risks & Tradeoffs

(n/a)

---

## Implementation Order

1. Write `docs/guides/authoring-for-ai-indexing.md`
2. README link

---

_Created: 2026-04-05 | Story: DOC-1 | Epic: 10_
