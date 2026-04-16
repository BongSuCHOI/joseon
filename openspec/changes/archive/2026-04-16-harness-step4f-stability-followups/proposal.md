## Why

The harness is functionally complete, but a few stability gaps still remain: compacting can still grow without a hard upper bound, skill exposure is not filtered at the prompt layer, and foreground model fallback is only partially wired. In addition, fix-commit detection needs to be captured as a stable contract so the existing behavior stays consistent and documented.

## What Changes

- Bound compacting context so `experimental.session.compacting` cannot inject unbounded scaffold/rules/memory payloads.
- Codify and preserve the current fix-commit detection contract: commit-message-based signals, no file-path-as-pattern leakage.
- Add a hook to filter the surfaced `available_skills` block per agent allow/deny config.
- Add foreground fallback behavior that consumes configured fallback chains when the primary model is rate-limited or unavailable.
- Refresh project markdown docs to match the current harness layout and the new stability behaviors.

## Capabilities

### New Capabilities
- `compacting-budget`: compacting must stay within a bounded context budget.
- `fix-commit-detection`: fix commits must produce stable, message-based signals.
- `available-skills-filter`: the visible skill surface must be filtered per agent configuration.

### Modified Capabilities
- `foreground-fallback`: runtime fallback behavior must switch to the next configured model when the foreground model cannot continue.

## Impact

- `src/harness/improver.ts`
- `src/hooks/` and `src/hooks/index.ts`
- `src/index.ts`, `src/agents/agents.ts`
- Smoke tests and live verification flow
- `README.md`, `AGENTS.md`, `docs/development-guide.md`, and any other stale markdown docs that describe the harness architecture or behavior
