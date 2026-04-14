## ADDED Requirements

### Requirement: Enforcer logging uses structured logger
Enforcer의 모든 `console.error/warn` 호출은 `logger` 모듈로 교체된다.

#### Scenario: Rule enforcement logged via logger
- **WHEN** enforcer가 규칙 위반을 감지하고 차단함
- **THEN** `logger.warn('enforcer', 'rule violation blocked', { ... })` 형태로 기록됨
