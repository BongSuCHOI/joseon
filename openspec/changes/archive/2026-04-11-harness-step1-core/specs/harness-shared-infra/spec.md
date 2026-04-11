## ADDED Requirements

### Requirement: Shared types define the contract
`src/types.ts`는 Signal, Rule, ProjectState 인터페이스를 정의한다. 모든 플러그인은 이 파일에서 타입을 import하며, 플러그인별 축소 버전을 재정의하지 않는다.

#### Scenario: Signal type has required fields
- **WHEN** Signal 인터페이스를 사용함
- **THEN** id, type, project_key, timestamp, payload(description, recurrence_count), status 필드가 정의되어 있음

#### Scenario: Rule type has required fields
- **WHEN** Rule 인터페이스를 사용함
- **THEN** id, type, project_key, created_at, source_signal_id, pattern(type, match, scope), description, violation_count 필드가 정의되어 있음

### Requirement: getProjectKey generates unique project identifier
`shared/utils.ts`의 `getProjectKey(worktree)`는 git worktree root의 realpath를 SHA-256 hash하여 앞 12자리를 반환한다.

#### Scenario: Same path produces same key
- **WHEN** 동일한 경로로 `getProjectKey`를 두 번 호출함
- **THEN** 동일한 12자리 hex 문자열이 반환됨

#### Scenario: Different paths produce different keys
- **WHEN** `/home/user/projectA`와 `/tmp/projectA`로 각각 `getProjectKey`를 호출함
- **THEN** 서로 다른 key가 반환됨

#### Scenario: Non-existent path returns unknown
- **WHEN** 존재하지 않는 경로로 `getProjectKey`를 호출함
- **THEN** `'unknown'` 문자열이 반환됨

### Requirement: ensureHarnessDirs creates runtime directory structure
`shared/utils.ts`의 `ensureHarnessDirs()`는 `~/.config/opencode/harness/` 하위의 모든 필수 디렉토리를 idempotently 생성한다.

#### Scenario: First call creates all directories
- **WHEN** `ensureHarnessDirs()`를 최초 호출함 (디렉토리가 없는 상태)
- **THEN** logs/sessions, logs/tools, logs/errors, signals/pending, signals/ack, rules/soft, rules/hard, scaffold, memory/archive, projects, metrics/effectiveness 디렉토리가 모두 생성됨

#### Scenario: Subsequent calls are idempotent
- **WHEN** 디렉토리가 이미 존재하는 상태에서 `ensureHarnessDirs()`를 호출함
- **THEN** 에러 없이 정상 완료됨

### Requirement: logEvent appends JSONL records
`shared/utils.ts`의 `logEvent(category, filename, data)`는 지정된 카테고리 디렉토리에 JSONL 레코드를 append한다.

#### Scenario: Log entry is appended with timestamp
- **WHEN** `logEvent('tools', '2026-04-11.jsonl', { tool: 'bash' })`를 호출함
- **THEN** `~/.config/opencode/harness/logs/tools/2026-04-11.jsonl`에 `{ "tool": "bash", "_ts": "..." }` + 개행이 append됨

### Requirement: generateId returns UUID
`shared/utils.ts`의 `generateId()`는 `import { randomUUID } from 'crypto'`를 사용하여 UUID를 생성한다.

#### Scenario: Each call returns unique ID
- **WHEN** `generateId()`를 두 번 호출함
- **THEN** 서로 다른 UUID 문자열이 반환됨

### Requirement: HARNESS_DIR constant defines base path
`shared/constants.ts`는 `HARNESS_DIR` 상수를 `~/.config/opencode/harness`로 정의한다.

#### Scenario: HARNESS_DIR points to correct path
- **WHEN** `HARNESS_DIR`을 참조함
- **THEN** `join(process.env.HOME, '.config/opencode/harness')`와 동일한 경로를 가리킴

### Requirement: Each plugin calls ensureHarnessDirs on init
observer, enforcer 모두 초기화 시 `ensureHarnessDirs()`를 호출한다.

#### Scenario: Observer initializes directories
- **WHEN** HarnessObserver 플러그인이 로드됨
- **THEN** `ensureHarnessDirs()`가 호출되어 런타임 디렉토리가 존재함이 보장됨

#### Scenario: Enforcer initializes directories
- **WHEN** HarnessEnforcer 플러그인이 로드됨
- **THEN** `ensureHarnessDirs()`가 호출되어 런타임 디렉토리가 존재함이 보장됨
