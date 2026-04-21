## MODIFIED Requirements

### Requirement: Observer records tool execution results
Observer 플러그인은 `tool.execute.after` 훅에서 모든 도구 실행 결과를 JSONL로 기록한다. 각 레코드는 tool 이름, args(`input.args`), title, output 미리보기(500자)를 포함한다. 추가로, 세션 내 툴 호출 패턴을 추적하여 낭비 탐지기(tool_loop, retry_storm, excessive_read)의 프록시 메트릭으로 사용한다.

#### Scenario: Tool execution logged after success
- **WHEN** 임의의 도구가 성공적으로 실행 완료됨
- **THEN** `~/.config/opencode/harness/logs/tools/{date}.jsonl`에 tool, args, title, output_preview 필드가 포함된 JSONL 레코드가 append됨

#### Scenario: Tool execution logged after failure
- **WHEN** 임의의 도구가 실행 중 에러 발생
- **THEN** `tool.execute.after` 훅이 호출되지 않을 수 있으며, 에러는 `session.error` 이벤트로 처리됨

#### Scenario: Tool call tracking for loop detection
- **WHEN** 도구가 성공적으로 실행 완료됨
- **THEN** 세션 내 메모리 맵에 `tool:args_fingerprint` 키로 호출 카운트가 증가함

#### Scenario: Tool call tracking for retry storm detection
- **WHEN** 도구 실행 결과가 에러를 포함함
- **THEN** 해당 툴의 에러-재시도 사이클 카운터가 업데이트됨

#### Scenario: Read tool file tracking for excessive read detection
- **WHEN** Read 툴이 파일을 읽음
- **THEN** 세션 내 메모리 맵에 파일 경로 키로 읽기 카운트가 증가함
