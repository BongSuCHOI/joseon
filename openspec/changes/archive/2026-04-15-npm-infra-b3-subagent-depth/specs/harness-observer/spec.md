## MODIFIED Requirements

### Requirement: Observer records tool execution results
Observer의 이벤트 핸들러에 SubagentDepthTracker 통합 로직이 추가된다. 기존 도구 실행 로깅 동작은 변경되지 않는다.

#### Scenario: Subagent session created triggers depth tracking
- **WHEN** observer가 세션 생성 이벤트를 수신하고 SubagentDepthTracker가 주입됨
- **THEN** 해당 세션의 깊이가 추적됨

#### Scenario: Session deleted triggers depth cleanup
- **WHEN** observer가 세션 삭제 이벤트를 수신함
- **THEN** SubagentDepthTracker.cleanup()이 호출됨
