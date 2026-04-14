## 1. Config Schema

- [x] 1.1 Create `src/config/schema.ts` — define `AgentOverrideConfig`, `HarnessSettings`, `HarnessConfig` interfaces with all optional fields and default values
- [x] 1.2 Create `src/config/loader.ts` — implement `stripJsonc()` (regex-based comment + trailing comma removal), `loadJsoncFile()`, and `loadConfig(directory)` with global + project merge
- [x] 1.3 Create `src/config/index.ts` — barrel export of schema types and loader functions

## 2. Agent Config Integration

- [x] 2.1 Modify `src/agents/agents.ts` — accept `HarnessConfig` parameter in `createAgents()`, apply `agents[name]` overrides (model/temperature/hidden) to each agent definition
- [x] 2.2 Modify `src/index.ts` — load config in `server()`, pass to `createAgents(config)`

## 3. Harness Config Integration

- [x] 3.1 Modify `src/harness/enforcer.ts` — read `soft_to_hard_threshold` and `regex_max_length` from config instead of hardcoded constants
- [x] 3.2 Modify `src/harness/improver.ts` — read `regex_max_length`, `scaffold_match_ratio`, `search_max_results` from config
- [x] 3.3 Modify `src/orchestrator/error-recovery.ts` — read `max_recovery_stages` from config
- [x] 3.4 Modify `src/orchestrator/qa-tracker.ts` — read `escalation_threshold` from config
- [x] 3.5 Modify `src/shared/utils.ts` — read `history_max_bytes` from config

## 4. Verification

- [x] 4.1 Run `npm run build` and verify zero type errors
- [ ] 4.2 Run existing smoke tests and verify all pass (config defaults match old hardcoded values)
- [ ] 4.3 Create a test `harness.jsonc` with overrides and verify agent definitions reflect the overrides
