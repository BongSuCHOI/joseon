## DEPRECATED — Removed

This spec has been removed during the Simplify refactoring. The Phase management system (`phase-manager.ts`, `phase-reminder.ts`) was deleted because:

- The builder agent (its only caller) was removed
- Phase-based LLM judgment was replaced by deterministic `signalToRule()` in the improver
- Workflow management is now handled by OpenCode's superpowers skill chain
- No code in the project references or uses Phase state anymore

The `orchestrator-phase.json` file format and Phase 2.5 QA gate are no longer operational.
