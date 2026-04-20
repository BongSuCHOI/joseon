## ADDED Requirements

### Requirement: Config schema defines HarnessConfig type
`src/config/schema.ts`는 `HarnessConfig` 인터페이스를 정의한다. 최상위 키는 `agents`와 `harness`이며, 모든 필드는 optional이다.

#### Scenario: HarnessConfig has agents and harness sections
- **WHEN** `HarnessConfig` 타입을 사용함
- **THEN** `agents?: Record<string, AgentOverrideConfig>`과 `harness?: HarnessSettings` 필드가 정의되어 있음

### Requirement: AgentOverrideConfig allows per-agent overrides
`AgentOverrideConfig`은 `model`, `temperature`, `hidden` 필드를 가진다. 모두 optional.

#### Scenario: Override agent temperature
- **WHEN** config 파일에 `{"agents": {"designer": {"temperature": 0.9}}}`가 설정됨
- **THEN** designer 에이전트의 temperature가 0.9로 오버라이드됨

#### Scenario: Override agent model
- **WHEN** config 파일에 `{"agents": {"frontend": {"model": "claude-sonnet"}}}`가 설정됨
- **THEN** frontend 에이전트의 model이 "claude-sonnet"으로 오버라이드됨

#### Scenario: Override agent hidden
- **WHEN** config 파일에 `{"agents": {"explorer": {"hidden": true}}}`가 설정됨
- **THEN** explorer 에이전트가 @mention 목록에서 숨겨짐

### Requirement: HarnessSettings defines harness tuning parameters
`HarnessSettings`은 `soft_to_hard_threshold`, `escalation_threshold`, `max_recovery_stages`, `history_max_bytes`, `regex_max_length`, `scaffold_match_ratio`, `search_max_results` 필드를 가진다. 모두 optional.

#### Scenario: Override soft_to_hard_threshold
- **WHEN** config 파일에 `{"harness": {"soft_to_hard_threshold": 3}}`가 설정됨
- **THEN** enforcer가 violation_count 3에서 SOFT→HARD 승격을 수행함

#### Scenario: All defaults match current hardcoded values
- **WHEN** config 파일이 존재하지 않거나 harness 섹션이 비어있음
- **THEN** 모든 하네스 설정값이 현재 하드코딩된 기본값과 동일함

### Requirement: Config loader reads JSONC and JSON files
`src/config/loader.ts`의 `loadConfig(directory)` 함수는 JSONC(주석 허용)와 JSON 파일을 모두 읽을 수 있다. JSONC에서 `//` 주석과 trailing comma를 제거한 후 JSON.parse로 파싱한다.

#### Scenario: Load JSONC with comments
- **WHEN** `harness.jsonc`에 `// 이것은 주석`과 `"key": "value",` (trailing comma)가 포함되어 있음
- **THEN** 주석이 제거되고 trailing comma가 정리된 후 정상적으로 파싱됨

#### Scenario: Load pure JSON as fallback
- **WHEN** `harness.jsonc`가 없고 `harness.json`만 존재함
- **THEN** `harness.json`이 정상적으로 로드됨

### Requirement: Config loader merges global and project configs
글로벌 설정(`~/.config/opencode/harness.jsonc`)을 먼저 로드하고, 프로젝트 설정(`<project>/.opencode/harness.jsonc`)을 deep-merge하여 프로젝트 설정이 우선한다.

#### Scenario: Project overrides global
- **WHEN** 글로벌에 `{"agents": {"frontend": {"temperature": 0.2}}}`가 있고 프로젝트에 `{"agents": {"frontend": {"temperature": 0.05}}}`가 있음
- **THEN** frontend의 temperature는 0.05가 됨

#### Scenario: No config files returns defaults
- **WHEN** 글로벌과 프로젝트 모두 config 파일이 없음
- **THEN** 빈 HarnessConfig 객체가 반환됨 (모든 값이 기본값으로 동작)

#### Scenario: Invalid config file returns defaults
- **WHEN** config 파일이 존재하지만 JSON 파싱에 실패함
- **THEN** 빈 HarnessConfig 객체가 반환됨 (에러를 throw하지 않음)

---

## MODIFIED Requirements

### Requirement: Config schema defines HarnessConfig type
`src/config/schema.ts`는 `HarnessConfig` 인터페이스를 정의한다. 최상위 키는 `agents`, `harness`, `fallback`이며, 모든 필드는 optional이다.

