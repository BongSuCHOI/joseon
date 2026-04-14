## Context

omOs의 `SubagentDepthTracker`는 ~50줄의 심플한 클래스로, `session.created` 이벤트에서 부모-자식 관계를 추적하여 깊이가 max를 초과하면 spawn을 차단한다.

**깊이 레벨:**
- Depth 0 = 루트 세션 (사용자의 메인 대화)
- Depth 1 = 루트가 생성한 에이전트 (예: builder, explorer)
- Depth 2 = depth-1 에이전트가 생성한 에이전트
- Depth 3 = depth-2 에이전트가 생성한 에이전트 (max)

**현재 우리 아키텍처에서의 활용:**
- Orchestrator(depth 0) → builder(depth 1) → frontend(depth 2)
- error-recovery의 cross_model_rescue에서 깊이 체크 필요
- builder는 여러 서브에이전트를 병렬 호출하지만 각각이 depth 2이므로 현재 구조에서는 문제 없음

**제약:**
- 런타임 의존성 0 유지
- observer의 `session.created` 이벤트 훅에 통합
- 파일 시스템이 아닌 메모리 기반 추적 (세션 종료 시 소멸)

## Goals / Non-Goals

**Goals:**
- SubagentDepthTracker 클래스 구현 (메모리 기반, Map 사용)
- Observer의 session.created에서 깊이 추적
- max depth 초과 시 로깅 + 차단 처리
- 설정 가능한 max_subagent_depth

**Non-Goals:**
- 파일 기반 영속화 (불필요, 메모리로 충분)
- BackgroundTaskManager (omOs의 백그라운드 작업 관리 — 우리는 동기식 서브에이전트만 사용)
- tmux 세션 관리 (omOs 전용)

## Decisions

### D1: 메모리 기반 Map 사용

**결정:** `Map<string, number>`로 세션 ID → 깊이 매핑. 파일 시스템 사용 안 함.

**근거:** 깊이 추적은 세션 수명 동안만 필요. 세션 종료 시 자동 정리. omOs도 동일한 방식.

### D2: Observer 통합 방식

**결정:** Observer의 `session.created` 이벤트 핸들러에서 SubagentDepthTracker를 호출.

**근거:** observer가 이미 모든 세션 이벤트를 수신. 별도 플러그인 없이 기존 훅에 통합.

### D3: 차단 방식

**결정:** `registerChild()`가 `false`를 반환하면, observer가 logger.warn으로 경고만 하고 에이전트 spawn 자체는 OpenCode 코어가 처리. 우리는 "차단"이 아닌 "경고 + 로깅" 수준.

**근거:** omOs는 백그라운드 태스크 매니저에서 사전 차단이 가능하지만, 우리는 동기식 서브에이전트이므로 OpenCode 코어의 spawn을 직접 막을 수 없음. 대신 깊이 초과를 감지하고 로깅하여, 향후 `tool.execute.before`에서 차단으로 확장 가능.

## Risks / Trade-offs

- **[메모리 누수]** → session.deleted 이벤트에서 반드시 정리. 완화: cleanup() 메서드 + observer의 session.deleted에서 호출
- **[실제 차단 불가]** → 현재는 로깅만. 완화: 향후 tool.execute.before에서 차단 가능. 현재는 감지+경고 수준으로 충분 (우리 구조에서 depth 3 초과는 거의 발생 안 함)
- **[부모 세션 식별]** → OpenCode의 `subagent.session.created` 이벤트에 부모 정보가 있는지 확인 필요. 없으면 대안 필요
