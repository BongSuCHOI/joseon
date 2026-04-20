## ADDED Requirements

### Requirement: LLM phase and signal shadow recording
The system SHALL record shadow labels for phase and signal relevance while keeping the deterministic phase state and signal emission path unchanged. When canary evaluation is enabled and a low-confidence proxy is matched, the system SHALL populate the shadow block with metadata-based evaluation results instead of the default stub.

#### Scenario: Shadow record is appended without baseline change
- **WHEN** a session event produces a candidate phase or signal decision
- **THEN** the system SHALL append a shadow record and SHALL NOT modify the existing phase file or deterministic signal result

#### Scenario: Shadow record tolerates low confidence
- **WHEN** the LLM result has low confidence or is unavailable
- **THEN** the system SHALL keep the deterministic result as the source of truth and SHALL record only the shadow outcome

#### Scenario: Canary populates shadow block on proxy match
- **WHEN** canary_enabled=true and a low-confidence proxy is matched
- **THEN** the system SHALL append a shadow record with `shadow.status="evaluated"`, `shadow.phase_hint` or `shadow.signal_relevance`, and `shadow.confidence` populated from metadata-based canary evaluation

#### Scenario: Canary disabled keeps stub
- **WHEN** canary_enabled=false (default)
- **THEN** shadow records SHALL remain as stubs (`status: 'unavailable'`, `confidence: 0`) identical to pre-5f behavior

### Requirement: Diff-based mistake-pattern shadow learning
The system SHALL extract mistake summaries from fix diffs and store them as shadow learning records without auto-promoting rules. The system SHALL additionally trigger candidate grouping after each non-ambiguous shadow append.

#### Scenario: Fix diff creates a shadow summary
- **WHEN** a fix commit diff is available
- **THEN** the system SHALL append a `mistake_summary` shadow record that captures the observed mistake pattern

#### Scenario: Ambiguous diff stays in shadow mode
- **WHEN** the diff is too large or ambiguous to classify safely
- **THEN** the system SHALL store the partial summary only and SHALL NOT promote it to a rule candidate

#### Scenario: Non-ambiguous shadow triggers candidate grouping
- **WHEN** a non-ambiguous shadow record is appended
- **THEN** the system SHALL invoke the candidate grouping logic to check pattern identity and update candidates if the repetition threshold is met

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
