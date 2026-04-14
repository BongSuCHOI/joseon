## 1. Hook Module Setup

- [x] 1.1 Create `src/hooks/delegate-task-retry.ts` — error pattern definitions + detect function + `tool.execute.after` hook that injects retry guidance via `chat.system.transform`
- [x] 1.2 Create `src/hooks/json-error-recovery.ts` — JSON error patterns + tool exclude list + `tool.execute.after` hook that injects correction reminder
- [x] 1.3 Create `src/hooks/post-file-tool-nudge.ts` — session-scoped flag + `tool.execute.after` trigger + `experimental.chat.system.transform` delegation nudge injection
- [x] 1.4 Create `src/hooks/post-read-nudge.ts` — `tool.execute.after` hook that appends delegation reminder to read tool output for orchestrator
- [x] 1.5 Create `src/hooks/phase-reminder.ts` — `experimental.chat.messages.transform` hook that injects 5-Phase workflow rules for builder agent only
- [x] 1.6 Create `src/hooks/index.ts` — barrel export + `createAllHooks(ctx)` that merges all 5 hooks into single hook object

## 2. Plugin Integration

- [x] 2.1 Modify `src/index.ts` — import `createAllHooks`, add to hook objects array before `mergeEventHandlers`

## 3. Verification

- [x] 3.1 Run `npm run build` and verify zero type errors
- [ ] 3.2 Run existing smoke tests and verify all pass (hooks are additive, no breaking changes)
- [ ] 3.3 Manual test: trigger a JSON error in tool output and verify correction reminder appears
