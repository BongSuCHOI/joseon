## MODIFIED Requirements

### Requirement: HarnessSettings defines harness tuning parameters
`HarnessSettings`에 `max_subagent_depth` 필드가 추가된다. 기본값은 3.

#### Scenario: Override max_subagent_depth
- **WHEN** config 파일에 `{"harness": {"max_subagent_depth": 5}}`가 설정됨
- **THEN** SubagentDepthTracker의 maxDepth가 5로 설정됨

#### Scenario: Default max_subagent_depth is 3
- **WHEN** config 파일에 max_subagent_depth가 없음
- **THEN** 기본값 3으로 동작함
