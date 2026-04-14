## Context

18 hardcoded configuration values are scattered across 6 source files. Users cannot override agent models, temperatures, or harness thresholds without editing TypeScript source. For npm distribution, a declarative config file is the standard pattern (omOs uses `oh-my-opencode-slim.jsonc`).

**Current hardcoded values:**

| Module | Values |
|--------|--------|
| `agents.ts` | temperature (8 agents), hidden (8 agents), description strings |
| `enforcer.ts` | `ENFORCER_REGEX_MAX_LENGTH = 10000`, SOFT→HARD threshold = 2 |
| `improver.ts` | `REGEX_MAX_TARGET_LENGTH = 10000`, 30-day eval period, pattern min length 3, scaffold match ratio 0.6, search maxResults 10 |
| `error-recovery.ts` | max recovery stages = 5 |
| `qa-tracker.ts` | escalation threshold = 3 |
| `shared/utils.ts` | `HISTORY_MAX_BYTES = 1048576` |

## Goals / Non-Goals

**Goals:**
- Users can override agent model/temperature/hidden via config file
- Users can tune harness thresholds (SOFT→HARD, escalation, history rotation)
- Config loaded from global (`~/.config/opencode/harness.jsonc`) + project (`.opencode/harness.jsonc`) with project taking precedence
- Zero new runtime dependencies (JSONC parsing via regex)
- All config keys have sensible defaults matching current hardcoded values

**Non-Goals:**
- Zod schema validation (deferred — manual validation sufficient for A2)
- Agent prompt override via config (deferred to later phase)
- Per-agent MCP/skill/tool deny list (deferred to post-npm enhancement)
- Config hot-reload (requires session restart to pick up changes)
- JSONC schema file for IDE autocomplete (deferred)

## Decisions

### D1: No Zod — manual validation

**Decision:** Manual type checking with defaults, no Zod dependency.

**Rationale:** Our package currently has zero runtime dependencies. Adding Zod for a single config validation is over-engineering for A2. Manual validation with defaults is ~30 lines and keeps the package dependency-free.

**Alternative considered:** Zod (omOs uses it). Rejected because omOs has 10+ dependencies already; we're optimizing for zero-dep purity.

### D2: Config file format — JSONC with JSON fallback

**Decision:** Primary `harness.jsonc`, fallback `harness.json`. JSONC = JSON with `//` comments and trailing commas stripped via regex.

**Rationale:** Same pattern as omOs. Users can comment their configs. Regex-based JSONC stripping is ~5 lines, battle-tested.

### D3: Two-tier config — global + project

**Decision:**
```
~/.config/opencode/harness.jsonc     ← global (all projects)
<project>/.opencode/harness.jsonc    ← project-specific (overrides global)
```
Project config deep-merges on top of global config.

**Rationale:** omOs pattern. Global for user preferences (default model), project for per-project tuning (specific temperatures for specific codebases).

### D4: Config schema structure

**Decision:**
```jsonc
{
  "agents": {
    "<agent-name>": {
      "model": "claude-sonnet",      // optional
      "temperature": 0.1,             // optional
      "hidden": false                 // optional
    }
  },
  "harness": {
    "soft_to_hard_threshold": 2,      // enforcer
    "escalation_threshold": 3,        // qa-tracker
    "max_recovery_stages": 5,         // error-recovery
    "history_max_bytes": 1048576,     // utils
    "regex_max_length": 10000,        // enforcer + improver
    "scaffold_match_ratio": 0.6,      // improver
    "search_max_results": 10          // improver
  }
}
```

Flat structure, no nesting beyond `agents` and `harness`. Easy to document, easy to validate.

### D5: Config loading timing

**Decision:** Load once at plugin init (server() call), cache in memory. Modules read from cached object.

**Rationale:** Config shouldn't change mid-session. Loading once avoids filesystem reads on every tool execution.

## Risks / Trade-offs

- **[Risk] Manual validation misses edge cases** → Mitigated: strict defaults + type narrowing. Invalid keys silently ignored (not errors).
- **[Risk] JSONC regex stripping breaks on edge cases** → Mitigated: well-known pattern (strip `//...` comments and trailing commas). omOs uses identical approach.
- **[Risk] Config file becomes stale after plugin update** → Mitigated: all keys optional with defaults. Missing keys = default behavior.
