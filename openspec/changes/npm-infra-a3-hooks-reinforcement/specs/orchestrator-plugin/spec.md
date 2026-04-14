## ADDED Requirements

### Requirement: All hooks merged into plugin entry point
`src/index.ts`의 `server()` 함수는 `src/hooks/index.ts`에서 생성한 모든 훅을 기존 observer/enforcer/improver/orchestrator 훅과 함께 `mergeEventHandlers`로 병합한다.

#### Scenario: Hooks active after plugin load
- **WHEN** 플러그인이 로드됨
- **THEN** delegate-task-retry, json-error-recovery, delegation-nudge, phase-reminder 훅이 모두 활성 상태임

#### Scenario: Multiple tool.execute.after handlers coexist
- **WHEN** observer의 tool.execute.after와 hooks의 tool.execute.after가 모두 등록됨
- **THEN** 두 핸들러 모두 순차적으로 실행됨 (한쪽이 다른 쪽을 덮어쓰지 않음)
