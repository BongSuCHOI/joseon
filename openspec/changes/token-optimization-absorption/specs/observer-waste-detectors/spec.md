## ADDED Requirements

### Requirement: Observer detects tool loop patterns
Observer는 `tool.execute.after` 훅에서 동일한 툴 이름 + 동일 args 조합의 반복 호출을 추적하고, 임계값(기본 5회) 초과 시 `tool_loop` 타입의 signal을 생성한다. 세션별·툴+args 키별로 독립 카운트한다.

#### Scenario: Same tool and args repeated 5 times creates signal
- **WHEN** 한 세션 내에서 동일한 툴 이름과 동일 args로 5회 실행됨
- **THEN** `~/.config/opencode/harness/signals/pending/{uuid}.json`에 type이 `tool_loop`인 signal 파일이 생성됨
- **AND** signal의 payload에 tool_name, args_fingerprint, recurrence_count가 포함됨

#### Scenario: Same tool different args does not trigger
- **WHEN** 동일한 툴이 다른 args로 각각 3회씩 실행됨
- **THEN** 어느 쪽도 임계값에 도달하지 않아 signal이 생성되지 않음

#### Scenario: Loop threshold configurable
- **WHEN** 설정에 `tool_loop_threshold`가 명시됨
- **THEN** 해당 값이 signal 생성 임계값으로 사용됨 (기본값 5)

### Requirement: Observer detects retry storm patterns
Observer는 `tool.execute.after` 훅에서 연속 에러 후 재시도 패턴을 감지하고, 에러→재시도→에러 사이클이 3회 이상 반복 시 `retry_storm` 타입의 signal을 생성한다.

#### Scenario: Error-retry cycle repeated 3 times creates signal
- **WHEN** 한 세션 내에서 동일 툴의 실행이 에러→재시도→에러→재시도→에러 패턴으로 3 사이클 발생함
- **THEN** `~/.config/opencode/harness/signals/pending/{uuid}.json`에 type이 `retry_storm`인 signal 파일이 생성됨
- **AND** signal의 payload에 tool_name, cycle_count가 포함됨

#### Scenario: Successful retry does not trigger
- **WHEN** 에러 발생 후 재시도가 성공함
- **THEN** retry_storm signal이 생성되지 않음 (성공은 사이클 종료)

#### Scenario: Retry storm threshold configurable
- **WHEN** 설정에 `retry_storm_threshold`가 명시됨
- **THEN** 해당 값이 사이클 카운트 임계값으로 사용됨 (기본값 3)

### Requirement: Observer detects excessive file reads
Observer는 `tool.execute.after` 훅에서 Read 툴의 동일 파일 반복 읽기를 추적하고, 동일 파일을 임계값(기본 4회) 이상 읽으면 `excessive_read` 타입의 signal을 생성한다.

#### Scenario: Same file read 4 times creates signal
- **WHEN** 한 세션 내에서 동일한 파일 경로가 Read 툴로 4회 읽힘
- **THEN** `~/.config/opencode/harness/signals/pending/{uuid}.json`에 type이 `excessive_read`인 signal 파일이 생성됨
- **AND** signal의 payload에 file_path, read_count가 포함됨

#### Scenario: Different files read multiple times does not trigger
- **WHEN** 서로 다른 3개 파일이 각각 3회씩 읽힘
- **THEN** 어느 파일도 임계값에 도달하지 않아 signal이 생성되지 않음

#### Scenario: Excessive read threshold configurable
- **WHEN** 설정에 `excessive_read_threshold`가 명시됨
- **THEN** 해당 값이 signal 생성 임계값으로 사용됨 (기본값 4)

### Requirement: New waste signals flow through existing Signal-to-Rule pipeline
tool_loop, retry_storm, excessive_read 신호는 기존 `pending/ → signalToRule() → rules/soft/ → ack/` 파이프라인을 그대로 따른다. Improver의 `mapSignalTypeToScope()`가 새 신호 타입을 적절한 scope에 매핑한다.

#### Scenario: tool_loop signal generates soft rule
- **WHEN** `tool_loop` signal이 `pending/`에 존재하고 `session.idle`에서 Improver가 처리함
- **THEN** Improver가 해당 signal을 SOFT 규칙으로 변환함
- **AND** 규칙의 scope는 `tool`로 매핑됨

#### Scenario: retry_storm signal generates soft rule
- **WHEN** `retry_storm` signal이 `pending/`에 존재하고 Improver가 처리함
- **THEN** Improver가 해당 signal을 SOFT 규칙으로 변환함
- **AND** 규칙의 scope는 `tool`로 매핑됨

#### Scenario: excessive_read signal generates soft rule
- **WHEN** `excessive_read` signal이 `pending/`에 존재하고 Improver가 처리함
- **THEN** Improver가 해당 signal을 SOFT 규칙으로 변환함
- **AND** 규칙의 scope는 `tool`로 매핑됨
