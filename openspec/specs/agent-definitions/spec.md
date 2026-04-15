## ADDED Requirements

### Requirement: Agent factory functions
The system SHALL provide `createXxxAgent()` factory functions for each agent: orchestrator, build, frontend, backend, tester, reviewer, cross-reviewer. Each factory SHALL return an AgentDefinition with name, description, config (prompt, temperature, model), and optional permissions.

#### Scenario: Create orchestrator agent
- **WHEN** `createOrchestratorAgent()` is called
- **THEN** it SHALL return AgentDefinition with name "orchestrator", mode "primary", temperature 0.1, and the orchestrator system prompt

#### Scenario: Create build agent
- **WHEN** `createBuildAgent()` is called
- **THEN** it SHALL return AgentDefinition with name "build", mode "subagent", temperature 0.1, and the build PM system prompt

#### Scenario: Create cross-reviewer agent with restricted permissions
- **WHEN** `createCrossReviewerAgent()` is called
- **THEN** it SHALL return AgentDefinition with permission `{ file_edit: "deny", bash: "deny", task: "deny" }`

### Requirement: Agent auto-registration via config callback
The plugin SHALL register all agents via the `config` callback in `src/index.ts`, merging into `opencodeConfig.agent` with shallow merge (plugin defaults first, user overrides win).

#### Scenario: Register agents on fresh config
- **WHEN** config callback fires and `opencodeConfig.agent` is empty
- **THEN** all agent definitions SHALL be merged into `opencodeConfig.agent`

#### Scenario: User overrides preserved
- **WHEN** config callback fires and user has existing agent config for "orchestrator"
- **THEN** user's fields SHALL override plugin defaults (shallow merge)

### Requirement: Default agent set to orchestrator
The plugin SHALL set `opencodeConfig.default_agent` to "orchestrator" when the user has not already configured one.

#### Scenario: No user default_agent
- **WHEN** config callback fires and `opencodeConfig.default_agent` is not set
- **THEN** it SHALL be set to "orchestrator"

#### Scenario: User has default_agent
- **WHEN** config callback fires and `opencodeConfig.default_agent` is already set
- **THEN** it SHALL NOT be overridden

### Requirement: Agent creation uses config overrides
`src/agents/agents.ts`의 각 `create*Agent()` 함수는 하드코딩된 값 대신 config의 `AgentOverrideConfig`를 참조하여 model, temperature, hidden을 설정한다. Config에 값이 없으면 기존 하드코딩값을 기본값으로 사용한다.

#### Scenario: Agent with config override
- **WHEN** config에 `{"agents": {"designer": {"temperature": 0.9}}}`가 설정됨
- **THEN** `createDesignerAgent()`가 반환하는 에이전트의 temperature가 0.9임

#### Scenario: Agent without config override uses default
- **WHEN** config에 designer 관련 설정이 없음
- **THEN** `createDesignerAgent()`가 기존 하드코딩값인 temperature 0.7을 사용함

---

## MODIFIED Requirements

### Requirement: Agent creation uses config overrides
`src/agents/agents.ts`의 각 `create*Agent()` 함수는 config의 `AgentOverrideConfig`를 참조하여 model, temperature, hidden, variant, skills, mcps, options, prompt, append_prompt를 설정한다. Config에 값이 없으면 기존 하드코딩값을 기본값으로 사용한다.

#### Scenario: Agent with model array override
- **WHEN** config에 `{"agents": {"librarian": {"model": ["a/x", "b/y"]}}}`가 설정됨
- **THEN** `createLibrarianAgent()`가 반환하는 에이전트의 config.model이 "a/x"로 설정되고, _modelArray에 전체 배열이 저장됨

#### Scenario: Agent with variant override
- **WHEN** config에 `{"agents": {"designer": {"variant": "high"}}}`가 설정됨
- **THEN** `createDesignerAgent()`가 반환하는 에이전트의 config.variant가 "high"로 설정됨

#### Scenario: Agent with custom prompt override
- **WHEN** config에 `{"agents": {"librarian": {"prompt": "/path/to/custom.md"}}}`가 설정됨
- **THEN** `createLibrarianAgent()`가 반환하는 에이전트의 config.prompt가 해당 파일 내용으로 교체됨

#### Scenario: Agent with append prompt override
- **WHEN** config에 `{"agents": {"librarian": {"append_prompt": "/path/to/extra.md"}}}`가 설정됨
- **THEN** `createLibrarianAgent()`가 반환하는 에이전트의 config.prompt 끝에 해당 파일 내용이 추가됨

#### Scenario: Agent with invalid prompt path
- **WHEN** config에 `{"agents": {"librarian": {"prompt": "/nonexistent/path.md"}}}`가 설정됨
- **THEN** logger.warn으로 경고를 출력하고 기본 프롬프트를 유지함

#### Scenario: Agent without config override uses default
- **WHEN** config에 librarian 관련 설정이 없음
- **THEN** `createLibrarianAgent()`가 기존 하드코딩값을 사용함 (회귀 없음)

### Requirement: Agent auto-registration via config callback
플러그인 진입점 `src/index.ts`의 `config` 콜백은 에이전트를 등록할 뿐만 아니라, 에이전트별 MCP/Skills/Tool deny permission을 자동으로 생성한다.

#### Scenario: MCP permissions generated during registration
- **WHEN** config 콜백이 실행되고 librarian 에이전트에 `mcps: ["websearch"]`가 설정되어 있음
- **THEN** librarian 에이전트의 permission에 `websearch_*: "allow"`가, 다른 MCP는 `deny`로 설정됨

#### Scenario: Skill permissions generated during registration
- **WHEN** config 콜백이 실행되고 designer 에이전트에 `skills: ["agent-browser"]`가 설정되어 있음
- **THEN** designer 에이전트의 permission.skill에 `{"agent-browser": "allow"}`가 설정됨

#### Scenario: Fallback chains resolved during registration
- **WHEN** config 콜백이 실행되고 에이전트에 `_modelArray`가 있음
- **THEN** `_modelArray[].id`로 FallbackChain이 구성됨

#### Scenario: Agents without overrides register normally
- **WHEN** config 콜백이 실행되고 에이전트에 mcps/skills 오버라이드가 없음
- **THEN** 기존과 동일하게 에이전트가 등록됨 (회귀 없음)
