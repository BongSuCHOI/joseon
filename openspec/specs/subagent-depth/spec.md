## Requirements

### Requirement: SubagentDepthTracker tracks session spawn depth
`src/orchestrator/subagent-depth.ts`의 `SubagentDepthTracker` 클래스는 `Map<string, number>`로 세션 ID → 깊이를 추적한다. 루트 세션은 깊이 0, 자식은 부모 깊이 + 1.

#### Scenario: Root session has depth 0
- **WHEN** 추적되지 않은 세션 ID로 `getDepth(sessionId)`를 호출함
- **THEN** 0이 반환됨

#### Scenario: Child registered with parent depth + 1
- **WHEN** 부모 세션(depth 1)에서 `registerChild(parentId, childId)`를 호출함
- **THEN** 자식의 깊이는 2가 되고, `true`가 반환됨

#### Scenario: Max depth exceeded returns false
- **WHEN** 부모 세션이 max depth(3)이고 `registerChild(parentId, childId)`를 호출함
- **THEN** 자식이 생성되지 않고 `false`가 반환됨

#### Scenario: Cleanup removes session tracking
- **WHEN** `cleanup(sessionId)`를 호출함
- **THEN** 해당 세션 ID가 Map에서 제거됨

#### Scenario: CleanupAll removes all tracking
- **WHEN** `cleanupAll()`을 호출함
- **THEN** Map이 완전히 비워짐

### Requirement: Max depth is configurable
`SubagentDepthTracker` 생성자는 `maxDepth` 매개변수를 받는다. 기본값은 3.

#### Scenario: Default max depth is 3
- **WHEN** `new SubagentDepthTracker()`로 인스턴스를 생성함
- **THEN** `maxDepth` getter가 3을 반환함

#### Scenario: Custom max depth
- **WHEN** `new SubagentDepthTracker(5)`로 인스턴스를 생성함
- **THEN** `maxDepth` getter가 5를 반환함

### Requirement: Depth tracking integrates with observer events
Observer의 `session.created` 이벤트에서 SubagentDepthTracker를 호출하여 깊이를 추적한다.

#### Scenario: Subagent session registered
- **WHEN** `subagent.session.created` 이벤트가 발생하고 부모 세션 ID가 식별됨
- **THEN** `registerChild(parentSessionId, childSessionId)`가 호출됨

#### Scenario: Session deleted triggers cleanup
- **WHEN** `session.deleted` 이벤트가 발생함
- **THEN** `cleanup(sessionId)`가 호출됨

#### Scenario: Max depth exceeded logs warning
- **WHEN** `registerChild()`가 `false`를 반환함 (max depth 초과)
- **THEN** logger.warn으로 깊이 초과 경고가 출력됨
