## Why

All harness and agent settings are hardcoded in source files — temperature in `agents.ts`, thresholds in `enforcer.ts`/`improver.ts`/`qa-tracker.ts`, limits in `error-recovery.ts`/`utils.ts`. Users cannot customize agent models, temperatures, or harness behavior without editing plugin source code. For npm distribution, a declarative config file is essential.

## What Changes

- Introduce `src/config/schema.ts` — config type definitions (no Zod dependency, manual validation)
- Introduce `src/config/loader.ts` — JSONC/JSON config file loader with global + project merge
- Introduce `src/config/index.ts` — barrel export + `loadConfig()` convenience function
- Modify `src/agents/agents.ts` — read agent overrides from config instead of hardcoding
- Modify `src/index.ts` — pass config to agent registration
- Modify harness modules to read thresholds from config instead of hardcoded values

## Capabilities

### New Capabilities
- `config-system`: Config schema definition + JSONC/JSON file loader with global/project merge

### Modified Capabilities
- `harness-shared-infra`: Config loader integration; modules read settings from config instead of hardcoded values
- `agent-definitions`: Agent creation reads model/temperature/hidden from config overrides

## Impact

- **New files**: `src/config/schema.ts`, `src/config/loader.ts`, `src/config/index.ts`
- **Modified files**: `src/shared/index.ts`, `src/agents/agents.ts`, `src/index.ts`, `src/harness/enforcer.ts`, `src/harness/improver.ts`, `src/orchestrator/error-recovery.ts`, `src/orchestrator/qa-tracker.ts`, `src/shared/utils.ts`
- **Dependencies**: None (JSONC parsing via regex strip, no new packages)
- **Breaking**: None — all config keys have sensible defaults matching current hardcoded values
- **Runtime**: New file `~/.config/opencode/harness.jsonc` (optional, plugin works without it)
