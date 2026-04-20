## ADDED Requirements

### Requirement: Low-confidence proxy identification
The system SHALL identify deterministic phase/signal decisions that match low-confidence proxy criteria before performing canary evaluation.

Low-confidence proxies:
- Phase 2.5 gate BLOCKED (agent requested Phase 3, deterministic blocked)
- Phase regression (phase_from > phase_to)
- user_feedback signal emitted (Korean keyword matching is inherently noisy)
- error_repeat count reaches 2 (one below the emission threshold of 3)

#### Scenario: Phase 2.5 gate blocked triggers canary
- **WHEN** `transitionPhase()` is called with targetPhase=3 and the Phase 2.5 gate blocks the transition
- **THEN** the system SHALL identify this as a low-confidence proxy and trigger canary evaluation

#### Scenario: Phase regression triggers canary
- **WHEN** `transitionPhase()` is called with phase_from=3 and phase_to=2
- **THEN** the system SHALL identify this as a low-confidence proxy and trigger canary evaluation

#### Scenario: user_feedback signal triggers canary
- **WHEN** a `user_feedback` signal is emitted by the deterministic keyword matcher
- **THEN** the system SHALL identify this as a low-confidence proxy and trigger canary evaluation

#### Scenario: error_repeat near-threshold triggers canary
- **WHEN** an error count for a normalized error key reaches exactly 2 (one below the emission threshold)
- **THEN** the system SHALL identify this as a low-confidence proxy and trigger canary evaluation

#### Scenario: Normal phase transition does not trigger canary
- **WHEN** `transitionPhase()` is called with phase_from=1 and phase_to=2 (normal forward transition)
- **THEN** the system SHALL NOT trigger canary evaluation

#### Scenario: Normal signal emission does not trigger canary
- **WHEN** a `fix_commit` signal is emitted
- **THEN** the system SHALL NOT trigger canary evaluation (fix_commit is not a noisy signal)

### Requirement: Metadata-based canary evaluation
The system SHALL compute canary evaluation results using only existing metadata from shadow records, rules, and history — without LLM calls.

Output fields:
- `phase_hint`: string classification of phase transition context (`"forward"`, `"blocked_gate"`, `"regression"`, `"same"`, `"reset"`)
- `signal_relevance`: string classification of signal relevance (`"high"`, `"medium"`, `"low"`)
- `confidence`: float 0.0–1.0 based on frequency of the same proxy situation in recent N shadow records

#### Scenario: Canary evaluates phase gate block
- **WHEN** Phase 2.5 gate blocks transition to Phase 3
- **THEN** canary SHALL compute `phase_hint="blocked_gate"` and `confidence` based on how often gate blocks appear in the last 10 shadow records

#### Scenario: Canary evaluates phase regression
- **WHEN** phase transitions from 3 to 2
- **THEN** canary SHALL compute `phase_hint="regression"` and `confidence` inversely proportional to regression frequency in recent records

#### Scenario: Canary evaluates user_feedback with multiple keywords
- **WHEN** user_feedback signal matches 2 or more Korean frustration keywords
- **THEN** canary SHALL compute `signal_relevance="high"`

#### Scenario: Canary evaluates user_feedback with single keyword
- **WHEN** user_feedback signal matches exactly 1 Korean frustration keyword
- **THEN** canary SHALL compute `signal_relevance="medium"`

#### Scenario: Canary computes confidence from historical frequency
- **WHEN** the same proxy type has occurred 5+ times in the last 10 shadow records
- **THEN** canary SHALL compute `confidence` ≤ 0.3 (frequent = less exceptional = low confidence that deterministic is wrong)

#### Scenario: Canary computes confidence for rare events
- **WHEN** the same proxy type has occurred fewer than 3 times in the last 10 shadow records
- **THEN** canary SHALL compute `confidence` ≥ 0.7 (rare = more exceptional = higher confidence that this deserves review)

### Requirement: Shadow block population
The system SHALL populate the `shadow` block of shadow records with canary evaluation results when a low-confidence proxy is matched and `canary_enabled` is true.

#### Scenario: Canary populates shadow block on proxy match
- **WHEN** a low-confidence proxy is matched and `canary_enabled=true`
- **THEN** the system SHALL write a new shadow record with `shadow.status="evaluated"`, `shadow.phase_hint` or `shadow.signal_relevance`, and `shadow.confidence` populated from canary evaluation

#### Scenario: Canary disabled does not populate shadow block
- **WHEN** `canary_enabled=false` (default)
- **THEN** shadow records SHALL remain as stubs (`status: 'unavailable'`, `confidence: 0`) identical to Step 5a behavior

### Requirement: Mismatch detection and logging
The system SHALL detect mismatches between deterministic decisions and canary evaluations, logging them to `canary-mismatches.jsonl`.

A mismatch occurs when:
- Phase: deterministic blocked transition, but canary `confidence` ≥ 0.7 AND `phase_hint` suggests the block may be incorrect
- Signal: deterministic did not emit, but canary `signal_relevance` is `"high"` or `"medium"` with `confidence` ≥ 0.7

#### Scenario: Phase gate block mismatch logged
- **WHEN** deterministic blocks Phase 3 (gate) AND canary computes `confidence` ≥ 0.7 for `blocked_gate`
- **THEN** the system SHALL append a `CanaryMismatchRecord` to `canary-mismatches.jsonl`

#### Scenario: Signal near-threshold mismatch logged
- **WHEN** error_repeat count is 2 (not emitted) AND canary computes `signal_relevance="high"` with `confidence` ≥ 0.7
- **THEN** the system SHALL append a `CanaryMismatchRecord` to `canary-mismatches.jsonl`

#### Scenario: No mismatch when canary agrees with deterministic
- **WHEN** deterministic allows a normal forward transition AND canary computes `phase_hint="forward"` with `confidence` < 0.7
- **THEN** the system SHALL NOT append to `canary-mismatches.jsonl`

### Requirement: Aggregation report
The system SHALL provide an on-demand aggregation function that reads `canary-mismatches.jsonl` and computes mismatch statistics.

Report fields:
- Total canary evaluations count
- Total mismatches count and percentage
- Breakdown by proxy type (phase_blocked, phase_regression, user_feedback, error_pre_alert)
- Promotion candidates: proxy types where mismatch rate exceeds 30%

#### Scenario: Aggregation report with data
- **WHEN** `canary-mismatches.jsonl` contains 47 evaluations with 12 mismatches
- **THEN** the report SHALL show total=47, mismatches=12 (25.5%), breakdown by proxy type, and flag proxy types with >30% mismatch as promotion candidates

#### Scenario: Aggregation report with no data
- **WHEN** `canary-mismatches.jsonl` does not exist or is empty
- **THEN** the report SHALL show total=0, mismatches=0, no promotion candidates

### Requirement: Canary mismatch record schema
Each `CanaryMismatchRecord` SHALL conform to the following structure:
- `id`: unique identifier (UUID)
- `timestamp`: ISO 8601
- `project_key`: project identifier
- `proxy_type`: one of `"phase_blocked"`, `"phase_regression"`, `"user_feedback"`, `"error_pre_alert"`
- `deterministic`: `{ decision: string, detail: string }`
- `canary`: `{ phase_hint?: string, signal_relevance?: string, confidence: number, reason: string }`
- `shadow_record_id`: reference to the corresponding record in `phase-signal-shadow.jsonl`

#### Scenario: Mismatch record structure
- **WHEN** a mismatch is detected
- **THEN** the record SHALL include all fields above with the `id` generated via `import { randomUUID } from 'crypto'`
