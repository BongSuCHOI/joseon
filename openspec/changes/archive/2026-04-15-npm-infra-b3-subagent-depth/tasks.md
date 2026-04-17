## 1. Core Implementation

- [x] 1.1 `src/orchestrator/subagent-depth.ts` — SubagentDepthTracker 클래스 생성 (`Map<string, number>` 기반, `registerChild`, `getDepth`, `cleanup`, `cleanupAll`, `maxDepth` getter)
- [x] 1.2 `src/orchestrator/subagent-depth.ts` — 생성자에서 config의 `max_subagent_depth` 읽기 (기본값 3)

## 2. Config Extension

- [x] 2.1 `src/config/schema.ts` — `HarnessSettings`에 `max_subagent_depth?: number` 필드 추가
- [x] 2.2 `src/config/schema.ts` — `DEFAULT_HARNESS_SETTINGS`에 `max_subagent_depth: 3` 추가

## 3. Observer Integration

- [x] 3.1 `src/harness/observer.ts` — SubagentDepthTracker 인스턴스 생성 (config에서 max depth 읽기)
- [x] 3.2 `src/harness/observer.ts` — `subagent.session.created` 이벤트에서 `registerChild()` 호출
- [x] 3.3 `src/harness/observer.ts` — `session.deleted` 이벤트에서 `cleanup()` 호출
- [x] 3.4 `src/harness/observer.ts` — max depth 초과 시 `logger.warn` 경고 출력

## 4. Testing

- [x] 4.1 `test/smoke-test-step4.ts` — SubagentDepthTracker 단위 테스트 (depth 0, 자식 등록, max 초과, cleanup, cleanupAll, 커스텀 max depth)
- [x] 4.2 기존 247개 테스트 회귀 확인
- [x] 4.3 `npm run build` 타입 체크 통과 확인

## 5. Documentation + Sync

- [x] 5.1 `docs/development-guide.md` 테스트 이력에 B3 결과 추가
- [x] 5.2 `AGENTS.md` 배포 준비 단계 상태 업데이트
- [ ] 5.3 로컬 플러그인 동기화
