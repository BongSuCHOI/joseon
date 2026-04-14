## ADDED Requirements

### Requirement: parseList utility parses glob-style allow/deny lists
`src/shared/utils.ts`의 `parseList(items, allAvailable)` 함수는 `*`/`!name` 글로브 문법으로 문자열 배열을 파싱하여 허용된 항목 목록을 반환한다.

#### Scenario: All items allowed with star
- **WHEN** `parseList(["*"], ["websearch", "context7", "grep_app"])`를 호출함
- **THEN** `["websearch", "context7", "grep_app"]`이 반환됨

#### Scenario: All items denied with bang-star
- **WHEN** `parseList(["!", "*"], ["websearch", "context7"])`를 호출함
- **THEN** 빈 배열 `[]`이 반환됨

#### Scenario: Explicit allow list
- **WHEN** `parseList(["websearch", "context7"], ["websearch", "context7", "grep_app"])`를 호출함
- **THEN** `["websearch", "context7"]`이 반환됨

#### Scenario: Star with exclusions
- **WHEN** `parseList(["*", "!grep_app"], ["websearch", "context7", "grep_app"])`를 호출함
- **THEN** `["websearch", "context7"]`이 반환됨

#### Scenario: Empty items returns empty
- **WHEN** `parseList([], ["websearch"])`를 호출함
- **THEN** 빈 배열 `[]`이 반환됨

#### Scenario: Unknown items filtered out
- **WHEN** `parseList(["websearch", "nonexistent"], ["websearch", "context7"])`를 호출함
- **THEN** `["websearch"]`만 반환됨 (allAvailable에 없는 항목은 제외)

### Requirement: MCP permissions auto-generated from agent mcps config
config 콜백에서 에이전트의 `mcps` 배열을 `parseList()`로 파싱하여, 각 MCP별 `permission.{mcpName}_*`을 `allow`/`deny`로 자동 설정한다.

#### Scenario: Agent with specific MCPs allowed
- **WHEN** 에이전트 설정에 `mcps: ["websearch", "context7"]`이 있고, 사용 가능한 MCP가 websearch, context7, grep_app임
- **THEN** 해당 에이전트의 permission에 `websearch_*: "allow"`, `context7_*: "allow"`, `grep_app_*: "deny"`가 설정됨

#### Scenario: Agent with all MCPs via star
- **WHEN** 에이전트 설정에 `mcps: ["*"]`이 있음
- **THEN** 모든 MCP 툴에 대해 `{mcpName}_*: "allow"`가 설정됨

#### Scenario: Agent with no MCPs
- **WHEN** 에이전트 설정에 `mcps: []`가 있거나 mcps 필드가 없음
- **THEN** MCP 관련 permission이 설정되지 않음 (기본 동작)

### Requirement: Skill permissions auto-generated from agent skills config
config 콜백에서 에이전트의 `skills` 배열을 `parseList()`로 파싱하여, `permission.skill` 객체를 자동 설정한다.

#### Scenario: Agent with specific skills allowed
- **WHEN** 에이전트 설정에 `skills: ["agent-browser"]`이 있고, 사용 가능한 스킬이 agent-browser, simplify임
- **THEN** 해당 에이전트의 permission.skill에 `{"agent-browser": "allow", "simplify": "deny"}`가 설정됨

#### Scenario: Agent with all skills via star
- **WHEN** 에이전트 설정에 `skills: ["*"]`이 있음
- **THEN** 모든 스킬에 대해 `permission.skill.{name}: "allow"`가 설정됨

#### Scenario: Agent with no skills
- **WHEN** 에이전트 설정에 `skills: []`가 있거나 skills 필드가 없음
- **THEN** skill permission이 설정되지 않음 (기본 동작)
