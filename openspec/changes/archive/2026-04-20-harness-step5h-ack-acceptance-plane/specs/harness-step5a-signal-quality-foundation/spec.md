## MODIFIED Requirements

### Requirement: Guarded ack strengthening
The system SHALL keep the existing written-ack behavior by default and SHALL promote an ack to accepted only when the guard and multi-check acceptance evaluation all pass. When ack_guard_enabled=true, the system SHALL run the multi-check evaluator (rule_written, rule_valid, not_prune_candidate) instead of the previous single rule_written check.

#### Scenario: Guard disabled keeps written ack
- **WHEN** ack_guard_enabled=false (default)
- **THEN** the system SHALL preserve the existing written-ack flow with acceptance_verdict='rejected' and reason='guard_disabled'

#### Scenario: All multi-checks pass under guard
- **WHEN** ack_guard_enabled=true and all checks pass (rule_written, rule_valid, not_prune_candidate)
- **THEN** the system SHALL record a written AckRecord followed by an accepted AckRecord with acceptance_verdict='accepted'

#### Scenario: Multi-check fails under guard
- **WHEN** ack_guard_enabled=true but one or more checks fail
- **THEN** the system SHALL record only the written AckRecord with acceptance_verdict='rejected' and the failed checks listed in acceptance_checks_failed, and SHALL NOT record an accepted AckRecord
