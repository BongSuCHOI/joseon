## Why

AGENTS.md "🟡 배포 준비 단계"에 3개 항목(에이전트별 도구 deny 리스트, 모델 자동 감지/라우팅, MCP 설정 가이드)이 남아있다. explore 단계에서 파악한 결과:

- **에이전트별 도구 deny 리스트**: 코드 작업 필요. 현재 reviewer/advisor에 `permission: { file_edit: 'deny' }`만 하드코딩되어 있고, `harness.jsonc`에서 선언적으로 deny_tools를 지정할 수 없음
- **모델 자동 감지/라우팅**: 이미 `harness.jsonc`에 모든 에이전트 모델 예시가 있고, OpenCode 기본값 동작으로 충분. 문서(README)로 해결
- **MCP 설정 가이드**: 플러그인이 MCP를 직접 등록할 수 없는 OpenCode 아키텍처 제약. 사용자가 `opencode.json`에 수동 설정해야 하므로 문서(README)로 해결

## What Changes

- `AgentOverrideConfig`에 `deny_tools?: string[]` 필드 추가
- `src/index.ts` config 콜백에 `buildToolPermissions()` 추가 — deny_tools를 `permission.{toolName}: "deny"`로 자동 변환
- `README.md`에 "권장 모델 매핑" 및 "권장 MCP 서버" 섹션 추가
- 기존 reviewer/advisor의 하드코딩된 permission을 config-driven으로 전환
- `AGENTS.md`의 배포 준비 단계 상태 업데이트

## Capabilities

### New Capabilities
- `tool-deny-permissions`: 에이전트별 도구 접근 거부 리스트 — harness.jsonc의 `agents.{name}.deny_tools`를 config 콜백에서 permission으로 자동 변환

### Modified Capabilities
- `agent-permissions`: 기존 MCP/Skills permission 자동 생성에 tool deny permission 추가. `buildToolPermissions()`가 기존 `buildMcpPermissions()`/`buildSkillPermissions()`와 동일한 패턴으로 통합

## Impact

- `src/config/schema.ts` — AgentOverrideConfig 타입 확장
- `src/index.ts` — config 콜백에 buildToolPermissions() 추가 (~20줄)
- `src/agents/agents.ts` — reviewer/advisor 하드코딩 permission 제거 (config로 이관)
- `README.md` — 권장 모델/MCP 설정 섹션 추가
- `AGENTS.md` — 배포 준비 단계 상태 업데이트
- `.opencode/harness.jsonc` — reviewer/advisor에 deny_tools 예시 추가
