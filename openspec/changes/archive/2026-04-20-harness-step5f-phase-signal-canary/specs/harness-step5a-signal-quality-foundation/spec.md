## MODIFIED Requirements

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
