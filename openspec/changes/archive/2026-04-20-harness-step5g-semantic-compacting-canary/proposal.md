## Why

Step 5b에서 `planCompactionSelections()`와 `appendCompactionShadowRecord()`로 compacting relevance shadow를 구현했다. 현재 shadow 데이터는 `compacting-relevance-shadow.jsonl`에 쌓이고 있지만, **아무도 읽지 않는다** — baseline vs semantic selection의 차이를 분석하는 canary 평가가 없다. 5f에서 phase/signal canary 패턴을 검증했으므로, 동일한 canary 프레임워크를 compacting에도 적용하여 shadow 데이터의 가치를 실현할 때다.

## What Changes

- **Compacting canary 평가**: compacting 실행 시 baseline selection과 semantic selection의 차이를 감지하고, 의미 있는 차이(누락/과잉)를 `compacting-canary-mismatches.jsonl`에 기록
- **집계 리포트**: mismatch율, 패턴별 분포, 승격 후보 판정 함수 — 5f의 `generateCanaryReport()` 패턴 재사용
- **설정 추가**: `compacting_canary_enabled` (default: false) — 5f의 `canary_enabled`와 별개 관리

## Capabilities

### New Capabilities
- `compacting-canary`: compacting selection의 baseline vs semantic 차이를 평가하고 mismatch를 기록하는 canary 시스템

### Modified Capabilities
- `harness-step5b-memory-relevance`: canary 평가 결과에 따라 compacting filter의 승격 여부를 판단할 수 있도록 shadow record에 canary block 추가

## Impact

- **코드**: `src/harness/canary.ts`에 compacting canary 함수 추가, `src/harness/improver.ts`의 compacting 훅에 canary 연동
- **데이터**: `projects/{key}/compacting-canary-mismatches.jsonl` 신규 파일
- **설정**: `HarnessSettings`에 `compacting_canary_enabled` 필드 추가
- **의존성**: 5f의 canary 프레임워크(`readRecentShadowRecords` 패턴, `appendMismatchRecord` 패턴) 재사용
