## ADDED Requirements

### Requirement: Improver converts pending signals to SOFT rules on session.idle
Improver 플러그인은 `event` 훅의 `session.idle` 이벤트에서 `signals/pending/`의 모든 signal을 읽어 SOFT 규칙으로 자동 변환한다. 변환 완료된 signal은 `signals/ack/`로 이동한다.

#### Scenario: Pending signal converted to SOFT rule
- **WHEN** `signals/pending/`에 type이 `error_repeat`인 signal 파일이 존재하고 `session.idle` 이벤트가 발생함
- **THEN** `rules/soft/{ruleId}.json`에 새로운 SOFT 규칙이 생성됨
  - `pattern.type`: `'code'`
  - `pattern.match`: signal의 `payload.pattern` 값
  - `pattern.scope`: signal type에 따라 자동 결정 (`error_repeat` → `'tool'`, `user_feedback` → `'prompt'`, `fix_commit` → `'file'`)
  - `description`: signal의 `payload.description` 값
  - `violation_count`: 0
- **AND** signal 파일이 `signals/ack/`로 이동함
- **AND** `rules/history.jsonl`에 규칙 생성 이벤트가 append됨

#### Scenario: Pending signal discarded when duplicate rule exists
- **WHEN** `signals/pending/`에 signal이 있고, 동일 `pattern.match`의 규칙이 이미 `rules/soft/` 또는 `rules/hard/`에 존재함
- **THEN** signal은 규칙 생성 없이 `signals/ack/`로 이동함 (중복 무시)

#### Scenario: Multiple pending signals processed in one session.idle
- **WHEN** `signals/pending/`에 3개의 signal 파일이 존재하고 `session.idle` 이벤트가 발생함
- **THEN** 3개 모두 순차적으로 처리되어 각각 규칙 생성 또는 중복 무시 후 ack로 이동함

### Requirement: Improver auto-promotes SOFT rules to HARD on repeated violations
Improver는 `session.idle`에서 `rules/soft/`의 규칙 중 `violation_count >= 2`이고 `pattern.scope !== 'prompt'`인 규칙을 HARD로 자동 승격한다. 승격 시 `violation_count`를 0으로 리셋한다.

#### Scenario: SOFT rule with 2+ violations promoted to HARD
- **WHEN** `rules/soft/{id}.json`의 `violation_count`가 2 이상이고 `pattern.scope`가 `'tool'` 또는 `'file'`임
- **THEN** 규칙 파일이 `rules/hard/{id}.json`으로 이동함
- **AND** `type`이 `'hard'`로 변경됨
- **AND** `promoted_at`에 승격 시간이 기록됨
- **AND** `violation_count`가 0으로 리셋됨
- **AND** `rules/history.jsonl`에 승격 이벤트가 append됨

#### Scenario: SOFT rule with prompt scope is never promoted
- **WHEN** `rules/soft/{id}.json`의 `pattern.scope`가 `'prompt'`임
- **THEN** `violation_count`가 2 이상이어도 승격되지 않음

#### Scenario: SOFT rule with 1 violation is not promoted
- **WHEN** `rules/soft/{id}.json`의 `violation_count`가 1임
- **THEN** 승격되지 않음

### Requirement: Improver measures rule effectiveness after 30 days
Improver는 `session.idle`에서 30일 이상 경과한 규칙의 효과를 측정한다. 측정은 delta 기반으로, 마지막 측정 이후 위반 증분으로 판정한다.

#### Scenario: Rule effective after 30 days with no delta violations
- **WHEN** 규칙의 `created_at`이 30일 이전이고, `violation_count`가 마지막 측정값과 동일함 (delta = 0)
- **THEN** 규칙의 `effectiveness` 필드가 `{ status: 'effective', measured_at: <now>, recurrence_after_rule: 0 }`로 갱신됨

#### Scenario: Rule needs promotion after 30 days with delta violations
- **WHEN** 규칙의 `created_at`이 30일 이전이고, delta `violation_count`가 2 이상임
- **THEN** 규칙의 `effectiveness` 필드가 `{ status: 'needs_promotion', measured_at: <now>, recurrence_after_rule: <delta> }`로 갱신됨

#### Scenario: Rule younger than 30 days is not measured
- **WHEN** 규칙의 `created_at`이 30일 이내임
- **THEN** 효과 측정이 건너뛰어짐

### Requirement: Improver detects fix: commits via git log on session.idle
Improver는 `session.idle`에서 observer가 기록한 세션 시작 타임스탬프를 읽어, `git log --since=<timestamp>`로 세션 내 fix: 커밋을 감지하고 `fix_commit` signal을 생성한다.

#### Scenario: fix: commit detected creates signal
- **WHEN** 세션 내에 `fix:` 접두사로 시작하는 커밋 메시지가 있음
- **AND** `session_start_<projectKey>.json`에 세션 시작 시간이 기록되어 있음
- **THEN** `signals/pending/`에 type이 `fix_commit`인 signal이 생성됨
  - `payload.pattern`: 변경된 파일 경로 (diff에서 추출)
  - `payload.source_file`: 첫 번째로 변경된 파일 경로
  - `payload.description`: 커밋 메시지의 fix: 줄

#### Scenario: No fix: commit creates no signal
- **WHEN** 세션 내에 `fix:` 접두사 커밋이 없음
- **THEN** fix_commit signal이 생성되지 않음

#### Scenario: git command failure does not crash improver
- **WHEN** `git log` 실행이 실패함 (git 미설치, non-repo 디렉토리 등)
- **THEN** 에러가 로깅되고 fix: 커밋 감지가 건너뛰어지며 다른 기능은 정상 동작함

### Requirement: Improver updates project state.json on session.idle
Improver는 `session.idle`에서 프로젝트 상태(`projects/{projectKey}/state.json`)를 갱신한다.

#### Scenario: Project state updated after rule processing
- **WHEN** improver가 signal 처리, 승격, 효과 측정을 완료함
- **THEN** `projects/{projectKey}/state.json`이 갱신됨
  - `soft_rule_count`: 현재 soft/ 규칙 수
  - `hard_rule_count`: 현재 hard/ 규칙 수
  - `pending_signal_count`: 현재 pending/ signal 수
  - `hard_ratio`: hard / (soft + hard)
  - `last_improvement_at`: 현재 시간
  - `project_path`: `ctx.worktree`

### Requirement: Improver injects context on session.compacting
Improver는 `experimental.session.compacting` 훅에서 scaffold, HARD 규칙, SOFT 규칙을 컨텍스트에 주입한다.

#### Scenario: Scaffold and rules injected on compacting
- **WHEN** 세션 compacting 이벤트가 발생함
- **THEN** `output.context`에 scaffold 내용, HARD 규칙 설명 목록, SOFT 규칙 설명 목록이 순서대로 push됨
- **AND** scaffold 파일이 없으면 scaffold 섹션은 생략됨
- **AND** 규칙이 없으면 규칙 섹션은 생략됨

#### Scenario: scope:prompt rules injected via compacting
- **WHEN** scope가 `'prompt'`인 규칙이 존재함
- **THEN** 해당 규칙의 설명이 compacting 컨텍스트에 포함됨 (이것이 유일한 강제 수단)

### Requirement: Improver calls ensureHarnessDirs on init
Improver 플러그인은 초기화 시 `ensureHarnessDirs()`를 호출한다.

#### Scenario: Improver initializes directories
- **WHEN** HarnessImprover 플러그인이 로드됨
- **THEN** `ensureHarnessDirs()`가 호출되어 런타임 디렉토리가 존재함이 보장됨
