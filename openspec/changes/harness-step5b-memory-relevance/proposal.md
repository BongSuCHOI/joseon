## Why

현재 기억 경로는 Sync / Index / Search 중심이다. Step 4 이후 고도화 전략에 맞추려면 먼저 상위 기억 단계와 의미 기반 compacting을 그림자 모드로 쌓아야 한다.

## What Changes

- Cross-session memory의 상위 4단계(Extract / Consolidate / Relate / Recall)를 그림자 모드로 기록한다.
- compacting은 기본 비활성으로 두고, 의미 기반 필터는 shadow 비교부터 시작한다.
- 기존 Search 결과와 현재 기억 경로는 기본값에서 그대로 유지한다.
- 외부 트렌드 자동 수집, todo-continuation, autopilot은 범위 밖으로 둔다.

## Capabilities

### New Capabilities
- `harness-step5b-memory-relevance`: 상위 기억 4단계 그림자 기록과 의미 기반 compacting 필터를 다룬다.

### Modified Capabilities
- 없음

## Impact

- `memory/facts/`, `memory/search/`, compacting 관련 훅과 인덱스/검색 보조 유틸
- 세션 아카이브에서 상위 단계 후보를 추출하는 흐름
- compacting 비교 로그, 성능 측정, 검증 스모크 테스트
