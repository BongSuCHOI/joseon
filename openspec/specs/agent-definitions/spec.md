## ADDED Requirements

### Requirement: Agent factory functions
The system SHALL provide `createXxxAgent()` factory functions for each agent: orchestrator, build, frontend, backend, tester, reviewer, cross-reviewer. Each factory SHALL return an AgentDefinition with name, description, config (prompt, temperature, model), and optional permissions.

#### Scenario: Create orchestrator agent
- **WHEN** `createOrchestratorAgent()` is called
- **THEN** it SHALL return AgentDefinition with name "orchestrator", mode "primary", temperature 0.1, and the orchestrator system prompt

#### Scenario: Create build agent
- **WHEN** `createBuildAgent()` is called
- **THEN** it SHALL return AgentDefinition with name "build", mode "subagent", temperature 0.1, and the build PM system prompt

#### Scenario: Create cross-reviewer agent with restricted permissions
- **WHEN** `createCrossReviewerAgent()` is called
- **THEN** it SHALL return AgentDefinition with permission `{ file_edit: "deny", bash: "deny", task: "deny" }`

### Requirement: Agent auto-registration via config callback
The plugin SHALL register all agents via the `config` callback in `src/index.ts`, merging into `opencodeConfig.agent` with shallow merge (plugin defaults first, user overrides win).

#### Scenario: Register agents on fresh config
- **WHEN** config callback fires and `opencodeConfig.agent` is empty
- **THEN** all agent definitions SHALL be merged into `opencodeConfig.agent`

#### Scenario: User overrides preserved
- **WHEN** config callback fires and user has existing agent config for "orchestrator"
- **THEN** user's fields SHALL override plugin defaults (shallow merge)

### Requirement: Default agent set to orchestrator
The plugin SHALL set `opencodeConfig.default_agent` to "orchestrator" when the user has not already configured one.

#### Scenario: No user default_agent
- **WHEN** config callback fires and `opencodeConfig.default_agent` is not set
- **THEN** it SHALL be set to "orchestrator"

#### Scenario: User has default_agent
- **WHEN** config callback fires and `opencodeConfig.default_agent` is already set
- **THEN** it SHALL NOT be overridden
