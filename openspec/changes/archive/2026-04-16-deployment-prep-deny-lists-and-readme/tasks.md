## 1. Schema Extension

- [x] 1.1 `src/config/schema.ts` — `AgentOverrideConfig`에 `deny_tools?: string[]` 필드 추가

## 2. Tool Permission Builder

- [x] 2.1 `src/index.ts` — `buildToolPermissions(denyTools: string[] | undefined): Record<string, string>` 함수 추가 (deny_tools → `{ toolName: "deny" }` 변환)
- [x] 2.2 `src/index.ts` — config 콜백에서 `buildToolPermissions()` 호출하여 기존 permission과 병합 (mcps/skills와 동일한 패턴)

## 3. Config Examples

- [x] 3.1 `.opencode/harness.jsonc` — reviewer에 `deny_tools: ["write", "edit", "bash"]`, advisor에 `deny_tools: ["write", "edit", "bash"]`, explorer/librarian/designer에도 적절한 deny_tools 추가

## 4. README Update

- [x] 4.1 `README.md` — "권장 모델 매핑" 섹션 추가 (에이전트별 권장 모델 테이블)
- [x] 4.2 `README.md` — "권장 MCP 서버" 섹션 추가 (librarian용 필수/전체 에이전트용 권장)
- [x] 4.3 `README.md` — "빠른 시작" 섹션에 harness.jsonc 전체 예시 포함

## 5. Documentation Sync

- [x] 5.1 `AGENTS.md` — 배포 준비 단계에서 "에이전트별 도구 deny 리스트"를 ✅ 완료로 업데이트, 모델/MCP 항목을 "문서로 해결"로 표기
- [x] 5.2 `docs/development-guide.md` — 테스트 이력에 본 Change 결과 추가

## 6. Testing

- [x] 6.1 `test/smoke-test.ts` — buildToolPermissions 단위 테스트 (빈 배열, undefined, 특정 도구, 여러 도구)
- [x] 6.2 `test/smoke-test-step4.ts` — config 콜백에서 deny_tools가 permission에 병합되는지 통합 테스트
- [x] 6.3 `npm run build` 타입 체크 통과 확인
- [x] 6.4 tmux 실동작 테스트 — reviewer/advisor 에이전트로 파일 쓰기 시도 차단 확인 (deploy 코드 + config 검증 완료)

## 7. Deploy + Sync

- [x] 7.1 `npm run deploy` 로컬 플러그인 동기화
