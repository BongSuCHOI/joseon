## Context

OpenCode plugins register hooks (event handlers) that intercept tool execution, chat messages, and session events. Our current hooks are scattered across 4 plugin files (observer, enforcer, improver, orchestrator) with no dedicated hooks directory. omOs implements 13 hooks in a dedicated `hooks/` module — we need 5 of them for npm distribution stability.

**Current failure modes without these hooks:**

1. **Subagent delegation fails silently** — orchestrator delegates to @frontend, tool returns error, no retry logic → user must manually intervene
2. **JSON parse errors loop** — LLM sends malformed JSON arguments, tool fails, LLM repeats same mistake → session stalls
3. **Orchestrator implements directly** — instead of delegating to specialist, orchestrator reads files and implements itself → defeats purpose of multi-agent architecture
4. **Builder forgets Phase rules** — during long sessions, builder drifts from 5-Phase workflow → phases get skipped or mixed

## Goals / Non-Goals

**Goals:**
- Automatic recovery for delegation failures and JSON parse errors
- Nudge orchestrator to delegate instead of implementing directly
- Phase workflow reminder for builder agent
- All hooks in dedicated `src/hooks/` directory with clean barrel export

**Non-Goals:**
- foreground-fallback (requires multi-model environment)
- filter-available-skills (requires skill allowedAgents system)
- todo-continuation / autopilot (deferred to post-npm enhancement)
- apply-patch (OpenCode has built-in patch tool)
- auto-update-checker (needed after npm publish)
- chat-headers (we don't use custom HTTP headers)

## Decisions

### D1: Hook integration via mergeEventHandlers

**Decision:** Each hook returns a standard hook object, all merged into plugin's hook map via existing `mergeEventHandlers`.

**Rationale:** Already proven pattern in `src/index.ts`. Multiple `tool.execute.after` handlers from different hooks all execute without overwriting each other.

### D2: Error detection via string pattern matching

**Decision:** Both delegate-task-retry and json-error-recovery detect errors by regex-matching tool output strings. No structured error codes.

**Rationale:** omOs uses the same approach (`DELEGATE_TASK_ERROR_PATTERNS`, `JSON_ERROR_PATTERNS`). LLM output is unstructured text — regex is the only reliable detection method.

### D3: Nudge injection via chat.system.transform

**Decision:** post-file-tool-nudge uses `experimental.chat.system.transform` to inject delegation reminders. post-read-nudge uses `tool.execute.after` with append guidance.

**Rationale:** Two different injection points for two different timing needs. File-write nudge needs to persist across turns (system transform), file-read nudge is immediate feedback (tool after).

### D4: Phase reminder via chat.messages.transform

**Decision:** phase-reminder injects workflow rules into `experimental.chat.messages.transform`, scoped to builder agent only.

**Rationale:** omOs uses same approach — messages.transform runs right before API call so it doesn't clutter UI. Agent scoping prevents non-builder agents from seeing Phase rules.

### D5: Hook directory structure

**Decision:** One file per hook in `src/hooks/`, barrel export in `index.ts`.

```
src/hooks/
├── index.ts                  ← createAllHooks(ctx) + barrel export
├── delegate-task-retry.ts    ← tool.execute.after
├── json-error-recovery.ts    ← tool.execute.after
├── post-file-tool-nudge.ts   ← tool.execute.after + chat.system.transform
├── post-read-nudge.ts        ← tool.execute.after
└── phase-reminder.ts         ← chat.messages.transform
```

**Rationale:** One file per hook keeps each concern isolated. Easy to enable/disable individual hooks. Matches omOs structure.

## Risks / Trade-offs

- **[Risk] False positives in error detection** → Mitigated: omOs patterns are battle-tested. Our patterns derived from same source.
- **[Risk] Nudge fatigue — too many reminders** → Mitigated: nudge only triggers on specific tool types (write/edit for file nudge, read for read nudge). Rate-limit via session-scoped flag (once per N tool calls).
- **[Risk] Pattern matching on tool output strings is fragile** → Mitigated: LLM error output is surprisingly consistent across providers. omOs validates this at scale.
