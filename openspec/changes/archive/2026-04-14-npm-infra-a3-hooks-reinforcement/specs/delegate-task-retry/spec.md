## ADDED Requirements

### Requirement: Delegate task error detection
`src/hooks/delegate-task-retry.ts`는 `tool.execute.after` 훅에서 도구 출력 문자열을 검사하여 서브에이전트 위임 실패 패턴을 감지한다.

#### Scenario: Delegation failure detected
- **WHEN** 도구 출력에 위임 실패 패턴("could not find agent", "no agent named", "agent not available" 등)이 포함됨
- **THEN** 에러 타입과 원본 출력을 포함한 `DetectedError` 객체가 반환됨

#### Scenario: Normal output ignored
- **WHEN** 도구 출력에 위임 실패 패턴이 없음
- **THEN** null이 반환되고 아무 동작도 수행하지 않음

### Requirement: Retry guidance injection on delegation failure
위임 실패 감지 시, `experimental.chat.system.transform`을 통해 재시도 가이드를 시스템 컨텍스트에 주입한다.

#### Scenario: Retry guidance injected
- **WHEN** 서브에이전트 위임 실패가 감지됨
- **THEN** 시스템 컨텍스트에 에러 유형별 수정 힌트가 포함된 가이드 문자열이 주입됨
