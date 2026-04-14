## MODIFIED Requirements

### Requirement: logEvent appends JSONL records
`shared/utils.ts`의 `logEvent(category, filename, data)`는 `@deprecated` 마크되며, 내부적으로 `logger.info()`로 redirect한다. category는 data 객체에 `_category` 필드로 보존된다.

#### Scenario: Log entry is appended with timestamp
- **WHEN** `logEvent('tools', '2026-04-11.jsonl', { tool: 'bash' })`를 호출함
- **THEN** `harness.jsonl`에 `{"level":"info","module":"legacy","msg":"logEvent","data":{"tool":"bash","_category":"tools","_filename":"2026-04-11.jsonl"},"ts":"..."}` 레코드가 append됨

## ADDED Requirements

### Requirement: Logger module exported from shared index
`src/shared/index.ts`는 `logger`의 모든 named exports를 re-export한다.

#### Scenario: Import logger from shared
- **WHEN** 다른 모듈에서 `import { logger } from '../shared/index.js'`를 호출함
- **THEN** `logger.debug`, `logger.info`, `logger.warn`, `logger.error`가 모두 사용 가능함
