## Context

v3-final 5.2.2에서 정의된 에러 복구 4단계와 7.2의 QA 실패 추적을 구현한다.

의존성: Change A의 타입(QAFailures, EvalResult)과 Phase Manager, Change B의 에이전트 정의.

## Goals / Non-Goals

**Goals:**
- 에러 복구 4단계 로직을 파일 기반으로 구현
- QA 시나리오별 3회 실패 시 에스컬레이션
- 각 모듈을 독립적으로 단위 테스트 가능

**Non-Goals:**
- Orchestrator 플러그인 통합 (Change D)
- 실제 서브에이전트 호출 (프롬프트 레벨에서 제어)
- LLM 기반 판정 (deterministic 매핑 사용)

## Decisions

### D1: 에러 복구 이력을 JSONL로 관리

`projects/{key}/error-recovery.jsonl`에 append-only로 기록. history 로테이션 유틸과 동일 패턴.

### D2: QA 실패는 시나리오별로 카운트

v5 교훈: 전체 3회가 아닌 시나리오별 3회. `qa-failures.json`은 `{ [scenarioId]: { count, last_failure_at, details[] } }` 구조.

### D3: 에러 복구 단계는 프롬프트가 아닌 코드로 관리

각 단계의 전환 조건은 향후 LLM 기반 판정(#B)으로 대체 가능하도록, 현재는 deterministic하게 구현.

## Risks / Trade-offs

- [에러 복구 단계 전환이 너무 엄격] → 현재 deterministic이므로, 실동작 데이터 축적 후 LLM 기반으로 전환 가능
- [QA failures 파일 무한 증가] → 현재 규모에서는 문제 없음. 고도화에서 Pruning 대상
