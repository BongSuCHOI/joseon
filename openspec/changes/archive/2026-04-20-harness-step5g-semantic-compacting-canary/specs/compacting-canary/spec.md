## ADDED Requirements

### Requirement: Compacting canary mismatch detection
The system SHALL evaluate each compacting shadow record to detect meaningful differences between baseline and semantic selections when `compacting_canary_enabled` is true.

#### Scenario: Rule omission detected
- **WHEN** a compacting shadow record shows a rule present in baseline_selection but absent from applied_selection
- **THEN** the system SHALL record a mismatch of type `rule_omission` with the omitted rule's ID and confidence score

#### Scenario: Fact omission detected
- **WHEN** a compacting shadow record shows a fact present in baseline_selection but absent from applied_selection
- **THEN** the system SHALL record a mismatch of type `fact_omission` with the omitted fact's ID and confidence score

#### Scenario: Rank inversion detected
- **WHEN** a compacting shadow record shows the top-ranked baseline rule or fact appearing beyond position 3 in the semantic ranking
- **THEN** the system SHALL record a mismatch of type `rank_inversion` with the item's ID, baseline rank, and semantic rank

#### Scenario: Canary disabled — no evaluation
- **WHEN** `compacting_canary_enabled` is false (default)
- **THEN** the system SHALL NOT evaluate compacting shadows and SHALL NOT record any mismatches

### Requirement: Compacting canary mismatch persistence
The system SHALL persist mismatch records to `projects/{key}/compacting-canary-mismatches.jsonl` as append-only JSONL.

#### Scenario: Mismatch record written
- **WHEN** a compacting canary evaluation detects one or more mismatches
- **THEN** the system SHALL append a `CompactingCanaryMismatchRecord` for each mismatch type detected

#### Scenario: No mismatch — nothing written
- **WHEN** baseline and semantic selections are identical or differences are below threshold
- **THEN** the system SHALL NOT append any mismatch record

### Requirement: Compacting canary aggregation report
The system SHALL provide an on-demand aggregation report summarizing mismatch patterns across all compacting canary evaluations.

#### Scenario: Report generation
- **WHEN** `generateCompactingCanaryReport(worktree)` is called
- **THEN** the system SHALL return a report containing total evaluations, total mismatches, mismatch rate, breakdown by mismatch type, and promotion candidates

#### Scenario: Promotion candidate identification
- **WHEN** a mismatch type's rate exceeds 30% of total evaluations for that type
- **THEN** the system SHALL include that mismatch type as a promotion candidate in the report

### Requirement: Compacting canary shadow block enrichment
The system SHALL enrich compacting shadow records with canary evaluation results when canary is enabled.

#### Scenario: Shadow record enriched with canary block
- **WHEN** a compacting shadow record is created and `compacting_canary_enabled` is true
- **THEN** the system SHALL add a `canary` block to the record containing evaluated flag, mismatches array, confidence, and reason

#### Scenario: No canary block when disabled
- **WHEN** `compacting_canary_enabled` is false
- **THEN** the shadow record SHALL NOT include a `canary` block
