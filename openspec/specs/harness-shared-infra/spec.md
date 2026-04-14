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

### Requirement: logEvent appends JSONL records (deprecated)
`shared/utils.ts`의 `logEvent(category, filename, data)`는 `@deprecated` 마크되며, 내부적으로 `logger.info()`로 redirect한다. category는 data 객체에 `_category` 필드로 보존된다.

#### Scenario: Log entry is appended with timestamp
- **WHEN** `logEvent('tools', '2026-04-11.jsonl', { tool: 'bash' })`를 호출함
- **THEN** `harness.jsonl`에 `{"level":"info","module":"legacy","msg":"logEvent","data":{"tool":"bash","_category":"tools","_filename":"2026-04-11.jsonl"},"ts":"..."}` 레코드가 append됨

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

### Requirement: Type definitions include Step 4 orchestration types
`src/types.ts`는 Step 4 오케스트레이션에 필요한 모든 타입을 포함한다.

#### Scenario: Signal type extended with agent_id
- **WHEN** 오케스트레이터가 Signal을 생성함
- **THEN** `agent_id?: string` 필드를 포함하여 어떤 에이전트가 signal을 생성했는지 식별 가능함

#### Scenario: PhaseState type available
- **WHEN** Phase Manager가 Phase 상태를 읽거나 쓸 때
- **THEN** `PhaseState` 인터페이스(`current_phase`, `phase_history`, `qa_test_plan_exists`, optional `incomplete_phase`)를 사용함

#### Scenario: QAFailures type available
- **WHEN** QA tracker가 실패를 기록할 때
- **THEN** `QAFailures` 인터페이스(scenario-level `count`, `last_failure_at`, `details` array)를 사용함

#### Scenario: EvalResult type available
- **WHEN** harness eval 결과를 읽을 때
- **THEN** `EvalResult` 인터페이스(`total_checks`, `passed_checks`, `hard_ratio`, `failures` array)를 사용함

### Requirement: Plugin config callback registers agents
플러그인 진입점 `src/index.ts`에서 `config` 콜백은 `server()`가 반환하는 Hooks 객체의 프로퍼티로 포함하여 에이전트를 자동 등록한다. (`PluginModule` 최상위에 두면 OpenCode가 무시함)

#### Scenario: Config callback registers agents
- **WHEN** OpenCode가 플러그인을 로드하고 config 콜백을 호출함
- **THEN** 모든 에이전트 정의가 `opencodeConfig.agent`에 병합되고 `default_agent`가 "orchestrator"로 설정됨

### Requirement: Plugin entry point with orchestrator
The plugin entry point `src/index.ts` SHALL merge Orchestrator hooks via `mergeEventHandlers` alongside existing observer, enforcer, and improver hooks.

#### Scenario: All hooks merged
- **WHEN** the plugin is loaded
- **THEN** observer, enforcer, improver, orchestrator, AND extra hooks (delegate-task-retry, json-error-recovery, delegation-nudge, phase-reminder) SHALL all be active via mergeEventHandlers

### Requirement: Plugin entry point merges all extra hooks
`src/index.ts`의 `server()` 함수는 `src/hooks/index.ts`에서 생성한 모든 훅을 기존 observer/enforcer/improver/orchestrator 훅과 함께 `mergeEventHandlers`로 병합한다.

#### Scenario: Multiple tool.execute.after handlers coexist
- **WHEN** observer의 tool.execute.after와 hooks의 tool.execute.after가 모두 등록됨
- **THEN** 두 핸들러 모두 순차적으로 실행됨 (한쪽이 다른 쪽을 덮어쓰지 않음)

---

## ADDED Requirements

### Requirement: parseList utility exported from shared
`src/shared/utils.ts`의 `parseList()` 함수는 shared 배럴 인덱스를 통해 export된다.

#### Scenario: Import parseList from shared
- **WHEN** 다른 모듈에서 `import { parseList } from '../shared/index.js'`를 호출함
- **THEN** `parseList` 함수가 사용 가능함
