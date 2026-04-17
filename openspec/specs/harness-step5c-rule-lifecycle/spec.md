## ADDED Requirements

### Requirement: Guarded rule pruning
The system SHALL mark prune candidates first and SHALL delete rules only when the guard conditions are satisfied. The system SHALL NOT automatically prune `scope: prompt` rules.

#### Scenario: Prune candidate is marked
- **WHEN** a rule is old, unused, or ineffective enough to be considered for pruning
- **THEN** the system SHALL mark it as a prune candidate and SHALL keep it in storage until the guard passes

#### Scenario: Guard missing prevents deletion
- **WHEN** prune conditions are not fully met or the guard is disabled
- **THEN** the system SHALL NOT delete the rule and SHALL preserve the current rule state

#### Scenario: Prompt scope stays protected
- **WHEN** the target rule has `scope: prompt`
- **THEN** the system SHALL exclude it from automatic pruning

### Requirement: Cross-project auto promotion remains guarded-off
The system SHALL collect cross-project promotion candidates but SHALL keep automatic global promotion disabled by default.

#### Scenario: Single-project evidence stays local
- **WHEN** only one project provides evidence for a pattern
- **THEN** the system SHALL keep the pattern in local or candidate state and SHALL NOT auto-promote it to global

#### Scenario: Guarded-off mode prevents global writes
- **WHEN** cross-project promotion is not explicitly enabled
- **THEN** the system SHALL record only the candidate and SHALL NOT write a global rule automatically

#### Scenario: Manual global remains available
- **WHEN** a user or operator explicitly chooses the global path
- **THEN** the system SHALL allow the existing manual global workflow to continue unchanged
