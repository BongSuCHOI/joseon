## Context

현재 `harness.jsonc`에서 에이전트별 model, skills, mcps, variant, options, prompt를 선언적으로 제어할 수 있다. 하지만 **도구 접근 거부(deny_tools)**만 config-driven이 아니다.

현재 상태:
- `agents.ts`에서 reviewer/advisor에 `permission: { file_edit: 'deny' }` 하드코딩
- 다른 읽기 전용 에이전트(designer, explorer, librarian)에도 동일한 제어가 필요하지만 미적용
- `harness.jsonc`에 `deny_tools`를 선언할 수 없음

기존 패턴 (B1+B2에서 이미 구현):
- `buildMcpPermissions()`: `mcps[]` → `permission.{mcp}_*: "allow"/"deny"`
- `buildSkillPermissions()`: `skills[]` → `permission.skill: "allow"/"deny"`
- 위 두 함수와 동일한 패턴으로 `buildToolPermissions()`을 추가하면 자연스럽게 통합

## Goals / Non-Goals

**Goals:**
- `harness.jsonc`에서 에이전트별 도구 접근을 선언적으로 제어
- 기존 reviewer/advisor의 하드코딩된 permission을 config-driven으로 이관
- README에 권장 모델 매핑과 MCP 설정 가이드 추가
- AGENTS.md 상태 업데이트

**Non-Goals:**
- enforcer에서 에이전트 ID 기반 도구 차단 (OpenCode permission 시스템이 이미 처리)
- 모델 자동 감지/라우팅 코드 구현 (문서로 충분)
- MCP 자동 등록 (OpenCode 아키텍처 제약으로 불가)
- `tool.execute.before` 훅 수정

## Decisions

### D1: config 콜백에서 permission만 설정 (enforcer 수정 없음)

OpenCode의 permission 시스템이 `{ toolName: "deny" }` 형태를 이미 지원한다. config 콜백에서 permission을 세팅하면 OpenCode가 도구 실행 전에 알아서 차단한다. enforcer에서 이중 체크할 필요 없음.

### D2: `deny_tools` 명명 — 긍정 리스트(skills, mcps)와의 일관성

skills/mcps는 "허용할 것"을 나열하는 방식(`skills: ["*"]`, `mcps: ["context7"]`). 도구도 동일하게 `deny_tools` (거부할 것을 나열)로 명명하면 직관적. omOs의 `createAgentToolRestrictions(["write", "edit"])` 패턴과 동일.

### D3: 기존 하드코딩 permission 유지 + config 오버라이드

`agents.ts`에서 reviewer/advisor에 `{ file_edit: 'deny' }`를 기본값으로 유지. `harness.jsonc`에 `deny_tools`가 있으면 config 콜백에서 추가 차단. 두 계층이 병합되어 최종 permission 구성.

### D4: README는 프로젝트 수준에서 작성

이 프로젝트는 플러그인이므로 README.md는 "설치 + 설정 가이드" 역할. 권장 모델 테이블, 필수/권장 MCP 서버 목록, harness.jsonc 전체 예시를 포함.

## Risks / Trade-offs

| 위험 | 완화 |
|------|------|
| OpenCode permission 시스템이 특정 도구명을 인식하지 않을 수 있음 | reviewer/advisor의 `file_edit`은 이미 동작 중. 새 도구명은 OpenCode 문서 기반으로 검증 |
| 사용자가 deny_tools에 없는 도구명을 적을 수 있음 | warning 로그 출력. 잘못된 도구명은 무시 (parseList와 동일 패턴) |
| README 업데이트가 구현과 동기화되지 않을 수 있음 | tasks.md에 README 업데이트를 필수 체크리스트로 포함 |
