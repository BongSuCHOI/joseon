## MODIFIED Requirements

### Requirement: Agent creation uses config overrides
`src/agents/agents.ts`의 각 `create*Agent()` 함수는 하드코딩된 값 대신 config의 `AgentOverrideConfig`를 참조하여 model, temperature, hidden을 설정한다. Config에 값이 없으면 기존 하드코딩값을 기본값으로 사용한다.

#### Scenario: Agent with config override
- **WHEN** config에 `{"agents": {"designer": {"temperature": 0.9}}}`가 설정됨
- **THEN** `createDesignerAgent()`가 반환하는 에이전트의 temperature가 0.9임

#### Scenario: Agent without config override uses default
- **WHEN** config에 designer 관련 설정이 없음
- **THEN** `createDesignerAgent()`가 기존 하드코딩값인 temperature 0.7을 사용함
