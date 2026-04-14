## Why

The current logging is a dual-path mess: `logEvent()` writes raw JSONL without log levels, while 47 ad-hoc `console.error/warn` calls scatter unstructured output to stderr. There's no way to filter, search, or debug issues systematically. For npm distribution, users need structured, level-filtered logs to file bug reports.

## What Changes

- Introduce a unified `logger` module with log levels (`debug`, `info`, `warn`, `error`) replacing both `logEvent()` and all `console.error/warn` calls
- Consolidate category-scattered JSONL files into a single `harness.jsonl` with level-based filtering
- Add environment variable `HARNESS_LOG_LEVEL` for runtime level control (default: `info`)
- Add human-readable stderr format with module prefix for development debugging
- Deprecate `logEvent()` — redirect to new logger internally

## Capabilities

### New Capabilities
- `structured-logging`: Unified logging module with levels, filtering, and dual output (JSONL file + formatted stderr)

### Modified Capabilities
- `harness-shared-infra`: `logEvent()` deprecated in favor of new logger; `shared/index.ts` export updated
- `harness-observer`: 4 `logEvent` calls + 1 `console.warn` migrated to logger
- `harness-enforcer`: (verify and migrate any console calls)
- `orchestrator-plugin`: `console.error` and `logEvent` migrated to logger

## Impact

- **Files**: `src/shared/logger.ts` (new), `src/shared/utils.ts`, `src/shared/index.ts`, `src/shared/constants.ts`, `src/harness/observer.ts`, `src/harness/enforcer.ts`, `src/harness/improver.ts`, `src/orchestrator/orchestrator.ts`
- **Dependencies**: None (pure Node.js `fs` + `console`)
- **Breaking**: `logEvent()` API changes — but it's internal-only, no public API impact
- **Runtime**: Log directory structure changes from `logs/{sessions,tools,errors}/` to unified `logs/harness.jsonl`
