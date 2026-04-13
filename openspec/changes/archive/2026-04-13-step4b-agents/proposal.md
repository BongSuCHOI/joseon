## Why

오케스트레이션 시스템의 핵심인 에이전트 계층을 정의한다. 최상위 Orchestrator(판단/라우팅), Phase PM @build(Phase 관리/구현), 그리고 서브에이전트(frontend, backend, tester, reviewer, cross-reviewer)의 역할, 권한, 프롬프트를 확정하고 구현한다.

## What Changes

- **에이전트 빌더:** `src/agents/agents.ts`에서 `createXxxAgent()` 팩토리 함수로 각 에이전트 정의. oh-my-opencode-slim/oh-my-openagent의 패턴 참고
- **에이전트 프롬프트:** `src/agents/prompts/`에 7개 마크다운 파일 (orchestrator, build, frontend, backend, tester, reviewer, cross-reviewer)
- **자동 등록:** 플러그인 `config` 콜백에서 `opencodeConfig.agent`에 에이전트 병합 + `default_agent: "orchestrator"` 설정
- **권한 설정:** 각 에이전트에 적절한 permission 설정 (reviewer: file_edit deny, cross-reviewer: file_edit + bash deny)

## Capabilities

### New Capabilities
- `agent-definitions`: 에이전트 팩토리 함수, 프롬프트 로딩, config 콜백 통한 자동 등록
- `agent-prompts`: 7개 에이전트별 시스템 프롬프트 (역할, 제약, 위임 규칙)

### Modified Capabilities
- `harness-shared-infra`: `src/index.ts`에 config 콜백 추가하여 에이전트 자동 등록

## Impact

- `src/agents/agents.ts`: 신규 파일 (~150줄)
- `src/agents/prompts/`: 7개 신규 마크다운 파일
- `src/index.ts`: config 콜백 추가
- opencode.json: 수정 없음 (플러그인에서 자동 등록)
