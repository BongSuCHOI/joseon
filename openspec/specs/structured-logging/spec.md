## ADDED Requirements

### Requirement: Logger provides level-based logging API
`src/shared/logger.ts`는 `debug`, `info`, `warn`, `error` 4개 레벨의 로깅 함수를 named export로 제공한다. 각 함수는 `(module: string, message: string, data?: Record<string, unknown>)` 시그니처를 갖는다.

#### Scenario: Log entry written with correct level
- **WHEN** `logger.info('observer', 'session created', { sessionId: 'abc' })`를 호출함
- **THEN** `harness.jsonl`에 `{"level":"info","module":"observer","msg":"session created","data":{"sessionId":"abc"},"ts":"..."}` 형태의 JSONL 레코드가 append됨

#### Scenario: Log entry written without data
- **WHEN** `logger.warn('enforcer', 'soft violation tracked')`를 호출함
- **THEN** `harness.jsonl`에 `data` 필드 없이 `{"level":"warn","module":"enforcer","msg":"soft violation tracked","ts":"..."}` 레코드가 append됨

### Requirement: Logger filters by HARNESS_LOG_LEVEL environment variable
런타임에 `HARNESS_LOG_LEVEL` 환경변수로 로그 레벨을 제어한다. 기본값은 `info`. 설정된 레벨 이상만 파일과 stderr에 출력된다.

#### Scenario: Default level is info
- **WHEN** `HARNESS_LOG_LEVEL` 환경변수가 설정되지 않은 상태에서 `logger.debug('test', 'debug msg')`를 호출함
- **THEN** `harness.jsonl`에 아무 레코드도 append되지 않음

#### Scenario: Debug level enables all logs
- **WHEN** `HARNESS_LOG_LEVEL=debug` 환경에서 `logger.debug('test', 'debug msg')`를 호출함
- **THEN** `harness.jsonl`에 debug 레코드가 append됨

#### Scenario: Error level suppresses info
- **WHEN** `HARNESS_LOG_LEVEL=error` 환경에서 `logger.info('test', 'info msg')`를 호출함
- **THEN** `harness.jsonl`에 아무 레코드도 append되지 않음

### Requirement: Logger outputs to unified JSONL file
모든 로그는 `~/.config/opencode/harness/logs/harness.jsonl` 단일 파일에 append된다.

#### Scenario: All modules write to same file
- **WHEN** observer, enforcer, orchestrator가 각각 `logger.info()`를 호출함
- **THEN** 세 레코드 모두 동일한 `harness.jsonl` 파일에 순서대로 append됨

### Requirement: Logger outputs formatted messages to stderr
각 로그은 `[harness:<module>] <LEVEL>: <message>` 포맷으로 stderr에도 출력된다. data가 있으면 JSON 문자열로 이어붙임.

#### Scenario: Error log to stderr
- **WHEN** `logger.error('orchestrator', 'phase failed', { phase: 3 })`를 호출함
- **THEN** stderr에 `[harness:orchestrator] ERROR: phase failed {"phase":3}` 출력됨

#### Scenario: Stderr respects log level
- **WHEN** `HARNESS_LOG_LEVEL=warn` 환경에서 `logger.info('test', 'msg')`를 호출함
- **THEN** stderr에 아무것도 출력되지 않음

### Requirement: Logger module exported from shared index
`src/shared/index.ts`는 `logger`의 모든 named exports를 re-export한다.

#### Scenario: Import logger from shared
- **WHEN** 다른 모듈에서 `import { logger } from '../shared/index.js'`를 호출함
- **THEN** `logger.debug`, `logger.info`, `logger.warn`, `logger.error`가 모두 사용 가능함
