## 1. Type & Interface Changes

- [x] 1.1 Add `AckAcceptanceResult` interface to `src/types.ts` with fields: `checks_passed: string[]`, `checks_failed: Array<{check: string; reason: string}>`, `verdict: 'accepted' | 'rejected'`, `reason: string`
- [x] 1.2 Extend `AckRecord` interface in `src/types.ts`: add `acceptance_checks_passed?: string[]`, `acceptance_checks_failed?: Array<{check: string; reason: string}>`, `acceptance_verdict?: 'accepted' | 'rejected'`. Keep existing `acceptance_check`, `accepted`, `reason` fields for backward compatibility

## 2. Core Logic — findRule & Multi-check Evaluator

- [x] 2.1 Add `findRule(patternMatch: string, projectKey: string): Rule | null` helper in `src/harness/improver.ts`. Refactor existing `ruleExists()` to delegate to `findRule() !== null`
- [x] 2.2 Rewrite `evaluateAckAcceptance()` to return `AckAcceptanceResult` with 3 sequential checks: (1) rule_written via `findRule() !== null`, (2) rule_valid via JSON field validation on returned Rule, (3) not_prune_candidate via `rule.prune_candidate` check. Short-circuit on first failure
- [x] 2.3 Add `validateRuleFields(rule: Rule): boolean` helper checking required fields: id, type, pattern, description

## 3. Caller Integration

- [x] 3.1 Update `session.idle` handler in `HarnessImprover` (improver.ts ~L1350-1378) to use new `AckAcceptanceResult` from `evaluateAckAcceptance()`. Map result fields to extended `AckRecord` for both written and accepted records
- [x] 3.2 Ensure `appendAckRecord()` calls include the new `acceptance_checks_passed`, `acceptance_checks_failed`, `acceptance_verdict` fields

## 4. Tests

- [x] 4.1 Create `src/__tests__/smoke-step5h-ack-acceptance.ts` covering: all checks pass, rule missing, rule corrupt JSON, rule missing fields, rule is prune candidate, guard disabled, findRule helper
- [x] 4.2 Run existing smoke-step5a-foundation tests to verify backward compatibility
- [x] 4.3 Run full smoke suite (all step5 tests) to verify no regressions — 192/192 passed

## 5. Documentation Sync

- [x] 5.1 Update `docs/step4-post-enhancements.md` item 6 (Ack 조건 강화) with explore/decide logic chain, current state, and future roadmap
- [x] 5.2 Update `AGENTS.md` Step 5 status table to include 5h
- [x] 5.3 Update `README.md` if any user-facing setting or CLI command changed
- [x] 5.4 Update `docs/development-guide.md` with smoke-step5h test command and test history