#### Scenario: HarnessConfig has agents, harness, and fallback sections
- **WHEN** `HarnessConfig` 타입을 사용함
- **THEN** `agents?: Record<string, AgentOverrideConfig>`, `harness?: HarnessSettings`, `fallback?: FallbackConfig` 필드가 정의되어 있음

### Requirement: AgentOverrideConfig allows per-agent overrides
`AgentOverrideConfig`은 `model`, `temperature`, `hidden`, `variant`, `skills`, `mcps`, `options`, `prompt`, `append_prompt`, `deny_tools` 필드를 가진다. 모두 optional.

#### Scenario: Override agent variant
- **WHEN** config 파일에 `{"agents": {"designer": {"variant": "high"}}}`가 설정됨
- **THEN** designer 에이전트의 variant가 "high"로 오버라이드됨

#### Scenario: Override agent model with array
- **WHEN** config 파일에 `{"agents": {"librarian": {"model": ["provider-a/model-x", "provider-b/model-y"]}}}`가 설정됨
- **THEN** librarian 에이전트의 model이 배열로 처리되어 첫 번째 모델이 사용되고, 나머지는 fallback chain에 저장됨

#### Scenario: Override agent mcps
- **WHEN** config 파일에 `{"agents": {"librarian": {"mcps": ["websearch", "context7"]}}}`가 설정됨
- **THEN** librarian 에이전트가 websearch, context7 MCP 툴만 사용하도록 제한됨

#### Scenario: Override agent skills
- **WHEN** config 파일에 `{"agents": {"designer": {"skills": ["agent-browser"]}}}`가 설정됨
- **THEN** designer 에이전트가 agent-browser 스킬만 사용하도록 제한됨

#### Scenario: Override agent with custom prompt
- **WHEN** config 파일에 `{"agents": {"librarian": {"prompt": "/path/to/custom.md"}}}`가 설정됨
- **THEN** librarian 에이전트의 기본 프롬프트가 해당 파일 내용으로 교체됨

#### Scenario: Override agent with append prompt
- **WHEN** config 파일에 `{"agents": {"librarian": {"append_prompt": "/path/to/extra.md"}}}`가 설정됨
- **THEN** librarian 에이전트의 기본 프롬프트 끝에 해당 파일 내용이 추가됨

#### Scenario: Override agent with deny_tools
- **WHEN** config 파일에 `{"agents": {"reviewer": {"deny_tools": ["write", "edit", "bash"]}}}`가 설정됨
- **THEN** reviewer 에이전트가 write, edit, bash 도구를 사용할 수 없도록 제한됨

#### Scenario: All defaults match current behavior
- **WHEN** config 파일이 존재하지 않거나 agents 섹션이 비어있음
- **THEN** 모든 에이전트가 기존 기본값으로 동작함 (회귀 없음)

### Requirement: Config loader reads JSONC and JSON files
`src/config/loader.ts`의 `loadConfig(directory)` 함수는 기존과 동일하게 동작한다. 새 필드는 모두 optional이므로 loader 수정이 불필요하다.

#### Scenario: Existing config loads without changes
- **WHEN** 기존 harness.jsonc에 `agents`, `harness`만 있고 `fallback`이 없음
- **THEN** 정상적으로 로드되고 `fallback`은 기본값으로 설정됨

### Requirement: HarnessSettings supports max_subagent_depth
`HarnessSettings`에 `max_subagent_depth` 필드가 추가된다. 기본값은 3.

#### Scenario: Override max_subagent_depth
- **WHEN** config 파일에 `{"harness": {"max_subagent_depth": 5}}`가 설정됨
- **THEN** SubagentDepthTracker의 maxDepth가 5로 설정됨

#### Scenario: Default max_subagent_depth is 3
- **WHEN** config 파일에 max_subagent_depth가 없음
- **THEN** 기본값 3으로 동작함

### Requirement: HarnessSettings supports candidate_threshold
`HarnessSettings`에 `candidate_threshold` 필드가 추가된다. 기본값은 3. 반복 실수 패턴을 candidate로 기록하는 임계값이다.

#### Scenario: Override candidate_threshold
- **WHEN** config 파일에 `{"harness": {"candidate_threshold": 5}}`가 설정됨
- **THEN** groupMistakeCandidates의 candidate 생성 임계값이 5로 설정됨

#### Scenario: Default candidate_threshold is 3
- **WHEN** config 파일에 candidate_threshold가 없음
- **THEN** 기본값 3으로 동작함
