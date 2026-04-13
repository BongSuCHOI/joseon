## ADDED Requirements

### Requirement: Scenario-based QA failure tracking
The system SHALL track QA failures per scenario in `projects/{key}/qa-failures.json`. Each scenario SHALL have independent failure counting with a maximum of 3 retries before escalation.

#### Scenario: First failure returns retry
- **WHEN** `trackQAFailure(projectKey, "login-form-validation", "Expected success, got 500")` is called for the first time
- **THEN** system SHALL return `{ verdict: "retry", count: 1 }` and update qa-failures.json

#### Scenario: Second failure returns retry
- **WHEN** same scenario fails a second time
- **THEN** system SHALL return `{ verdict: "retry", count: 2 }`

#### Scenario: Third failure returns escalate
- **WHEN** same scenario fails a third time
- **THEN** system SHALL return `{ verdict: "escalate", count: 3 }`

#### Scenario: Different scenarios tracked independently
- **WHEN** scenario "login-form-validation" has 2 failures and scenario "signup-email" has 1 failure
- **THEN** each SHALL be tracked independently in qa-failures.json

### Requirement: QA failure detail recording
The system SHALL record failure details including timestamp and error description for each failure.

#### Scenario: Record failure detail
- **WHEN** `trackQAFailure(projectKey, scenarioId, detail)` is called
- **THEN** system SHALL append `{ timestamp, detail }` to the scenario's `details` array in qa-failures.json
