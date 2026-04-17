## ADDED Requirements

### Requirement: Workflow reminder for orchestrator agent
`src/hooks/phase-reminder.ts`는 `experimental.chat.messages.transform` 훅에서 orchestrator 에이전트의 메시지에 workflow reminder를 주입한다. UI에는 표시되지 않고 API 전송 직전에만 삽입된다.

#### Scenario: Reminder injected for orchestrator agent
- **WHEN** orchestrator 에이전트의 메시지가 API로 전송되기 직전
- **THEN** 메시지에 "Understand → choose direct handling or specialist delegation → Execute → Verify" 워크플로우 리마인더가 주입됨

#### Scenario: Non-orchestrator agents get no reminder
- **WHEN** orchestrator가 아닌 에이전트(frontend, backend 등)의 메시지가 전송됨
- **THEN** 리마인더가 주입되지 않음
