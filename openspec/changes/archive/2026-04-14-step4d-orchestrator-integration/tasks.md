## 1. Orchestrator 플러그인 메인

- [x] 1.1 `src/orchestrator/orchestrator.ts`에 `HarnessOrchestrator = async (ctx) => {}` 함수 정의
- [x] 1.2 `event` 훅: `session.idle`에서 미완료 Phase 검사 및 요약 로깅
- [x] 1.3 `event` 훅: `session.idle`에서 PID lock 파일 정리 (기존 observer 로직과 병합)
- [x] 1.4 signal에 `agent_id` 주입 로직 — 에이전트 컨텍스트에서 signal 생성 시 agent_id 필드 추가

## 2. 진입점 통합

- [x] 2.1 `src/index.ts`에 `HarnessOrchestrator` import 추가
- [x] 2.2 `mergeEventHandlers`에 Orchestrator hooks 포함 (observer + enforcer + improver + orchestrator 순서)
- [x] 2.3 `export default { id, server() }` 반환 객체에 config 콜백 포함 (Change B에서 추가한 에이전트 등록)

## 3. 빌드 및 검증

- [x] 3.1 `npm run build` 통과 확인
- [x] 3.2 기존 Step 1/3 스모크 테스트 여전히 통과 확인
- [x] 3.3 배포 동기화 — `.opencode/plugins/harness/`에 빌드 결과 복사 (orchestrator/, agents/ 디렉토리 포함)
