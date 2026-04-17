## ADDED Requirements

### Requirement: Extract-stage memory shadow recording
The system SHALL record append-only shadow outputs for Extract candidates produced during session-to-fact indexing while keeping the existing Sync, Index, and Search behavior unchanged by default.

#### Scenario: Extract candidate is recorded
- **WHEN** a session log entry is materialized into a memory fact candidate
- **THEN** the system SHALL append an Extract shadow record for that candidate and SHALL NOT change the current Search result

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
- **THEN** the system SHALL rank candidates using project_key, scope, recent activity, and recent violation metadata before any heavier relevance logic
