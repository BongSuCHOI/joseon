## ADDED Requirements

### Requirement: Three-layer progressive fact disclosure during compacting
Compacting 시 MemoryFact를 3계층으로 나누어 주입한다. 점수 상위 30%는 Layer 3(전체 내용), 중간 40%는 Layer 2(keywords + 첫 문장), 하위 30%는 Layer 1(id + keywords만)으로 주입하여 전체 fact 주입 토큰을 절감한다. 점수는 기존 `planCompactionSelections()`의 메타데이터 스코어를 사용한다.

#### Scenario: High-score facts injected as full content (Layer 3)
- **WHEN** compacting이 실행되고 semantic compacting이 활성화됨
- **AND** fact의 메타데이터 점수가 상위 30%에 해당함
- **THEN** 해당 fact는 전체 content, keywords, source_session을 포함하여 주입됨 (기존 방식과 동일)

#### Scenario: Mid-score facts injected as summary (Layer 2)
- **WHEN** compacting이 실행되고 semantic compacting이 활성화됨
- **AND** fact의 메타데이터 점수가 중간 40%에 해당함
- **THEN** 해당 fact는 keywords와 content의 첫 문장만 주입됨

#### Scenario: Low-score facts injected as index only (Layer 1)
- **WHEN** compacting이 실행되고 semantic compacting이 활성화됨
- **AND** fact의 메타데이터 점수가 하위 30%에 해당함
- **THEN** 해당 fact는 id와 keywords만 주입됨

#### Scenario: Semantic compacting disabled falls back to Layer 3 for all
- **WHEN** compacting이 실행되고 semantic compacting이 비활성화됨
- **THEN** 모든 fact가 Layer 3(전체 내용)으로 주입됨 (기존 동작 유지)

#### Scenario: Fact count below 3 uses Layer 3 for all
- **WHEN** compacting에 주입할 fact가 2개 이하임
- **THEN** 모든 fact가 Layer 3(전체 내용)으로 주입됨 (계층 분할 의미 없음)

### Requirement: Progressive disclosure shadow recording
3계층 분할 결과를 CompactionRelevanceShadowRecord에 기록하여, 캐나리 평가가 계층 분할의 영향을 모니터링할 수 있게 한다.

#### Scenario: Shadow record includes layer assignment
- **WHEN** progressive disclosure가 fact를 3계층으로 분할함
- **THEN** 각 fact의 shadow candidate에 `layer` 필드(1|2|3)가 포함됨
