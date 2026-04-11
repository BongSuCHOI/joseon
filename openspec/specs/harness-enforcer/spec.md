## ADDED Requirements

### Requirement: Enforcer blocks HARD rule violations
Enforcer 플러그인은 `tool.execute.before` 훅에서 HARD 규칙의 패턴이 매칭되면 `throw Error`로 도구 실행을 차단한다.

#### Scenario: HARD rule with tool scope blocks execution
- **WHEN** `rules/hard/`에 scope가 `tool`인 규칙이 존재하고, 도구 실행의 tool 이름이나 args가 패턴과 매칭됨
- **THEN** 해당 도구 실행이 차단되고, 에러 메시지에 `[HARNESS HARD BLOCK]` 접두사와 규칙 설명이 포함됨

#### Scenario: HARD rule with file scope blocks execution
- **WHEN** `rules/hard/`에 scope가 `file`인 규칙이 존재하고, write/edit/patch 도구의 파일 경로가 패턴과 매칭됨
- **THEN** 해당 도구 실행이 차단되고, 에러 메시지에 파일 경로와 규칙 ID가 포함됨

#### Scenario: HARD rule with prompt scope does not block
- **WHEN** `rules/hard/`에 scope가 `prompt`인 규칙이 존재함
- **THEN** `tool.execute.before`에서 해당 규칙은 무시됨 (컨텍스트 주입으로만 처리)

### Requirement: Enforcer tracks SOFT rule violations
Enforcer 플러그인은 `tool.execute.before` 훅에서 SOFT 규칙(scope: 'tool', 'file')의 위반을 감지하고, 매칭 시 violation_count를 증가시킨다. 차단은 하지 않는다.

#### Scenario: SOFT tool violation increments count
- **WHEN** `rules/soft/`에 scope가 `tool`인 규칙이 존재하고, 도구 실행이 패턴과 매칭됨
- **THEN** 해당 규칙 파일의 `violation_count`가 1 증가하고 `last_violation_at`이 갱신됨. 도구 실행은 차단되지 않음

#### Scenario: SOFT file violation increments count
- **WHEN** `rules/soft/`에 scope가 `file'`인 규칙이 존재하고, write/edit/patch 도구의 파일 경로가 패턴과 매칭됨
- **THEN** 해당 규칙 파일의 `violation_count`가 1 증가하고 `last_violation_at`이 갱신됨. 도구 실행은 차단되지 않음

#### Scenario: SOFT prompt scope does not increment count
- **WHEN** `rules/soft/`에 scope가 `prompt`인 규칙이 존재함
- **THEN** `tool.execute.before`에서 해당 규칙은 건너뛰고 violation_count는 증가하지 않음

### Requirement: Enforcer checks scaffold NEVER DO patterns
Enforcer는 write/edit/patch 도구 실행 시 scaffold NEVER DO 패턴을 체크한다. 글로벌 scaffold와 프로젝트별 scaffold 모두 확인한다.

#### Scenario: Content matching NEVER DO pattern is blocked
- **WHEN** scaffold에 "NEVER DO" 섹션에 패턴이 있고, write/edit 도구의 content(`output.args.content` 또는 `output.args.newString`)에서 키워드 60% 이상이 매칭됨
- **THEN** 도구 실행이 차단되고, 에러 메시지에 `[HARNESS SCAFFOLD VIOLATION]` 접두사가 포함됨

#### Scenario: No scaffold file does not block
- **WHEN** scaffold 파일이 존재하지 않음
- **THEN** scaffold 체크가 건너뛰어지고 도구 실행이 정상 진행됨

### Requirement: Enforcer blocks .env git commit
Enforcer는 bash 도구에서 `.env` 파일의 git add/commit을 차단한다.

#### Scenario: Git add .env is blocked
- **WHEN** bash 도구의 command에 `git add` 또는 `git commit`과 `.env`가 모두 포함됨
- **THEN** 도구 실행이 차단되고, 에러 메시지에 ".env 파일의 git add/commit이 금지" 문구가 포함됨

### Requirement: Enforcer reloads rules on session start
Enforcer는 `session.created` 이벤트에서 규칙을 리로드한다.

#### Scenario: Rules reloaded on new session
- **WHEN** 새 세션이 생성됨 (`session.created`)
- **THEN** HARD 규칙, SOFT 규칙, scaffold 패턴이 모두 디스크에서 다시 로드됨

### Requirement: Enforcer uses safe regex matching
Enforcer의 모든 정규식 패턴 매칭은 `safeRegexTest()`로 보호된다.

#### Scenario: Invalid regex pattern does not crash enforcer
- **WHEN** 규칙의 `pattern.match`에 잘못된 정규식이 들어있음
- **THEN** 해당 패턴은 무시되고(false 반환), enforcer 플러그인은 계속 정상 동작함

### Requirement: Enforcer loads project-scoped and global rules
Enforcer는 로드 시 `project_key`가 현재 프로젝트이거나 `'global'`인 규칙만 로드한다.

#### Scenario: Only relevant rules are loaded
- **WHEN** 규칙 파일들 중 현재 프로젝트 key와 일치하는 것과 global 표시된 것만 있음
- **THEN** 해당 규칙들만 로드되고, 다른 프로젝트의 규칙은 무시됨
