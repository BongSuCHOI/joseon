## ADDED Requirements

### Requirement: Error recovery 4-stage escalation
The system SHALL implement a 4-stage error recovery process: (1) direct fix, (2) structural change, (3) different model rescue via cross-reviewer, (4) reset and retry. Each stage SHALL be tried sequentially, recording the attempt in error-recovery.jsonl.

#### Scenario: Stage 1 direct fix attempt
- **WHEN** `attemptRecovery(projectKey, error, context)` is called for the first time on an error
- **THEN** system SHALL return `{ stage: 1, action: "direct_fix" }` and append the attempt to error-recovery.jsonl

#### Scenario: Stage 2 structural change
- **WHEN** stage 1 has been attempted and failed (same error persists)
- **THEN** system SHALL return `{ stage: 2, action: "structural_change" }` and record the attempt

#### Scenario: Stage 3 cross-model rescue
- **WHEN** stages 1-2 have failed
- **THEN** system SHALL return `{ stage: 3, action: "cross_model_rescue" }` indicating cross-reviewer should be invoked

#### Scenario: Stage 4 reset
- **WHEN** stages 1-3 have all failed
- **THEN** system SHALL return `{ stage: 4, action: "reset" }` indicating a revert and fresh approach is needed

#### Scenario: Stage 4 failure — user escalation
- **WHEN** stage 4 also fails
- **THEN** system SHALL return `{ stage: 5, action: "escalate_to_user" }` and stop automatic recovery

### Requirement: Error recovery history logging
The system SHALL log each recovery attempt to `projects/{key}/error-recovery.jsonl` with stage, timestamp, error summary, and result.

#### Scenario: Log recovery attempt
- **WHEN** any recovery stage is attempted
- **THEN** system SHALL append `{ timestamp, stage, action, error_summary, result }` to the JSONL file
