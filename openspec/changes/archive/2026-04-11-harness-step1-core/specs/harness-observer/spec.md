## ADDED Requirements

### Requirement: Observer records tool execution results
Observer 플러그인은 `tool.execute.after` 훅에서 모든 도구 실행 결과를 JSONL로 기록한다. 각 레코드는 tool 이름, args(`input.args`), title, output 미리보기(500자)를 포함한다.

#### Scenario: Tool execution logged after success
- **WHEN** 임의의 도구가 성공적으로 실행 완료됨
- **THEN** `~/.config/opencode/harness/logs/tools/{date}.jsonl`에 tool, args, title, output_preview 필드가 포함된 JSONL 레코드가 append됨

#### Scenario: Tool execution logged after failure
- **WHEN** 임의의 도구가 실행 중 에러 발생
- **THEN** `tool.execute.after` 훅이 호출되지 않을 수 있으며, 에러는 `session.error` 이벤트로 처리됨

### Requirement: Observer detects repeated session errors
Observer 플러그인은 `session.error` 이벤트에서 에러를 감지하고, 동일 패턴 3회 이상 반복 시 `error_repeat` 타입의 signal을 생성한다.

#### Scenario: Error repeated 3 times creates signal
- **WHEN** 동일한 에러 패턴이 한 세션 내에서 3회 발생함
- **THEN** `~/.config/opencode/harness/signals/pending/{uuid}.json`에 type이 `error_repeat`인 signal 파일이 생성됨

#### Scenario: Error repeated 2 times does not create signal
- **WHEN** 동일한 에러 패턴이 2회 발생함
- **THEN** signal은 생성되지 않고, `~/.config/opencode/harness/logs/errors/{date}.jsonl`에 에러 로그만 기록됨

#### Scenario: Error log contains repeat count
- **WHEN** 에러가 발생함
- **THEN** `~/.config/opencode/harness/logs/errors/{date}.jsonl`에 event, error, repeat_count 필드가 포함된 레코드가 append됨

### Requirement: Observer detects user frustration keywords
Observer 플러그인은 `message.part.updated` 이벤트에서 `part.type === 'text'`인 경우 텍스트에서 불만 키워드를 감지하여 `user_feedback` 타입의 signal을 생성한다.

#### Scenario: Frustration keyword detected creates signal
- **WHEN** 사용자 메시지에 불만 키워드('왜이래', '안돼', '또', '이상해', '다시', '안되잖아', '장난해', '에러', '버그', '깨졌어', '제대로') 중 하나 이상이 포함됨
- **THEN** `~/.config/opencode/harness/signals/pending/{uuid}.json`에 type이 `user_feedback`인 signal 파일이 생성됨

#### Scenario: Normal message does not create signal
- **WHEN** 사용자 메시지에 불만 키워드가 포함되지 않음
- **THEN** signal이 생성되지 않음

### Requirement: Observer logs file edits
Observer 플러그인은 `file.edited` 이벤트에서 파일 편집을 로깅한다. `properties.file` 필드에서 파일 경로를 획득한다.

#### Scenario: File edit is logged
- **WHEN** 파일이 편집됨
- **THEN** `~/.config/opencode/harness/logs/sessions/current.jsonl`에 event가 `file_edited`, file이 편집된 파일 경로인 레코드가 append됨

### Requirement: Observer logs session idle
Observer 플러그인은 `session.idle` 이벤트에서 세션 완료를 기록한다. `properties.sessionID` 필드에서 세션 ID를 획득한다.

#### Scenario: Session idle is logged
- **WHEN** 세션이 idle 상태가 됨
- **THEN** `~/.config/opencode/harness/logs/sessions/{sessionID}.jsonl`에 event가 `session_idle`인 레코드가 append됨

### Requirement: Observer generates project-isolated signals
Observer가 생성하는 모든 signal은 `project_key` 필드를 포함하며, `getProjectKey(ctx.worktree)`로 프로젝트를 식별한다.

#### Scenario: Signal contains correct project key
- **WHEN** 임의의 signal이 생성됨
- **THEN** signal의 `project_key`는 `getProjectKey(ctx.worktree)`의 반환값과 일치함
