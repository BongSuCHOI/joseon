## Context

현재 규칙은 생성과 측정 중심이고, 자동 삭제와 cross-project 승격은 아직 없다. 이 변경은 규칙 생애주기를 후보 중심으로 정리하고, global 승격은 guarded-off 상태로 먼저 검증하기 위한 설계다.

## Goals / Non-Goals

**Goals:**
- pruning 후보를 먼저 표시하고 조건이 충족될 때만 삭제한다.
- cross-project 승격 후보를 수집하되 자동 global 쓰기는 기본 비활성으로 둔다.
- `scope: prompt` 규칙을 별도로 보호한다.

**Non-Goals:**
- 규칙을 즉시 자동 삭제하지 않는다.
- cross-project 데이터를 바로 global rule로 승격하지 않는다.
- 외부 트렌드 자동 수집, todo-continuation, autopilot을 추가하지 않는다.

## Decisions

### D1: pruning은 candidate-first로 간다

먼저 `prune_candidate`를 기록하고, 삭제는 충분한 샘플과 낮은 오탐률이 확인될 때만 허용한다. 대안인 즉시 삭제는 되돌리기 어렵다.

### D2: `scope: prompt`는 별도 보호한다

prompt scope는 일반 규칙처럼 위반 횟수나 사용 빈도만으로 정리하지 않는다. 대안인 동일 규칙 처리은 설계상 잘못된 삭제를 만든다.

### D3: cross-project 승격은 guarded-off + manual-first로 둔다

자동 global 쓰기는 기본 비활성으로 두고, 수동 global이 여전히 우선 경로가 되게 한다. 대안인 자동 승격은 blast radius가 너무 크다.

## Risks / Trade-offs

- [좋은 규칙의 조기 삭제] → candidate-only 기간을 충분히 둔다.
- [global 오승격] → 기본 비활성으로 두고 수동 승격을 유지한다.
- [규칙 메타데이터 증가] → append-only 기록과 보관 주기를 분리한다.

## Migration Plan

1. pruning 후보만 먼저 기록한다.
2. cross-project 집계는 shadow-only로 돌린다.
3. guard 조건이 검증되면 제한된 환경에서만 삭제/승격을 허용한다.
4. 이상 징후가 보이면 candidate 기록만 남기고 실행 경로는 비활성으로 되돌린다.

## Open Questions

- pruning 가드의 최소 샘플 수를 몇 회로 둘지
- cross-project 집계의 동일 패턴 판정 기준을 무엇으로 둘지
- `scope: prompt` 예외를 전역 규칙으로 둘지 개별 정책으로 둘지
