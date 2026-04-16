## Context

하위 기억 경로는 이미 존재하지만, 상위 의미층은 아직 그림자 검증이 필요하다. 이 변경은 기존 Search를 바꾸지 않고, 상위 4단계와 의미 기반 compacting을 먼저 기록·비교하는 설계다.

## Goals / Non-Goals

**Goals:**
- Extract / Consolidate / Relate / Recall 후보를 shadow로 기록한다.
- compacting 필터는 default-off로 두고 relevance 점수를 먼저 관찰한다.
- 현재 Search 및 기억 저장 흐름을 기본값에서 유지한다.

**Non-Goals:**
- Search 결과를 LLM 기반으로 즉시 재정렬하지 않는다.
- 의미 기반 compacting을 기본값으로 켜지 않는다.
- 외부 트렌드 자동 수집, todo-continuation, autopilot을 포함하지 않는다.

## Decisions

### D1: 상위 기억 단계는 append-only shadow로 시작한다

추출 결과를 덮어쓰지 않고 후보 레코드로 쌓는다. 대안인 직접 승격은 데이터가 충분하지 않으면 환각을 키운다.

### D2: compacting은 metadata-first 필터를 우선한다

project_key, scope, 최근 사용, 최근 위반 같은 메타데이터를 먼저 쓰고, 필요할 때만 추가 의미 점수를 얹는다. 대안인 embedding-first는 비용과 운영 복잡도가 높다.

### D3: baseline Search는 변경하지 않는다

Search 결과를 새 필터로 바꾸지 않고 shadow 비교만 수행한다. 대안인 inline 재정렬은 롤백이 어렵다.

## Risks / Trade-offs

- [상위 단계 후보가 과하게 쌓임] → shadow retention과 샘플링을 분리한다.
- [의미 필터가 너무 좁음] → default-off로 시작하고 shadow 비교로 튜닝한다.
- [Search와 shadow 결과 불일치] → baseline을 기준으로 비교 로그를 남긴다.

## Migration Plan

1. 상위 4단계 후보를 shadow로만 기록한다.
2. compacting 필터 점수를 shadow로 비교한다.
3. 충분한 데이터가 쌓이면 explicit opt-in으로만 실제 compacting에 반영한다.
4. 문제 발생 시 shadow 기록만 남기고 현재 Search 경로로 즉시 복귀한다.

## Open Questions

- 상위 4단계 후보 파일을 세션별로 둘지 프로젝트별로 둘지
- 의미 점수의 최소 기준을 메타데이터만으로 둘지 LLM을 섞을지
- shadow retention 기간을 몇 세션 기준으로 둘지
