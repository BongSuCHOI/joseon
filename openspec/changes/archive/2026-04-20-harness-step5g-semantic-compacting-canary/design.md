## Context

Step 5b에서 compacting relevance shadow를 구현했다. `planCompactionSelections()`가 baseline(violation_count 정렬)과 semantic(metadata-first 정렬) 양쪽 선택 결과를 만들고, `appendCompactionShadowRecord()`가 이를 `compacting-relevance-shadow.jsonl`에 append-only로 기록한다.

현재 상태:
- `semantic_compacting_enabled=false` (기본값)에서는 baseline 선택이 실제로 사용되고, semantic은 shadow에만 기록
- `semantic_compacting_enabled=true`에서는 semantic 선택이 실제로 사용됨
- **아무도 shadow를 읽지 않음** — baseline vs semantic 차이를 분석하는 코드가 제로

Step 5f에서 phase/signal canary 패턴을 검증했다:
- `isLowConfidenceProxy()` → 프록시 감지
- `evaluateCanary()` → 메타데이터 평가
- `appendMismatchRecord()` → 불일치 기록
- `generateCanaryReport()` → 집계 리포트

이 패턴을 compacting에 재적용한다.

## Goals / Non-Goals

**Goals:**
- Compacting shadow에서 baseline vs semantic selection의 의미 있는 차이를 자동 감지
- 차이가 큰 경우(중요 규칙 누락, 과잉 포함)를 mismatch로 기록
- 집계 리포트로 `semantic_compacting_enabled`의 승격 여부를 데이터 기반으로 판단
- 기존 compacting 동작에 영향 없음 (default-off)

**Non-Goals:**
- LLM/embedding 기반 ranking 도입 (메타데이터 전용)
- `semantic_compacting_enabled` 기본값 변경 (계속 false)
- 실시간 compacting 동작 변경 (shadow만 기록)

## Decisions

### D1: Canary 모듈 배치 — `src/harness/canary.ts`에 추가

**선택**: 기존 `canary.ts`에 compacting canary 함수 추가

**대안**:
- (A) 별도 파일 `src/harness/compacting-canary.ts` — 5f canary와 분리
- (B) `canary.ts`에 추가 — 동일한 패턴, 동일한 모듈

**근거**: compacting canary와 phase/signal canary는 동일한 아키텍처 패턴(shadow 읽기 → 평가 → mismatch 기록 → 리포트)을 따른다. 분리하면 공통 유틸(readRecentRecords, appendMismatch 등) 중복 또는 import 복잡도만 증가. `canary.ts`가 현재 344행이므로 200~250행 추가해도 관리 가능.

### D2: Mismatch 감지 기준 — 3가지 프록시

Baseline vs semantic selection의 차이를 다음 3가지로 감지:

1. **rule_omission** (누락): baseline에 있던 rule이 semantic에서 빠짐 → 중요 규칙이 의도치 않게 제외될 위험
2. **fact_omission** (누락): baseline에 있던 fact가 semantic에서 빠짐 → 관련 기억이 누락될 위험
3. **rank_inversion** (순위 역전): baseline의 top-1 rule/fact가 semantic에서 top-3 밖으로 밀림 → 가장 중요한 항목의 우선순위가 뒤바뀜

**근거**: 5f의 저신뢰도 프록시 패턴과 동일. "왜 차이가 나는가"는 LLM이 필요하지만 "차이가 있는가"는 메타데이터만으로 충분.

### D3: Confidence 산출 — shadow 기록 빈도 기반

5f와 동일하게 메타데이터 기반:
- omission이 드물면 confidence 높음 (0.7) — 드물게 발생하는 차이는 주목할 가치 있음
- omission이 빈번하면 confidence 낮음 (0.3) — 빈번하면 semantic 정렬이 기본적으로 다른 것
- 중간은 0.5

### D4: 설정 분리 — `compacting_canary_enabled`

`canary_enabled`와 별개 설정:
- `canary_enabled`: phase/signal canary (5f)
- `compacting_canary_enabled`: compacting canary (5g)

**근거**: 서로 다른 데이터 소스, 서로 다른 튜닝 주기. 하나를 켜도 다른 것은 꺼져 있어야 함.

### D5: Shadow record 스키마 확장 — 기존 레코드와 호환

`CompactionRelevanceShadowRecord`에 선택적 canary block 추가:
```typescript
canary?: {
  evaluated: boolean;
  mismatches: Array<{
    type: 'rule_omission' | 'fact_omission' | 'rank_inversion';
    item_id: string;
    item_kind: 'soft_rule' | 'fact';
    detail: string;
  }>;
  confidence: number;
  reason: string;
}
```

기존 레코드(canary 없음)는 `evaluated: false`로 간주. 스키마 변경이 기존 코드에 영향 없음.

## Risks / Trade-offs

- **[Omission 프록시가 noise일 수 있음]** → confidence 기반 필터링 + 집계 리포트로 패턴 확인 후 판단
- **[Compacting 빈도가 낮아 데이터 축적이 느림]** → canary는 어차피 장기 관찰용. 빈도가 낮으면 mismatch도 적어 안전
- **[canary.ts 크기 증가]** → 344 + ~250 = ~600행. 아직 분리 필요 없음. 800행 넘으면 그때 분리
