## ADDED Requirements

### Requirement: Agent-visible skills are filtered by configuration
The system SHALL filter the skills surfaced in the chat prompt for each agent so the agent only sees skills permitted by its configuration.

#### Scenario: Specific allow list
- **WHEN** an agent is configured with `skills: ["agent-browser"]`
- **THEN** the exposed available skills list contains only `agent-browser`

#### Scenario: Star with exclusions
- **WHEN** an agent is configured with `skills: ["*", "!simplify"]`
- **THEN** the exposed available skills list contains all skills except `simplify`

#### Scenario: No skills configured
- **WHEN** an agent has no `skills` configuration or an empty skills list
- **THEN** the exposed available skills list contains no entries
