## ADDED Requirements

### Requirement: Orchestrator plugin hooks
The system SHALL export `HarnessOrchestrator = async (ctx) => {}` that returns hooks for QA failure tracking and agent_id injection.

#### Scenario: QA failure detection from test output
- **WHEN** `tool.execute.after` fires with `tool === 'bash'` and output contains test failure patterns (jest, vitest, pytest, go test)
- **THEN** the system SHALL extract a scenario ID, call `trackQAFailure()`, and queue escalation guidance

#### Scenario: QA escalation injection
- **WHEN** a pending QA escalation exists and `experimental.chat.system.transform` fires
- **THEN** the system SHALL inject escalation guidance into the system prompt:
  - `verdict: 'retry'` → "[HARNESS QA TRACKER] Scenario X has failed N time(s). Retry with a fix."
  - `verdict: 'escalate'` → "[HARNESS QA ESCALATION] Scenario X has failed N times. ESCALATE TO USER."

### Requirement: Agent ID context
The Orchestrator SHALL receive the `sessionAgents` Map (session→agent mapping) so it can correlate tool outputs with the originating agent.

#### Scenario: Context with sessionAgents
- **WHEN** `HarnessOrchestrator({ worktree, config, sessionAgents })` is called
- **THEN** the orchestrator SHALL have access to the session→agent mapping for agent attribution

### Requirement: Scenario ID extraction
The system SHALL extract scenario identifiers from test output using patterns: jest/vitest describe/it blocks, pytest test names, go test function names, with fallback to a hash of the first failure line.
