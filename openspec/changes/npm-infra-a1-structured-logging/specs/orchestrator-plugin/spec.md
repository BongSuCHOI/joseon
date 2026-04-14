## MODIFIED Requirements

### Requirement: Orchestrator logging uses structured logger
Orchestrator의 `logEvent()` 호출과 `console.error` 호출은 `logger` 모듈로 교체된다.

#### Scenario: Orchestrator idle event logged via logger
- **WHEN** orchestrator가 session.idle 이벤트를 처리함
- **THEN** `logger.info('orchestrator', 'session idle', { ... })` 형태로 기록됨

#### Scenario: Orchestrator error via logger
- **WHEN** orchestrator 이벤트 처리 중 에러 발생함
- **THEN** `logger.error('orchestrator', 'session.idle error', { error: ... })` 형태로 기록됨
