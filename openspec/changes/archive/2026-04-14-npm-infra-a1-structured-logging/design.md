## Context

The harness system currently has two disjoint logging paths:

1. **`logEvent(category, filename, data)`** in `src/shared/utils.ts` — appends JSONL to category-specific files under `~/.config/opencode/harness/logs/{sessions,tools,errors}/`
2. **`console.error/warn`** — 47 ad-hoc calls scattered across all modules, outputting unstructured text to stderr

Neither path has log levels. Neither can be filtered. Neither provides a coherent debugging experience. For npm distribution, users need a single, structured log they can search, filter, and attach to bug reports.

**Reference:** omOs uses a minimal `log(message, data?)` function. Our needs are more demanding because the harness relies on file-based state management where logs are the primary debugging path.

## Goals / Non-Goals

**Goals:**
- Single, unified logging API replacing both `logEvent()` and all `console.error/warn`
- Log levels: `debug`, `info`, `warn`, `error`
- Runtime level filtering via `HARNESS_LOG_LEVEL` env var (default: `info`)
- Structured JSONL output to single file: `logs/harness.jsonl`
- Human-readable stderr output with module prefix for dev debugging
- Backward compatibility: existing `logEvent()` calls continue to work (redirected internally)

**Non-Goals:**
- Log rotation (already handled by `rotateHistoryIfNeeded`)
- Remote log shipping / external log services
- Log aggregation dashboards
- Per-module log level configuration (env var only for now)
- Pretty-print CLI log viewer (future consideration)

## Decisions

### D1: Single JSONL file vs category directories

**Decision:** Consolidate to `logs/harness.jsonl`

**Rationale:** Category directories were an early design that adds complexity without benefit. With log levels + module tags, filtering is trivial (`grep '"level":"error"'` or `grep '"module":"observer"'`). Single file is easier to rotate, tail, and attach to bug reports.

**Alternative considered:** Keep category directories + add levels. Rejected because it doubles the maintenance surface without proportional benefit.

### D2: Logger API shape

**Decision:** Named exports per level: `logger.debug(module, msg, data?)`, `logger.info(...)`, `logger.warn(...)`, `logger.error(...)`

**Rationale:** Mirrors standard logging libraries (pino, winston). Module parameter makes every log line traceable without string-interpolation tricks.

**Alternative considered:** Single `log(level, module, msg, data?)`. Rejected because per-level functions are more ergonomic and avoid typos in level strings.

### D3: stderr format

**Decision:** `[harness:<module>] <LEVEL>: <message>` with data appended if present

**Rationale:** Prefix pattern matches the existing `[harness]` convention used in current `console.error` calls. No color codes (CLI may pipe to file).

### D4: logEvent backward compatibility

**Decision:** `logEvent()` maps to `logger.info()` internally, with category added to data object. Mark as `@deprecated` in JSDoc.

**Rationale:** Zero-breaking-change migration. Existing callers keep working while we gradually move them to direct `logger` calls.

## Risks / Trade-offs

- **[Risk] Single large log file** → Mitigated: `rotateHistoryIfNeeded` already handles rotation at 1MB
- **[Risk] Losing category-based file separation** → Mitigated: `module` field in JSONL provides same filtering capability. Old files remain readable but won't receive new entries.
- **[Risk] Performance of synchronous file writes** → Acceptable: Same as current `logEvent` (appendFileSync). Already proven in production. Async would add complexity without measurable benefit at our volume.
