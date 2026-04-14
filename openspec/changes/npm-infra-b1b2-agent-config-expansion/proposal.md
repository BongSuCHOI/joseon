## Why

현재 AgentOverrideConfig는 model, temperature, hidden 3개 필드만 지원한다. omOs(oh-my-opencode-slim)는 variant, skills, mcps, options, model 배열, 커스텀 프롬프트 오버라이드 등 훨씬 풍부한 에이전트 설정을 제공한다. npm 배포 전 사용자가 에이전트별로 MCP 접근 제어, 스킬 권한, 모델 fallback 체인, 프롬프트 커스터마이징을 설정할 수 있어야 한다.

## What Changes

- **AgentOverrideConfig 확장**: variant, skills, mcps, options, prompt, append_prompt 필드 추가. model 필드를 단일 문자열에서 배열(모델 체인)도 지원하도록 확장
- **parseList() 유틸리티**: `*`/`!name` 글로브 문법으로 skills, mcps 배열 파싱 (omOs 패턴 채택)
- **FallbackChain 인터페이스**: 에이전트별 model 배열 + fallback.chains 병합. 다중 모델 환경에서 rate limit 시 자동 전환 준비
- **MCP 접근 제어**: 에이전트별 mcps 설정 → `permission.{mcpName}_*` 자동 생성
- **Skills 접근 제어**: 에이전트별 skills 설정 → `permission.skill` 자동 생성
- **커스텀 프롬프트 오버라이드**: prompt(전체 교체), append_prompt(기존에 추가) 지원
- **agents.ts applyOverrides 리팩토링**: 확장된 필드를 모두 처리하도록 업데이트
- **config 콜백 확장**: index.ts에서 MCP permission 자동 생성 로직 추가

## Capabilities

### New Capabilities
- `agent-permissions`: 에이전트별 MCP/Skills 접근 제어 — parseList() 글로브 파싱 + permission 자동 생성
- `foreground-fallback`: 모델 FallbackChain 관리 — 에이전트별 model 배열 + fallback.chains 병합, rate limit 감지 인터페이스

### Modified Capabilities
- `config-system`: AgentOverrideConfig에 variant, skills, mcps, options, prompt, append_prompt, model 배열 추가. FallbackConfig 섹션 추가
- `agent-definitions`: applyOverrides 리팩토링 — 확장된 필드 처리, permission 자동 생성, 커스텀 프롬프트 로드
- `harness-shared-infra`: parseList() 유틸리티 추가 (shared/utils.ts)

## Impact

- `src/config/schema.ts` — AgentOverrideConfig 확장, FallbackConfig 인터페이스 추가
- `src/config/loader.ts` — 변경 없음 (기존 JSONC 로더로 충분)
- `src/agents/agents.ts` — AgentDefinition 확장, applyOverrides 리팩토링, createAgents 권한 처리
- `src/index.ts` — config 콜백에 MCP permission 자동 생성 로직 추가
- `src/shared/utils.ts` — parseList() 추가
- `test/smoke-test*.ts` — 새 필드 테스트 케이스 추가
- **런타임 의존성 추가 없음** (수동 검증 유지)
