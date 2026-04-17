## Context

하위 기억 경로는 이미 존재하지만, 상위 의미층은 아직 그림자 검증이 필요하다. 이번 축소 5b는 기존 Search를 건드리지 않고, **Extract shadow**와 **semantic compacting relevance shadow/default-off 필터**만 추가한다.

## Goals / Non-Goals

**Goals:**
- session log → fact 인덱싱 시 Extract 후보를 append-only shadow로 기록한다.
- compacting 필터는 default-off로 두고 relevance shadow를 남긴다.
- opt-in 시 compacting 후보를 metadata-first로 정렬한다. 현재 reduced-safe 구현에서 fact 후보 풀은 기존 lexical match 결과를 재사용하고, 그 안에서 메타데이터 우선 정렬을 적용한다.
- 현재 Search 및 compacting 기본 흐름을 비활성 상태에서 유지한다.

**Non-Goals:**
- Consolidate / Relate / Recall 본 경로를 구현하지 않는다.
- Search 결과를 새 필터로 즉시 재정렬하지 않는다.
- 의미 기반 compacting을 기본값으로 켜지 않는다.
- LLM / embedding 기반 relevance를 넣지 않는다.
- 외부 트렌드 자동 수집, todo-continuation, autopilot을 포함하지 않는다.

## Decisions

### D1: 상위 기억은 Extract shadow 한 조각만 먼저 쌓는다

현재 파이프라인에서 가장 안전한 지점은 session log에서 fact를 materialize하는 순간이다. 여기서 Extract 후보를 프로젝트별 JSONL에 append-only로 남긴다. Consolidate / Relate / Recall은 후속 승격까지 미룬다.

### D2: compacting relevance는 사용 가능한 메타데이터만 쓴다

이번 조각은 `project_key`, `scope`, 최근 활동(created/last_violation), 최근 위반 같은 현재 저장된 메타데이터를 우선 사용한다. 다만 fact 후보 풀 자체는 기존 lexical match 결과를 재사용하고, 그 안에서 메타데이터 우선 정렬을 적용한다. 더 무거운 LLM/embedding 로직은 넣지 않는다.

### D3: default-off일 때 선택 결과는 baseline과 동일해야 한다

필터가 꺼져 있으면 현재 soft rule/fact 선택 순서를 그대로 사용하고, shadow 로그만 추가한다. 켜졌을 때만 metadata-first 정렬 결과를 실제 compacting에 반영한다.

## Risks / Trade-offs

- [Extract shadow가 빠르게 쌓임] → append-only를 유지하되 승격 판단은 별도 체크리스트로 미룬다.
- [metadata-only 필터가 거칠 수 있음] → default-off + shadow 비교를 기준으로 튜닝한다.
- [기존 facts에 project_key가 없을 수 있음] → legacy fact는 낮은 우선순위로 두되 완전히 배제하지 않는다.

## Migration Plan

1. OpenSpec 범위를 Extract shadow + semantic compacting shadow/default-off로 축소한다.
2. Extract shadow와 compacting relevance shadow를 append-only 로그로 추가한다.
3. opt-in 설정에서만 metadata-first 정렬을 compacting에 반영한다.
4. shadow 로그와 실세션 결과가 쌓이면 full 5b 승격 여부를 다시 판단한다.

## Open Questions

- Extract shadow retention을 프로젝트 단위 그대로 둘지, 세션별 rotate를 둘지
- recent activity를 created_at만으로 충분히 볼지, 별도 last_used 메타데이터를 추가할지
- full 5b 승격 시 Consolidate / Relate / Recall을 어떤 순서로 켤지
