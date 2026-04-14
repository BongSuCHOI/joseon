## Why

When subagents fail or LLMs produce malformed JSON arguments, the session stalls with no recovery. Orchestrator agents sometimes implement directly instead of delegating. These are the top 3 failure modes users encounter in multi-agent orchestration, and npm distribution demands automated recovery for all of them.

## What Changes

- Introduce `src/hooks/` directory with 5 hook modules
- **delegate-task-retry**: Detects subagent delegation failures via output pattern matching and injects retry guidance into chat context
- **json-error-recovery**: Detects JSON parse errors in tool output and injects correction reminder
- **post-file-tool-nudge**: After file write/edit operations, injects delegation reminder to prevent orchestrator from implementing directly
- **post-read-nudge**: After file read operations, injects delegation reminder for the same purpose
- **phase-reminder**: Injects 5-Phase workflow rules into builder agent's context via `experimental.chat.messages.transform`
- Integrate all hooks into `src/index.ts` via `mergeEventHandlers`

## Capabilities

### New Capabilities
- `delegate-task-retry`: Subagent delegation failure detection + retry guidance injection
- `json-error-recovery`: JSON parse error detection in tool output + correction prompt injection
- `delegation-nudge`: Post-file and post-read delegation reminders to prevent direct implementation by orchestrator
- `phase-reminder`: 5-Phase workflow rule injection for builder agent context

### Modified Capabilities
- `orchestrator-plugin`: Hooks merged into plugin entry point via mergeEventHandlers

## Impact

- **New files**: `src/hooks/index.ts`, `src/hooks/delegate-task-retry.ts`, `src/hooks/json-error-recovery.ts`, `src/hooks/post-file-tool-nudge.ts`, `src/hooks/post-read-nudge.ts`, `src/hooks/phase-reminder.ts`
- **Modified files**: `src/index.ts` (hook integration)
- **Dependencies**: None (pure pattern matching + string injection)
- **Breaking**: None — additive only, no existing behavior changed
