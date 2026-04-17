## Why

현재 기억 경로는 Sync / Index / Search 중심이다. 전체 5b를 한 번에 올리기에는 아직 데이터와 운영 근거가 부족하므로, 안전한 조각만 먼저 넣어 shadow 비교를 쌓는다.

## What Changes

- 상위 기억 단계는 **Extract 후보 append-only shadow 기록**까지만 구현한다.
- compacting은 기본 비활성으로 두고, **metadata-first relevance shadow**를 기록한다.
- 설정으로 opt-in 했을 때만 compacting 후보 정렬에 metadata-first 필터를 적용한다. 현재 reduced-safe 구현에서 fact 후보는 기존 lexical match 결과를 재사용한다.
- 기존 Search 결과와 compacting 기본 경로는 비활성 상태에서 그대로 유지한다.
- Consolidate / Relate / Recall 본 경로 승격, 외부 트렌드 자동 수집, todo-continuation, autopilot은 범위 밖으로 둔다.

## Capabilities

### New Capabilities
- `harness-step5b-memory-relevance`: Extract shadow 기록과 semantic compacting relevance shadow/default-off 필터를 다룬다.

### Modified Capabilities
- `experimental.session.compacting`: 기본 경로는 유지하면서 relevance shadow 로그를 남기고, opt-in 시 metadata-first 정렬을 적용할 수 있다.

## Impact

- `memory/facts/` 생성 시 Extract shadow 기록 추가
- compacting shadow 로그, 설정 스키마, 검증 스모크 테스트
- Step 5b 승격 기준 문서와 OpenSpec 아티팩트 정리
