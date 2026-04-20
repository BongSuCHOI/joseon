## DEPRECATED — Removed

This spec has been superseded. The `error-recovery.ts` module was removed because:

- **Stage 3 (cross_model_rescue)** overlaps entirely with `foreground-fallback.ts` (434-line fully implemented same-session model fallback)
- **Stages 1-2 (direct_fix, structural_change)** are string labels with no executable logic
- **Stages 4-5 (reset, escalate_to_user)** are better handled as system prompt guidance
- Delegation error handling is already covered by `delegate-task-retry.ts` hook
- Error repeat detection is already covered by `observer.ts` (error_repeat signal)

See `orchestrator-plugin/spec.md` for the current QA tracking approach.
