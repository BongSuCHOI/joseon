## Why

Step 4(오케스트레이션) 구현을 위한 기반 인프라가 필요하다. Phase Manager, PID 세션 차단, 그리고 이들이 공통으로 사용하는 타입 정의가 선행되어야 후속 Change(에이전트 정의, 에러 복구, Orchestrator 통합)를 구현할 수 있다.

## What Changes

- **타입 확장:** `types.ts`에 `PhaseState`, `QAFailures`, `EvalResult` 인터페이스 추가. 기존 `Signal`에 `agent_id?: string` optional 필드 추가 (non-breaking)
- **Phase Manager 모듈:** `src/orchestrator/phase-manager.ts` 신규. Phase 상태 파일(`.opencode/orchestrator-phase.json`) 관리, Phase 2.5 gate(qa-test-plan.md 없으면 Phase 3 진입 차단), Phase 5 완료 시 리셋, 미완료 Phase 감지
- **PID 세션 차단:** observer의 `session.created`에 PID 파일(`projects/{key}/.session-lock`) 체크 로직 추가. 같은 프로젝트에서 동시에 2개 이상 OpenCode 세션 실행 방지. Stale lock 자동 해소

## Capabilities

### New Capabilities
- `phase-manager`: Phase 상태 파일 관리, Phase 전환, Phase 2.5 gate, Phase 5 리셋, 미완료 감지
- `session-lock`: PID 파일 기반 세션 중복 실행 차단, stale lock 자동 해소

### Modified Capabilities
- `harness-observer`: `session.created` 이벤트에 PID 체크 로직 추가
- `harness-shared-infra`: `types.ts`에 Step 4 신규 타입 추가

## Impact

- `src/types.ts`: 3개 신규 인터페이스 + 1개 optional 필드 추가
- `src/orchestrator/phase-manager.ts`: 신규 파일 (~100줄)
- `src/harness/observer.ts`: PID 체크 로직 추가 (~20줄)
- 기존 코드 동작에 영향 없음 (non-breaking 변경만)
- 런타임 파일: `.opencode/orchestrator-phase.json`(프로젝트 레벨), `~/.config/opencode/harness/projects/{key}/.session-lock`(글로벌 레벨)
