# Scale Validation Runbook

This runbook defines how to execute REL-2 scale validation for indexing and semantic search latency.

## Command

```bash
npm run test:scale
```

This command executes `src/__tests__/integration/scaleValidation.integration.test.ts` only.

## Scenarios

| Scenario | Notes | Updated Notes | Reindex Budget | Search Budget | Incremental Budget |
|----------|-------|---------------|----------------|---------------|--------------------|
| hundreds | 300 | 40 | <= 18,000ms | <= 2,500ms | <= 12,000ms |
| thousands | 1,000 | 120 | <= 45,000ms | <= 5,000ms | <= 25,000ms |

## Output

Each scenario emits a metric line in the test output:

```text
[REL-2][scenario-id] notes=<count> reindexMs=<ms> searchMs=<ms> incrementalMs=<ms>
```

## Baseline Capture (2026-02-24)

Update this table after each intentional scale-validation rerun:

| Date | Scenario | Reindex (ms) | Search (ms) | Incremental (ms) | Result |
|------|----------|--------------|-------------|------------------|--------|
| 2026-02-24 | hundreds | 16 | 1 | 3 | pass |
| 2026-02-24 | thousands | 16 | 3 | 7 | pass |

## Interpretation

- Pass when all scenario latencies are below budget and test status is green.
- Investigate regressions when one or more scenario metrics exceed budget or trend materially upward across runs.
- Keep budgets generous but meaningful; update only with explicit team agreement and documented rationale.
