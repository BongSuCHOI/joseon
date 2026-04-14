## MODIFIED Requirements

### Requirement: Config schema defines HarnessConfig type
`src/config/schema.ts`는 `HarnessConfig` 인터페이스를 정의한다. 최상위 키는 `agents`, `harness`, `fallback`이며, 모든 필드는 optional이다.

#### Scenario: HarnessConfig has agents, harness, and fallback sections
- **WHEN** `HarnessConfig` 타입을 사용함
- **THEN** `agents?: Record<string, AgentOverrideConfig>`, `harness?: HarnessSettings`, `fallback?: FallbackConfig` 필드가 정의되어 있음

### Requirement: AgentOverrideConfig allows per-agent overrides
`AgentOverrideConfig`은 `model`, `temperature`, `hidden`, `variant`, `skills`, `mcps`, `options`, `prompt`, `append_prompt` 필드를 가진다. 모두 optional.

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

#### Scenario: All defaults match current behavior
- **WHEN** config 파일이 존재하지 않거나 agents 섹션이 비어있음
- **THEN** 모든 에이전트가 기존 기본값으로 동작함 (회귀 없음)

### Requirement: Config loader reads JSONC and JSON files
`src/config/loader.ts`의 `loadConfig(directory)` 함수는 기존과 동일하게 동작한다. 새 필드는 모두 optional이므로 loader 수정이 불필요하다.

#### Scenario: Existing config loads without changes
- **WHEN** 기존 harness.jsonc에 `agents`, `harness`만 있고 `fallback`이 없음
- **THEN** 정상적으로 로드되고 `fallback`은 기본값으로 설정됨
