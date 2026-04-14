## Why

멀티 에이전트 오케스트레이션에서 서브에이전트가 또 다른 서브에이전트를 호출하는 중첩(nesting)이 무한히 발생할 수 있다. omOs는 `SubagentDepthTracker`로 max depth(기본 3)를 초과하면 spawn을 차단한다. 우리의 error-recovery 4단계에서 `cross_model_rescue` 시에도 깊이 추적이 필요하며, 서브에이전트가 과도하게 중첩되면 비용 폭증과 응답 지연이 발생한다.

## What Changes

- **SubagentDepthTracker 클래스**: 세션별 깊이 추적, max depth 초과 시 차단
- **Observer 통합**: `session.created` 이벤트에서 부모-자식 관계 추적
- **설정 가능한 max depth**: `HarnessSettings.max_subagent_depth` 추가 (기본 3)
- **session.deleted에서 정리**: 세션 종료 시 추적 데이터 정리

## Capabilities

### New Capabilities
- `subagent-depth`: 서브에이전트 생성 깊이 추적 및 제한 — max depth 초과 시 차단

### Modified Capabilities
- `config-system`: HarnessSettings에 `max_subagent_depth` 필드 추가
- `harness-observer`: session.created/subagent.session.created에서 깊이 추적

## Impact

- `src/orchestrator/subagent-depth.ts` — 신규 파일 (~50줄)
- `src/config/schema.ts` — HarnessSettings에 `max_subagent_depth` 추가
- `src/harness/observer.ts` — session.created 이벤트에 깊이 추적 로직 추가
- `src/index.ts` — observer에 depth tracker 전달
- `test/smoke-test-step4.ts` — 깊이 추적 테스트 추가
