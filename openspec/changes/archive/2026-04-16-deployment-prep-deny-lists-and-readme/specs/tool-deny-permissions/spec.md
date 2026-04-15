## ADDED Requirements

### Requirement: deny_tools field in AgentOverrideConfig
`src/config/schema.ts`의 `AgentOverrideConfig`에 `deny_tools?: string[]` 필드를 추가한다. 이 필드는 에이전트가 사용할 수 없는 도구 이름 목록을 정의한다.

#### Scenario: deny_tools with specific tools
- **WHEN** config에 `{"agents": {"reviewer": {"deny_tools": ["write", "edit", "bash"]}}}`가 설정됨
- **THEN** `AgentOverrideConfig` 타입이 `deny_tools: ["write", "edit", "bash"]`을 허용함

#### Scenario: deny_tools omitted
- **WHEN** config에 `deny_tools` 필드가 없음
- **THEN** 해당 에이전트에 도구 거부가 적용되지 않음 (기본 동작)

### Requirement: buildToolPermissions converts deny_tools to permission map
`src/index.ts`의 `buildToolPermissions(denyTools, ...)` 함수는 도구 이름 배열을 OpenCode permission 형식(`{ toolName: "deny" }`)으로 변환한다.

#### Scenario: Specific tools denied
- **WHEN** `buildToolPermissions(["write", "edit"])`를 호출함
- **THEN** `{ write: "deny", edit: "deny" }`이 반환됨

#### Scenario: Empty deny list
- **WHEN** `buildToolPermissions([])`를 호출함
- **THEN** 빈 객체 `{}`이 반환됨

#### Scenario: Undefined deny list
- **WHEN** `buildToolPermissions(undefined)`를 호출함
- **THEN** 빈 객체 `{}`이 반환됨

### Requirement: Tool permissions merged into agent permission in config callback
config 콜백에서 `buildToolPermissions()`의 결과를 에이전트 기본 permission과 병합한다. 기존 permission을 덮어쓰지 않고 누락된 키만 추가한다.

#### Scenario: Agent with deny_tools and existing permission
- **WHEN** reviewer 에이전트에 기본 permission `{ file_edit: "deny" }`이 있고, config에 `deny_tools: ["bash"]`가 설정됨
- **THEN** 최종 permission이 `{ file_edit: "deny", bash: "deny" }`이 됨 (병합, 덮어쓰기 아님)

#### Scenario: Agent with deny_tools and no existing permission
- **WHEN** designer 에이전트에 기본 permission이 없고, config에 `deny_tools: ["write", "edit", "bash"]`가 설정됨
- **THEN** permission이 `{ write: "deny", edit: "deny", bash: "deny" }`가 됨

#### Scenario: deny_tools not configured for agent
- **WHEN** 에이전트에 `deny_tools`가 설정되지 않음
- **THEN** 기존과 동일하게 permission이 유지됨 (회귀 없음)
