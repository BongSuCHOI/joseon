## Context

phase와 signal은 현재 결정적 기준이 기준선이다. 이번 변경은 이 기준선을 대체하지 않고, LLM 그림자 판정과 diff 기반 실수 패턴 학습을 먼저 쌓은 뒤 ack 강화를 가드로만 열기 위한 설계다.

## Goals / Non-Goals

**Goals:**
- phase와 signal 품질을 그림자 모드로 기록한다.
- fix diff에서 실수 패턴 후보를 추출한다.
- ack 강화는 기본 비활성, 가드 통과 시에만 반영한다.

**Non-Goals:**
- 결정적 phase 라우팅을 LLM으로 직접 대체하지 않는다.
- 외부 트렌드 자동 수집, todo-continuation, autopilot을 추가하지 않는다.
- 그림자 검증 없이 자동 승격하거나 자동 차단을 늘리지 않는다.

## Decisions

### D1: 결정적 경로를 기준선으로 고정한다

기존 phase/state와 signal 생성 결과는 유지하고, LLM 결과는 별도 그림자 레코드로만 저장한다. 대안인 inline 판정은 지연과 불안정성이 커서 이번 단계에 넣지 않는다.

### D2: diff 기반 학습은 요약과 후보 분리로 간다

실수 패턴은 `mistake_summary`와 후보 메타데이터를 append-only로 기록한다. 대안인 즉시 rule promotion은 오탐이 커서 보류한다.

### D3: ack 강화는 written/accepted 이중 상태로 둔다

기본 ack는 그대로 두고, acceptance check가 통과할 때만 accepted 상태를 남긴다. 대안인 hard swap은 롤백 비용이 커서 가드 뒤로 미룬다.

## Risks / Trade-offs

- [LLM 판정 편차] → shadow-only 저장으로 baseline 오염을 막는다.
- [그림자 로그 증가] → 요약 필드와 보관 주기를 분리한다.
- [ack 지연] → 기본 경로를 유지하고 guarded mode에서만 추가 검증을 건다.

## Migration Plan

1. 그림자 기록만 먼저 켠다.
2. deterministic 결과와 shadow 결과를 비교한다.
3. mismatch가 충분히 안정적일 때만 ack 강화 가드를 연다.
4. 실패 시 기존 written ack 경로로 즉시 되돌린다.

## Open Questions

- phase shadow와 signal shadow를 같은 파일에 둘지 분리할지
- acceptance check의 최소 통과 기준을 무엇으로 둘지
- 실수 패턴 후보의 보관 기간을 어느 정도로 둘지
