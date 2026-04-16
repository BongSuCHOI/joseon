## ADDED Requirements

### Requirement: Cross-session memory upper-stage shadow recording
The system SHALL record shadow outputs for Extract, Consolidate, Relate, and Recall while keeping the existing Sync, Index, and Search behavior unchanged by default.

#### Scenario: Upper-stage candidate is recorded
- **WHEN** a session archive or memory fact produces a candidate for an upper memory stage
- **THEN** the system SHALL append a shadow record for that stage and SHALL NOT change the current Search result

#### Scenario: Missing shadow data falls back safely
- **WHEN** shadow extraction is unavailable or incomplete
- **THEN** the system SHALL preserve the existing memory flow and SHALL keep the lower-stage path as the source of truth

### Requirement: Semantic compacting filter remains default-off
The system SHALL keep the current compacting behavior when the semantic relevance filter is disabled and SHALL use the filter only as a shadow signal until explicitly enabled.

#### Scenario: Default-off preserves current compacting
- **WHEN** the semantic filter is not configured or is disabled
- **THEN** compacting SHALL behave as it does today and SHALL NOT use semantic relevance to remove or add entries

#### Scenario: Shadow relevance score is recorded
- **WHEN** compacting runs with the filter disabled
- **THEN** the system SHALL record the relevance score as a shadow signal without changing the selected context

#### Scenario: Enabled filter uses metadata first
- **WHEN** the filter is explicitly enabled
- **THEN** the system SHALL rank candidates using project_key, scope, recent use, and recent violation metadata before any heavier relevance logic
