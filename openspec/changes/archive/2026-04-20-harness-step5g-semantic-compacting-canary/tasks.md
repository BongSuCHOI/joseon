## 1. Types & Config

- [x] 1.1 Add `CompactingCanaryMismatchRecord` interface to `src/types.ts`
- [x] 1.2 Add `compacting_canary_enabled` field to `HarnessSettings` in `src/config/schema.ts` with default `false`
- [x] 1.3 Add optional `canary` block to `CompactionRelevanceShadowRecord` in `src/types.ts`

## 2. Canary Core Functions

- [x] 2.1 Add `readRecentCompactingShadowRecords()` to `src/harness/canary.ts` — read last N records from `compacting-relevance-shadow.jsonl`
- [x] 2.2 Add `evaluateCompactingCanary()` to `src/harness/canary.ts` — compare baseline vs applied selections, detect rule_omission, fact_omission, rank_inversion
- [x] 2.3 Add `appendCompactingMismatchRecord()` to `src/harness/canary.ts` — persist mismatches to `compacting-canary-mismatches.jsonl`
- [x] 2.4 Add `generateCompactingCanaryReport()` to `src/harness/canary.ts` — aggregation report with breakdown by mismatch type + promotion candidates

## 3. Integration

- [x] 3.1 Modify `appendCompactionShadowRecord()` in `src/harness/improver.ts` to accept config and run compacting canary evaluation after shadow append
- [x] 3.2 Ensure canary block is populated on shadow records when `compacting_canary_enabled=true`

## 4. Tests

- [x] 4.1 Create `src/__tests__/smoke-step5g-compacting-canary.ts` with assertions for all scenarios: mismatch detection (rule_omission, fact_omission, rank_inversion), no mismatch, disabled canary, report generation, promotion candidates
- [x] 4.2 Run full smoke test suite (existing 77 + new) and verify all pass

## 5. Documentation Sync

- [x] 5.1 Update `AGENTS.md` — Step 5 status with 5g completion, `compacting_canary_enabled` setting
- [x] 5.2 Update `README.md` — runtime data tree, canary configuration section
- [x] 5.3 Update `docs/step4-post-enhancements.md` — item 3 status updated
- [x] 5.4 Update `docs/development-guide.md` — test history entry
- [x] 5.5 Create `openspec/specs/compacting-canary/spec.md` — permanent capability spec
- [x] 5.6 Update `openspec/specs/harness-step5b-memory-relevance/spec.md` — canary scenarios
