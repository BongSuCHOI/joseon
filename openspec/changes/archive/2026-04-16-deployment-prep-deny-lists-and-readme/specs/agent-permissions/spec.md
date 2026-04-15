## MODIFIED Requirements

### Requirement: Agent auto-registration via config callback
플러그인 진입점 `src/index.ts`의 `config` 콜백은 에이전트를 등록할 때, 에이전트별 MCP/Skills/Tool deny permission을 자동으로 생성한다.

#### Scenario: Tool deny permissions generated during registration
- **WHEN** config 콜백이 실행되고 reviewer 에이전트에 `deny_tools: ["write", "edit", "bash"]`가 설정되어 있음
- **THEN** reviewer 에이전트의 permission에 `write: "deny"`, `edit: "deny"`, `bash: "deny"`가 설정됨

#### Scenario: Tool deny merged with existing MCP/Skills permissions
- **WHEN** config 콜백이 실행되고 에이전트에 mcps, skills, deny_tools 모두 설정되어 있음
- **THEN** 세 permission 소스가 모두 병합되어 최종 permission이 구성됨

#### Scenario: Agents without deny_tools register normally
- **WHEN** config 콜백이 실행되고 에이전트에 deny_tools 오버라이드가 없음
- **THEN** 기존과 동일하게 에이전트가 등록됨 (회귀 없음)
