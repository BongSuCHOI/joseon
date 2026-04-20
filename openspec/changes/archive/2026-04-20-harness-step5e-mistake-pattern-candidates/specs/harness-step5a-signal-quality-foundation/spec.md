## MODIFIED Requirements

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
