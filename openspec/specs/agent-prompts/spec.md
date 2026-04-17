## ADDED Requirements

### Requirement: Orchestrator prompt
The orchestrator system prompt SHALL define it as the primary entry point for all requests. It SHALL handle conversational or trivial work directly, route larger tasks to specialist subagents, and NOT engage in Phase management.

#### Scenario: Orchestrator handles a question
- **WHEN** user asks "explain this file"
- **THEN** orchestrator SHALL answer directly without Phase involvement

#### Scenario: Orchestrator delegates to specialists
- **WHEN** user requests a large implementation task
- **THEN** orchestrator SHALL delegate to the appropriate specialist subagent via Task tool with context

#### Scenario: Orchestrator delegates to independent subagent
- **WHEN** user requests a small bug fix
- **THEN** orchestrator MAY delegate directly to @coder or handle itself without phase-managed routing

### Requirement: Specialist prompts
Each specialist prompt SHALL define a focused role aligned with the current active roster: frontend, backend, tester, reviewer, designer, explorer, librarian, coder, advisor.

### Requirement: Subagent prompts
Each subagent SHALL have a focused system prompt defining its role, constraints, and output format.

#### Scenario: Frontend agent prompt
- **WHEN** frontend agent is invoked
- **THEN** its prompt SHALL define it as frontend implementation specialist

#### Scenario: Backend agent prompt
- **WHEN** backend agent is invoked
- **THEN** its prompt SHALL define it as backend implementation specialist

#### Scenario: Tester agent prompt
- **WHEN** tester agent is invoked
- **THEN** its prompt SHALL define it as QA testing specialist that writes and runs tests

#### Scenario: Reviewer agent prompt
- **WHEN** reviewer agent is invoked
- **THEN** its prompt SHALL define it as read-only code reviewer (file_edit denied)

#### Scenario: Designer agent prompt
- **WHEN** designer agent is invoked
- **THEN** its prompt SHALL define it as UI/UX design specialist with creative freedom (temperature 0.7)

#### Scenario: Coder agent prompt
- **WHEN** coder agent is invoked
- **THEN** its prompt SHALL define it as a fast mechanical execution specialist

#### Scenario: Explorer agent prompt
- **WHEN** explorer agent is invoked
- **THEN** its prompt SHALL define it as a read-only internal codebase search specialist

#### Scenario: Librarian agent prompt
- **WHEN** librarian agent is invoked
- **THEN** its prompt SHALL define it as a read-only external documentation research specialist

#### Scenario: Advisor agent prompt
- **WHEN** advisor agent is invoked
- **THEN** its prompt SHALL define it as a read-only strategic advisor for architecture and debugging

### Requirement: Prompt loading from files
Agent prompts SHALL be loaded from `src/agents/prompts/{agent-name}.md` files. The agent construction logic in `src/agents/agents.ts` SHALL read these files and embed them in agent config.

#### Scenario: Load orchestrator prompt
- **WHEN** orchestrator agent definitions are constructed
- **THEN** the system SHALL read `src/agents/prompts/orchestrator.md` and use it as the system prompt
