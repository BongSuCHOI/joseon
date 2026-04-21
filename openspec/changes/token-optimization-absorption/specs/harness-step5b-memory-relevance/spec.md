## MODIFIED Requirements

### Requirement: Extract-stage memory shadow recording
The system SHALL record append-only shadow outputs for Extract candidates produced during session-to-fact indexing while keeping the existing Sync, Index, and Search behavior unchanged by default. Extract 시 MemoryFact에 `last_accessed_at`과 `access_count` 필드를 초기화한다.

#### Scenario: Extract candidate is recorded
- **WHEN** a session log entry is materialized into a memory fact candidate
- **THEN** the system SHALL append an Extract shadow record for that candidate and SHALL NOT change the current Search result
- **AND** 새 fact의 `last_accessed_at`은 현재 타임스탬프로, `access_count`는 0으로 초기화됨

#### Scenario: Missing shadow data falls back safely
- **WHEN** shadow extraction is unavailable or incomplete
- **THEN** the system SHALL preserve the existing memory flow and SHALL keep the lower-stage path as the source of truth

#### Scenario: Legacy facts without access fields use defaults
- **WHEN** 기존 fact 파일에 `last_accessed_at` 또는 `access_count` 필드가 없음
- **THEN** `last_accessed_at`은 `created_at` 값을, `access_count`는 0을 기본값으로 사용함

## ADDED Requirements

### Requirement: Fact access tracking during compacting
Compacting 시 주입되는 fact의 `access_count`를 증가시키고 `last_accessed_at`을 업데이트한다. 접근 추적은 compacting 주입 시에만 수행하여, 일반 검색에서는 오버헤드가 발생하지 않는다.

#### Scenario: Fact injected during compacting updates access fields
- **WHEN** compacting이 실행되고 fact가 주입 대상으로 선정됨
- **THEN** 해당 fact 파일의 `access_count`가 1 증가하고 `last_accessed_at`이 현재 타임스탬프로 업데이트됨

#### Scenario: Fact not injected does not update access fields
- **WHEN** compacting이 실행되지만 fact가 점수 기준 미달로 주입 대상에서 제외됨
- **THEN** 해당 fact의 `access_count`와 `last_accessed_at`은 변경되지 않음

### Requirement: Fact TTL-based prune candidate marking
Improver의 `session.idle` 처리에서 `access_count = 0`이고 `created_at`으로부터 `fact_ttl_days`(기본 30일)가 경과한 fact를 prune 후보로 마킹한다. 기존 `markPruneCandidates()` 로직과 병합하여 실행한다.

#### Scenario: Stale unaccessed fact becomes prune candidate
- **WHEN** fact의 `access_count`가 0이고 생성 후 30일이 경과함
- **THEN** 해당 fact에 `prune_candidate` 필드가 마킹됨 (reason: "ttl_expired_no_access")

#### Scenario: Recently accessed fact is not pruned
- **WHEN** fact의 `access_count`가 1 이상임
- **THEN** TTL이 경과해도 prune 후보로 마킹되지 않음

#### Scenario: High-access fact gets TTL extension
- **WHEN** fact의 `access_count`가 `fact_ttl_extend_threshold`(기본 5) 이상임
- **THEN** TTL이 기본값의 2배(60일)로 연장됨 (prune 판정 시 연장된 TTL 적용)

#### Scenario: TTL threshold configurable
- **WHEN** 설정에 `fact_ttl_days`가 명시됨
- **THEN** 해당 값이 TTL 기본값으로 사용됨 (기본값 30일)
