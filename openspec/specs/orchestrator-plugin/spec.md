## ADDED Requirements

### Requirement: Orchestrator plugin hooks
The system SHALL export `HarnessOrchestrator = async (ctx) => {}` that returns hooks for event handling, integrating Phase Manager, error recovery, and QA tracker.

#### Scenario: Session idle cleanup
- **WHEN** `session.idle` event fires
- **THEN** Orchestrator SHALL check for incomplete phases and log a summary

### Requirement: Agent ID injection in signals
The Orchestrator SHALL inject `agent_id` into signals when the signal source is identifiable as a specific agent.

#### Scenario: Signal from orchestrator agent
- **WHEN** a signal is generated during @orchestrator agent execution
- **THEN** the signal SHALL include `agent_id: "orchestrator"`
