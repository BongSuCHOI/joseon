## MODIFIED Requirements

### Requirement: Observer records session start timestamp on session.created
Observer 플러그인은 `session.created` 이벤트에서 세션 시작 타임스탬프를 파일로 기록한다. 이 타임스탬프는 improver의 fix: 커밋 감지(`git log --since=<timestamp>`)에서 사용된다.

#### Scenario: Session start timestamp recorded
- **WHEN** `session.created` 이벤트가 발생함
- **THEN** `~/.config/opencode/harness/logs/sessions/session_start_{projectKey}.json`에 `{ timestamp: <ISO string>, sessionID: <id> }`가 write됨 (append가 아닌 overwrite — 가장 최근 세션 시간만 필요)

#### Scenario: Timestamp available for fix: commit detection
- **WHEN** improver가 `session.idle`에서 fix: 커밋을 감지하려 함
- **THEN** `session_start_{projectKey}.json`에서 세션 시작 시간을 읽을 수 있음
