# MVP Release Checklist

Use this checklist before publishing or tagging an MVP release candidate.

## 1) Automated Gates

Run all commands and record evidence.

| ID | Criterion | Verification Command | Evidence | Status |
|----|-----------|----------------------|----------|--------|
| G1 | Lint passes | `npm run lint` | Paste command summary + timestamp | [ ] |
| G2 | Production build passes | `npm run build` | Paste command summary + timestamp | [ ] |
| G3 | Full test suite passes | `npm run test` | Paste command summary + timestamp | [ ] |
| G4 | Scale validation passes | `npm run test:scale` | Paste scenario metrics (`hundreds` / `thousands`) | [ ] |

## 2) Functional Smoke Checks

Run these checks in an Obsidian vault configured for the plugin.

| ID | Scenario | Expected Result | Evidence | Status |
|----|----------|-----------------|----------|--------|
| S1 | Run `Reindex vault` command | Command succeeds; completion notice shown | Screenshot/log snippet | [ ] |
| S2 | Run `Index changes` after editing at least one note | Command succeeds; changed content appears in index | Screenshot/log snippet | [ ] |
| S3 | Semantic search query | Relevant ranked results shown; opening a result navigates to note | Screenshot/video snippet | [ ] |
| S4 | Chat with retrieval context | Streaming response appears and references indexed context | Screenshot/video snippet | [ ] |
| S5 | Agent create/update note in allowed folder | Note is created/updated; guardrails enforced for disallowed paths | Screenshot/log snippet | [ ] |

## 3) Reliability / Recovery Checks

| ID | Scenario | Expected Result | Evidence | Status |
|----|----------|-----------------|----------|--------|
| R1 | Provider timeout / outage simulation during indexing | Failure notice includes recovery action guidance | Screenshot/log snippet | [ ] |
| R2 | Retry behavior on transient provider failure | Indexing retries once and either succeeds or surfaces recovery guidance | Log snippet from command/test output | [ ] |
| R3 | Partial incremental failure fallback | Recovery action points to `Reindex vault` when needed | Screenshot/log snippet | [ ] |

## 4) Documentation & Packaging Checks

| ID | Criterion | Verification Method | Evidence | Status |
|----|-----------|---------------------|----------|--------|
| D1 | README backlog + story status are current | Review Epic 7 rows in `README.md` | Reviewer initials/date | [ ] |
| D2 | Release notes/changelog prepared | Confirm release notes draft exists for current version | Link/path to notes | [ ] |
| D3 | Plugin manifest/version alignment | Verify `manifest.json`, `versions.json`, and release tag version match | Version values + reviewer initials | [ ] |

## 5) Sign-Off

| Field | Value |
|-------|-------|
| Release candidate version | |
| Release owner | |
| QA sign-off | |
| Docs sign-off | |
| Date | |
| Final decision | `GO` / `NO-GO` |
| Notes / blockers | |

## Definition of Done (Release)

Release is approved only when:

1. All checklist status boxes are checked.
2. Evidence is filled for each gate.
3. Final decision is `GO` with owner/date recorded.
