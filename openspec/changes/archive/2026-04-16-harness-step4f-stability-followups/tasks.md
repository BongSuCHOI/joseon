## 1. Hook and config wiring

- [x] 1.1 Thread harness config / worktree into `src/hooks/index.ts` so hook factories can share session state and agent config.
- [x] 1.2 Add `src/hooks/filter-available-skills.ts` and register it so the surfaced skill catalog is rewritten to only include allowed skills.
- [x] 1.3 Add `src/hooks/foreground-fallback.ts` and register it so retryable model failures advance the active fallback cursor.
- [x] 1.4 Update `src/index.ts` to consume fallback state when registering agents and keep the new hook state connected to the config callback.

## 2. Core harness hardening

- [x] 2.1 Add bounded compaction logic in `src/harness/improver.ts` so compaction prioritizes scaffold/hard rules and caps lower-priority content.
- [x] 2.2 Keep fix-commit detection message-based in `src/harness/improver.ts` and preserve `source_file` as metadata only.
- [x] 2.3 Extract any tiny pure helpers needed to make the new compaction, skill-filtering, and fallback logic testable.

## 3. Tests and verification

- [x] 3.1 Extend smoke coverage in `test/smoke-test.ts` and `test/smoke-test-step4.ts` for compaction bounds, skill filtering, foreground fallback, and fix-commit regression.
- [x] 3.2 Run `npm run build` and fix any type or integration regressions.
- [x] 3.3 Run the smoke suite with `npx tsx` and ensure the new behavior passes without regressions.
- [x] 3.4 If fallback behavior needs live confirmation, run `npm run deploy` and validate the foreground fallback path in tmux with a retryable failure scenario.

## 4. Finalization

- [x] 4.1 Archive the OpenSpec change after all checks pass.
