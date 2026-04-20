## MODIFIED Requirements

### Requirement: Semantic compacting filter remains default-off
The system SHALL keep the current compacting behavior when the semantic relevance filter is disabled and SHALL use the filter only as a shadow signal until explicitly enabled. The compacting canary evaluation SHALL run independently of the semantic filter enablement when `compacting_canary_enabled` is true.

#### Scenario: Default-off preserves current compacting
- **WHEN** the semantic filter is not configured or is disabled
- **THEN** compacting SHALL behave as it does today and SHALL NOT use semantic relevance to remove or add entries

#### Scenario: Shadow relevance score is recorded
- **WHEN** compacting runs with the filter disabled
- **THEN** the system SHALL record the relevance score as a shadow signal without changing the selected context

#### Scenario: Enabled filter uses metadata first
- **WHEN** the filter is explicitly enabled
- **THEN** the system SHALL rank candidates using project_key, scope, recent activity, and recent violation metadata before any heavier relevance logic

#### Scenario: Canary runs independently of semantic filter
- **WHEN** `compacting_canary_enabled` is true regardless of `semantic_compacting_enabled`
- **THEN** the system SHALL evaluate the shadow record for baseline vs semantic differences and record mismatches

#### Scenario: Shadow record with canary block
- **WHEN** a compacting shadow record is created and `compacting_canary_enabled` is true
- **THEN** the record SHALL include a `canary` block with evaluation results
