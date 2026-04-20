## ADDED Requirements

### Requirement: Multi-check acceptance evaluation
The system SHALL evaluate accepted ack using multiple checks instead of a single rule_written check. The checks SHALL be: rule_written (rule file exists), rule_valid (rule JSON parses and has required fields), and not_prune_candidate (rule is not marked as prune candidate). Checks SHALL be evaluated in order with short-circuit: if a check fails, subsequent checks SHALL be skipped.

#### Scenario: All checks pass — accepted
- **WHEN** ack_guard_enabled=true and a signal is being processed and the rule file exists AND the rule JSON parses with all required fields (id, type, pattern, description) AND the rule has no prune_candidate
- **THEN** the system SHALL record an AckRecord with acceptance_checks_passed=['rule_written','rule_valid','not_prune_candidate'], checks_failed=[], acceptance_verdict='accepted'

#### Scenario: Rule file missing — rejected at first check
- **WHEN** ack_guard_enabled=true and the rule file for the signal pattern does not exist on disk
- **THEN** the system SHALL record an AckRecord with acceptance_checks_passed=[], checks_failed=[{check:'rule_written',reason:'rule_file_not_found'}], acceptance_verdict='rejected' and SHALL NOT evaluate rule_valid or not_prune_candidate

#### Scenario: Rule file corrupt — rejected at second check
- **WHEN** ack_guard_enabled=true and the rule file exists but JSON.parse fails or required fields are missing
- **THEN** the system SHALL record an AckRecord with acceptance_checks_passed=['rule_written'], checks_failed=[{check:'rule_valid',reason:'rule_json_parse_error'|'rule_missing_required_fields'}], acceptance_verdict='rejected' and SHALL NOT evaluate not_prune_candidate

#### Scenario: Rule is prune candidate — rejected at third check
- **WHEN** ack_guard_enabled=true and rule_written and rule_valid pass but the rule has prune_candidate defined with guard_enabled=true
- **THEN** the system SHALL record an AckRecord with acceptance_checks_passed=['rule_written','rule_valid'], checks_failed=[{check:'not_prune_candidate',reason:'rule_is_prune_candidate'}], acceptance_verdict='rejected'

#### Scenario: Guard disabled — no multi-check evaluation
- **WHEN** ack_guard_enabled=false (default)
- **THEN** the system SHALL record a written AckRecord with acceptance_checks_passed=[], checks_failed=[], acceptance_verdict='rejected', reason='guard_disabled' and SHALL NOT call the multi-check evaluator

### Requirement: Accepted records are passive
The system SHALL NOT change any runtime behavior (compacting priority, prune protection, rule ordering) based on whether an ack is accepted or written. Accepted records exist only as logged data for future analysis.

#### Scenario: Accepted rule gets no special treatment
- **WHEN** an ack record has acceptance_verdict='accepted'
- **THEN** the system SHALL NOT modify compacting selection, prune candidate evaluation, or any other runtime behavior for the associated rule

### Requirement: Acknowledgment record schema extension
The system SHALL extend the AckRecord type to include acceptance_checks_passed (string array), acceptance_checks_failed (array of {check, reason}), and acceptance_verdict ('accepted'|'rejected'). The existing acceptance_check field SHALL NOT be written for new records.

#### Scenario: New ack record uses extended schema
- **WHEN** any ack record is appended after Step 5h deployment
- **THEN** the record SHALL contain acceptance_checks_passed, acceptance_checks_failed, and acceptance_verdict fields

#### Scenario: Old ack records remain readable
- **WHEN** existing ack-status.jsonl records have the old schema (acceptance_check:'rule_written')
- **THEN** the system SHALL NOT attempt to migrate or modify these records and they SHALL remain as-is in the append-only log

### Requirement: findRule helper for acceptance checks
The system SHALL provide a findRule function that returns the full Rule object (or null) instead of just a boolean. The existing ruleExists function SHALL be refactored to use findRule internally. All existing callers of ruleExists SHALL continue to work without changes.

#### Scenario: findRule returns rule for existing pattern
- **WHEN** a rule with matching pattern and project_key exists
- **THEN** findRule SHALL return the parsed Rule object

#### Scenario: findRule returns null for non-existent pattern
- **WHEN** no rule matches the pattern and project_key
- **THEN** findRule SHALL return null

### Requirement: Future acceptance check extensibility
The multi-check structure SHALL support adding new checks (effectiveness_confirmed, no_recent_recurrence, not_false_positive) in future steps without changing the AckRecord schema. New checks only need to be added to the evaluator function.

#### Scenario: New check added without schema change
- **WHEN** a future step adds a new check (e.g., effectiveness_confirmed) to the evaluator
- **THEN** the new check name SHALL appear in acceptance_checks_passed or acceptance_checks_failed and no AckRecord type change SHALL be required
