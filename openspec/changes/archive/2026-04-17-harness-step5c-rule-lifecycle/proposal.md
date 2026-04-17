## Why

규칙 수가 늘어날수록 노이즈와 유지비가 같이 커진다. 또 프로젝트 간 유사 패턴이 보이더라도 바로 global로 올리면 영향 범위가 너무 크기 때문에, 먼저 후보와 가드 중심의 수명 주기가 필요하다.

## What Changes

- 규칙 pruning은 가드가 충족될 때만 삭제를 허용하고, 기본은 후보 표시만 남긴다.
- cross-project auto promotion은 기본 비활성으로 두고, global 자동 승격 대신 후보 수집부터 시작한다.
- `scope: prompt` 규칙은 자동 삭제 대상에서 제외한다.
- 외부 트렌드 자동 수집, todo-continuation, autopilot은 범위 밖으로 둔다.

## Capabilities

### New Capabilities
- `harness-step5c-rule-lifecycle`: 규칙 pruning, 후보 관리, cross-project 승격 후보를 다룬다.

### Modified Capabilities
- 없음

## Impact

- 규칙 저장소, effect/evidence 메타데이터, pruning 후보 기록 경로
- project_key / global 판정 로직과 cross-project 집계 흐름
- 검증 스모크 테스트와 롤백 절차
