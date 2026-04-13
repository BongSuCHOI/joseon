## ADDED Requirements

### Requirement: Orchestrator prompt
The orchestrator system prompt SHALL define it as the primary entry point for all requests. It SHALL route large-scale work to @build, handle small tasks directly or delegate to independent subagents, and NOT engage in Phase management.

#### Scenario: Orchestrator handles a question
- **WHEN** user asks "explain this file"
- **THEN** orchestrator SHALL answer directly without Phase involvement

#### Scenario: Orchestrator delegates to build
- **WHEN** user requests a large implementation task
- **THEN** orchestrator SHALL delegate to @build via Task tool with context

#### Scenario: Orchestrator delegates to independent subagent
- **WHEN** user requests a small bug fix
- **THEN** orchestrator MAY delegate directly to @fixer or handle itself without @build

### Requirement: Build PM prompt
The @build system prompt SHALL define it as Phase PM that manages Phase 1-5 workflow, distributes work to subagents, resets Phase on completion, and reports back to Orchestrator. It SHALL NOT engage in general conversation.

#### Scenario: Build manages Phase workflow
- **WHEN** @build receives a delegated task
- **THEN** it SHALL start Phase 1 (planning) and progress through phases using phase-manager

#### Scenario: Build resets Phase on completion
- **WHEN** @build completes Phase 5
- **THEN** it SHALL call resetPhase() and report completion to Orchestrator

#### Scenario: Build detects incomplete phase
- **WHEN** @build is invoked and an incomplete phase exists
- **THEN** it SHALL ask the user whether to resume or restart

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

#### Scenario: Cross-reviewer agent prompt
- **WHEN** cross-reviewer agent is invoked
- **THEN** its prompt SHALL define it as cross-model reviewer with minimal permissions (file_edit, bash, task denied)

### Requirement: Prompt loading from files
Agent prompts SHALL be loaded from `src/agents/prompts/{agent-name}.md` files. The factory functions SHALL read these files and embed them in agent config.

#### Scenario: Load orchestrator prompt
- **WHEN** `createOrchestratorAgent()` is called
- **THEN** it SHALL read `src/agents/prompts/orchestrator.md` and use it as the system prompt
