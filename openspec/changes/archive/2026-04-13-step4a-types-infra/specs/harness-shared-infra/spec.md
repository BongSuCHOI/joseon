## MODIFIED Requirements

### Requirement: Type definitions
The shared type system SHALL include all types needed for Step 4 orchestration.

#### Scenario: Signal type extended with agent_id
- **WHEN** a Signal is created by the orchestrator
- **THEN** it MAY include `agent_id?: string` to identify which agent generated the signal

#### Scenario: PhaseState type available
- **WHEN** Phase Manager reads or writes phase state
- **THEN** it SHALL use the `PhaseState` interface with `current_phase`, `phase_history`, `qa_test_plan_exists`, and optional `incomplete_phase`

#### Scenario: QAFailures type available
- **WHEN** QA tracker records failures
- **THEN** it SHALL use the `QAFailures` interface with scenario-level `count`, `last_failure_at`, and `details` array

#### Scenario: EvalResult type available
- **WHEN** harness eval results are read
- **THEN** it SHALL use the `EvalResult` interface with `total_checks`, `passed_checks`, `hard_ratio`, and `failures` array
