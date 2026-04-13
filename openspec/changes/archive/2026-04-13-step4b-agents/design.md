## Context

AGENTS.md에서 확정된 에이전트 아키텍처:
- Orchestrator (최상위 primary): 판단/라우팅, Phase 관여 없음
- @build (subagent): Phase PM, Orchestrator가 위임 시에만 활성
- frontend, backend, tester, reviewer, cross-reviewer: 서브에이전트

탐색에서 파악한 참고 자료:
- oh-my-opencode-slim: Hub-and-Spoke, config 콜백으로 자동 등록, shallow merge
- oh-my-openagent: 6-Section Delegation, Phase 0 Intent Gate, Dynamic Prompt Builder
- OpenCode: mode(primary/subagent/all), Task 툴로 위임, permission.task로 권한 제어

## Goals / Non-Goals

**Goals:**
- 각 에이전트의 역할, 권한, 프롬프트를 명확히 정의
- 플러그인 config 콜백에서 에이전트 자동 등록 (opencode.json 수정 불필요)
- 검증된 플러그인(oh-my-opencode-slim, oh-my-openagent)의 프롬프트 패턴을 우리 프로젝트에 맞게 적용

**Non-Goals:**
- 프롬프트의 완벽한 최적화 (실동작에서 미세조정)
- 에이전트 모델 설정 (사용자가 oh-my-opencode-slim.json에서 지정)
- Phase Manager 로직 (Change A에서 구현)

## Decisions

### D1: 에이전트 mode 분류

oh-my-opencode-slim 패턴과 동일:
- `orchestrator`: mode "primary" — 사용자가 tab으로 전환 가능, default_agent
- `build`: mode "subagent" — Orchestrator가 Task 툴로 호출
- `frontend`, `backend`, `tester`: mode "subagent" — @build가 Task 툴로 호출
- `reviewer`: mode "subagent" — @build가 호출, hidden: false
- `cross-reviewer`: mode "subagent" — @build가 호출, hidden: false

### D2: 프롬프트 작성 방침

oh-my-opencode-slim/oh-my-openagent의 프롬프트를 심층 분석하여:
- 판단 로직, 위임 패턴, 커뮤니케이션 방식은 참고
- Phase 관리 + 하네스 통제 지침은 우리 프로젝트 고유
- 실동작에서 미세조정

### D3: 권한 설정

| 에이전트 | file_edit | bash | task | question |
|----------|-----------|------|------|----------|
| orchestrator | allow | allow | allow | allow |
| build | allow | allow | allow | allow |
| frontend/backend | allow | allow | allow | allow |
| tester | allow | allow | allow | allow |
| reviewer | deny | allow | allow | allow |
| cross-reviewer | deny | deny | deny | allow |

### D4: 에이전트 등록 패턴

oh-my-opencode-slim의 config 콜백 패턴 채용:
1. `createAgents()`에서 AgentDefinition[] 생성
2. config 콜백에서 `opencodeConfig.agent`에 shallow merge
3. `default_agent`를 "orchestrator"로 설정 (사용자가 설정 안 한 경우만)

## Risks / Trade-offs

- [프롬프트 품질 초기 불안정] → 실동작에서 미세조정. Step 4-0에서 이미 분석 완료
- [에이전트 간 컨텍스트 전달] → Task 툴의 `<task_result>` 태그로 자동 처리
- [config 콜백 미문서화] → @opencode-ai/plugin 타입에 공식 존재, oh-my-opencode-slim이 프로덕션에서 사용 중
