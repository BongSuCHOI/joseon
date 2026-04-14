## ADDED Requirements

### Requirement: Post-file-tool delegation nudge
`src/hooks/post-file-tool-nudge.ts`는 write, edit, patch 도구 실행 후 orchestrator 에이전트에게 위임 넛지를 주입한다. 세션별로 한 번만 주입하여 넛지 피로도를 방지한다.

#### Scenario: Nudge after file write
- **WHEN** orchestrator 에이전트가 write, edit, 또는 patch 도구를 실행함
- **THEN** `experimental.chat.system.transform`을 통해 "직접 구현하지 말고 서브에이전트에게 위임하라"는 넛지가 주입됨

#### Scenario: Nudge only once per session
- **WHEN** 같은 세션에서 여러 번 file write 도구가 실행됨
- **THEN** 넛지는 첫 번째 실행 시에만 주입됨 (중복 주입 방지)

#### Scenario: Non-orchestrator agent ignored
- **WHEN** orchestrator가 아닌 에이전트가 file write 도구를 실행함
- **THEN** 넛지가 주입되지 않음

### Requirement: Post-read delegation nudge
`src/hooks/post-read-nudge.ts`는 read 도구 실행 후 orchestrator 에이전트에게 위임 넛지를 주입한다.

#### Scenario: Nudge after file read
- **WHEN** orchestrator 에이전트가 read 도구를 실행함
- **THEN** `tool.execute.after`에서 출력에 위임 리마인더가 append됨

#### Scenario: Non-orchestrator agent ignored
- **WHEN** orchestrator가 아닌 에이전트가 read 도구를 실행함
- **THEN** 넛지가 주입되지 않음
