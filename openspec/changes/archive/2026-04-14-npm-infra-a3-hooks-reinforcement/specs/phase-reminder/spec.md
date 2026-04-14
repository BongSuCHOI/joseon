## ADDED Requirements

### Requirement: Phase workflow reminder for builder agent
`src/hooks/phase-reminder.ts`는 `experimental.chat.messages.transform` 훅에서 builder 에이전트의 메시지에 5-Phase 워크플로우 규칙 리마인더를 주입한다. UI에는 표시되지 않고 API 전송 직전에만 삽입된다.

#### Scenario: Reminder injected for builder agent
- **WHEN** builder 에이전트의 메시지가 API로 전송되기 직전
- **THEN** 메시지에 "Understand → Build path → Execute → Verify" 워크플로우 리마인더가 주입됨

#### Scenario: Non-builder agents get no reminder
- **WHEN** builder가 아닌 에이전트(orchestrator, frontend 등)의 메시지가 전송됨
- **THEN** 리마인더가 주입되지 않음
