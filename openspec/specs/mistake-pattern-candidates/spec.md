## ADDED Requirements

### Requirement: Mistake pattern candidate grouping
The system SHALL group mistake summary shadow records that share the same pattern identity into a single candidate record, and SHALL write the candidate to `mistake-pattern-candidates.jsonl` only when the repetition count meets or exceeds the configured threshold.

#### Scenario: Shadow record triggers grouping check
- **WHEN** a new non-ambiguous mistake summary shadow record is appended
- **THEN** the system SHALL compute a pattern identity from the record's commit message keywords and normalized affected file paths, and SHALL check for matching existing shadow records with the same pattern identity

#### Scenario: Repetition meets threshold creates candidate
- **WHEN** the count of shadow records sharing the same pattern identity is greater than or equal to the configured `candidate_threshold` (default 3)
- **THEN** the system SHALL create or update a candidate record in `mistake-pattern-candidates.jsonl` with `status: pending`, the pattern identity, the list of source shadow record IDs, and the repetition count

#### Scenario: Repetition below threshold stays in shadow
- **WHEN** the count of shadow records sharing the same pattern identity is less than the `candidate_threshold`
- **THEN** the system SHALL NOT create a candidate record and SHALL leave the data in shadow storage only

#### Scenario: Ambiguous records excluded from grouping
- **WHEN** a shadow record has `ambiguous: true`
- **THEN** the system SHALL exclude it from pattern identity computation and candidate grouping

#### Scenario: Existing candidate updated on new match
- **WHEN** a candidate record already exists for a pattern identity and a new shadow record matches it
- **THEN** the system SHALL append the new source shadow record ID to the candidate and increment the repetition count, and SHALL NOT create a duplicate candidate

### Requirement: Pattern identity computation
The system SHALL compute a deterministic pattern identity string from commit message keywords and normalized file paths without using LLM inference.

#### Scenario: Keywords extracted from commit message
- **WHEN** a commit message is provided for pattern identity computation
- **THEN** the system SHALL extract the first significant keyword (after stripping conventional commit prefixes such as `fix:`, `chore:`, `refactor:`) and use it as the keyword component

#### Scenario: File paths normalized to directory level
- **WHEN** affected file paths are provided for pattern identity computation
- **THEN** the system SHALL normalize each path to its top two directory segments (e.g., `src/parser/tokenizer.ts` → `src/parser`) and combine them into a sorted, deduplicated set as the path component

#### Scenario: Pattern identity is deterministic
- **WHEN** the same commit message keywords and normalized file paths are provided
- **THEN** the system SHALL produce the same pattern identity string on every invocation

### Requirement: Candidate record schema
The system SHALL store candidate records in project-scoped JSONL files with a defined schema.

#### Scenario: Candidate record fields
- **WHEN** a candidate record is created
- **THEN** it SHALL contain: `id`, `project_key`, `timestamp`, `pattern_identity`, `pattern_keyword`, `pattern_paths`, `source_shadow_ids`, `repetition_count`, `candidate_threshold`, `status` (`pending` | `accepted` | `rejected`), and `mistake_summary_samples` (up to 3 representative summaries)

#### Scenario: Candidate file location
- **WHEN** a candidate is written for a project
- **THEN** the system SHALL write to `~/.config/opencode/harness/projects/{project_key}/mistake-pattern-candidates.jsonl`

#### Scenario: No automatic rule generation
- **WHEN** a candidate is created or updated
- **THEN** the system SHALL NOT automatically create or modify any harness rule, and SHALL keep the candidate in `status: pending` until manually reviewed

### Requirement: Candidate threshold configuration
The system SHALL support a configurable repetition threshold for candidate promotion.

#### Scenario: Default threshold is 3
- **WHEN** no `candidate_threshold` is configured in harness settings
- **THEN** the system SHALL use the default value of 3

#### Scenario: Custom threshold from config
- **WHEN** `candidate_threshold` is set in harness settings
- **THEN** the system SHALL use the configured value for candidate promotion decisions
