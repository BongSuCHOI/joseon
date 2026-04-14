## MODIFIED Requirements

### Requirement: Plugin entry point with orchestrator
The plugin entry point `src/index.ts` SHALL merge Orchestrator hooks via `mergeEventHandlers` alongside existing observer, enforcer, and improver hooks.

#### Scenario: All hooks merged
- **WHEN** the plugin is loaded
- **THEN** observer, enforcer, improver, AND orchestrator hooks SHALL all be active via mergeEventHandlers
