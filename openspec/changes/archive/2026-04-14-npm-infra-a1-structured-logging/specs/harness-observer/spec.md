## MODIFIED Requirements

### Requirement: Observer logging uses structured logger
Observer의 모든 `logEvent()` 호출과 `console.warn` 호출은 `logger` 모듈로 교체된다.

#### Scenario: Tool execution logged via logger
- **WHEN** observer가 tool execution 이벤트를 로깅함
- **THEN** `logger.info('observer', 'tool executed', { ... })` 형태로 기록됨

#### Scenario: Session conflict warning via logger
- **WHEN** observer가 중복 세션을 감지함
- **THEN** `logger.warn('observer', 'Session already active', { pid: ... })` 형태로 기록됨
