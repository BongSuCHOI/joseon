## 1. Logger Module

- [x] 1.1 Create `src/shared/logger.ts` with LogLevel type, level hierarchy, and `HARNESS_LOG_LEVEL` env var parsing
- [x] 1.2 Implement `logger.debug/info/warn/error` functions — JSONL append to `logs/harness.jsonl` + formatted stderr output
- [x] 1.3 Export logger from `src/shared/index.ts`

## 2. Backward Compatibility

- [x] 2.1 Modify `logEvent()` in `src/shared/utils.ts` to redirect to `logger.info()` with `_category`/`_filename` fields, add `@deprecated` JSDoc

## 3. Migration — Observer

- [x] 3.1 Replace 4 `logEvent()` calls in `src/harness/observer.ts` with direct `logger.info()` calls
- [x] 3.2 Replace 1 `console.warn` in observer with `logger.warn()`

## 4. Migration — Enforcer

- [x] 4.1 Verify and replace any `console.error/warn` calls in `src/harness/enforcer.ts` with logger

## 5. Migration — Improver

- [x] 5.1 Replace 3 `console.error` calls in `src/harness/improver.ts` with `logger.error()`

## 6. Migration — Orchestrator & Shared

- [x] 6.1 Replace `logEvent` call in `src/orchestrator/orchestrator.ts` with `logger.info()`
- [x] 6.2 Replace `console.error` in orchestrator with `logger.error()`
- [x] 6.3 Replace `console.error` in `src/shared/utils.ts` mergeEventHandlers with `logger.error()`

## 7. Verification

- [x] 7.1 Run `npm run build` and verify zero type errors
- [ ] 7.2 Run existing smoke tests and verify all pass
- [ ] 7.3 Manually verify `harness.jsonl` output with `HARNESS_LOG_LEVEL=debug`
