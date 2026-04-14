## 1. Schema Extension

- [ ] 1.1 `src/config/schema.ts` — `ModelEntry` 인터페이스 추가 (`id`, `variant?`)
- [ ] 1.2 `src/config/schema.ts` — `AgentOverrideConfig`에 `variant`, `skills`, `mcps`, `options`, `prompt`, `append_prompt` 필드 추가, `model` 필드를 `string | Array<string | ModelEntry>` 유니온으로 확장
- [ ] 1.3 `src/config/schema.ts` — `FallbackConfig` 인터페이스 추가 (`enabled?`, `chains?`)
- [ ] 1.4 `src/config/schema.ts` — `HarnessConfig`에 `fallback?: FallbackConfig` 필드 추가
- [ ] 1.5 `src/config/index.ts` — 새 타입 re-export 확인

## 2. Shared Utilities

- [ ] 2.1 `src/shared/utils.ts` — `parseList(items: string[], allAvailable: string[]): string[]` 함수 추가 (`*`/`!name` 글로브 문법)
- [ ] 2.2 `src/shared/utils.ts` — `parseList`을 배럴 `src/shared/index.ts`에 export 추가

## 3. AgentDefinition + applyOverrides Refactoring

- [ ] 3.1 `src/agents/agents.ts` — `AgentDefinition` 인터페이스에 `_modelArray?`, `variant?`, `options?` 필드 추가
- [ ] 3.2 `src/agents/agents.ts` — `applyOverrides` 함수 확장: model 배열 처리 (`_modelArray` 저장 + 첫 모델 설정), variant, options, prompt 파일 로드, append_prompt 파일 로드
- [ ] 3.3 `src/agents/agents.ts` — prompt/append_prompt 파일 로드 시 존재하지 않으면 logger.warn + 기본 프롬프트 유지
- [ ] 3.4 `src/agents/agents.ts` — `createAgents`에서 FallbackChain 구성: _modelArray에서 chain 추출 + fallback.chains 병합

## 4. Config Callback — Permission Auto-Generation

- [ ] 4.1 `src/index.ts` — config 콜백에서 `parseList()`로 에이전트별 mcps 배열 파싱 → `permission.{mcpName}_*` allow/deny 자동 설정
- [ ] 4.2 `src/index.ts` — config 콜백에서 `parseList()`로 에이전트별 skills 배열 파싱 → `permission.skill` allow/deny 자동 설정
- [ ] 4.3 `src/index.ts` — 기존 permission 필드 보존 (새 설정이 덮어쓰지 않고 병합)

## 5. Testing

- [ ] 5.1 `test/smoke-test.ts` — parseList() 단위 테스트 (6개 시나리오: *, !*, 명시적, *+!제외, 빈배열, unknown필터)
- [ ] 5.2 `test/smoke-test-step4.ts` — applyOverrides 확장 필드 테스트 (model 배열, variant, options, prompt, append_prompt)
- [ ] 5.3 `test/smoke-test-step4.ts` — MCP permission 자동 생성 테스트 (mcps 배열 → permission 검증)
- [ ] 5.4 `test/smoke-test-step4.ts` — Skills permission 자동 생성 테스트
- [ ] 5.5 기존 247개 테스트 회귀 확인 (21 + 50 + 121 + 24 + 22 + 9)
- [ ] 5.6 `npm run build` 타입 체크 통과 확인

## 6. Documentation + Sync

- [ ] 6.1 `docs/development-guide.md` 테스트 이력에 B1+B2 결과 추가
- [ ] 6.2 `AGENTS.md` 배포 준비 단계 상태 업데이트
- [ ] 6.3 로컬 플러그인 동기화 (`rsync -av --exclude='__tests__' src/ .opencode/plugins/harness/`)
- [ ] 6.4 `.opencode/harness.jsonc`에 새 필드 예시 추가 (skills, mcps, variant)
