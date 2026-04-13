## MODIFIED Requirements

### Requirement: Plugin entry point
The plugin entry point `src/index.ts` SHALL include a `config` callback that registers agents and sets default_agent, in addition to existing server() function that returns merged hooks.

#### Scenario: Config callback registers agents
- **WHEN** OpenCode loads the plugin and calls the config callback
- **THEN** all agent definitions SHALL be merged into `opencodeConfig.agent` and `default_agent` SHALL be set to "orchestrator"
