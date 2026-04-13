## 1. 에이전트 프롬프트 파일 작성

- [ ] 1.1 `src/agents/prompts/orchestrator.md` 작성 — 최상위 에이전트 (판단/라우팅, Phase 관여 없음, oh-my-opencode-slim Orchestrator 패턴 + oh-my-openagent Sisyphus 위임 패턴 참고)
- [ ] 1.2 `src/agents/prompts/build.md` 작성 — Phase PM (Phase 1~5 관리, 서브에이전트 분배, 완료 시 리셋, 일반 대화 불가)
- [ ] 1.3 `src/agents/prompts/frontend.md` 작성 — 프론트엔드 구현 서브에이전트
- [ ] 1.4 `src/agents/prompts/backend.md` 작성 — 백엔드 구현 서브에이전트
- [ ] 1.5 `src/agents/prompts/tester.md` 작성 — QA 테스트 서브에이전트
- [ ] 1.6 `src/agents/prompts/reviewer.md` 작성 — 코드 리뷰 서브에이전트 (file_edit: deny)
- [ ] 1.7 `src/agents/prompts/cross-reviewer.md` 작성 — 다른 모델 리뷰 서브에이전트 (file_edit: deny, bash: deny, task: deny)

## 2. 에이전트 빌더 구현

- [ ] 2.1 `src/agents/` 디렉토리 생성
- [ ] 2.2 `src/agents/agents.ts`에 AgentDefinition 타입 정의 (oh-my-opencode-slim 패턴)
- [ ] 2.3 각 에이전트 createXxxAgent() 팩토리 함수 구현 (orchestrator, build, frontend, backend, tester, reviewer, cross-reviewer)
- [ ] 2.4 `createAgents()` 함수에서 전체 에이전트 AgentDefinition[] 반환
- [ ] 2.5 프롬프트 파일 로딩 함수 구현 (fs.readFileSync로 .md 파일 읽기)

## 3. config 콜백 구현 (자동 등록)

- [ ] 3.1 `src/index.ts`에 config 콜백 추가 (opencodeConfig.agent에 shallow merge)
- [ ] 3.2 config 콜백에서 default_agent를 "orchestrator"로 설정 (사용자 미설정 시만)
- [ ] 3.3 `export default { id, server() }` 패턴에 config 필드 추가

## 4. 권한 설정

- [ ] 4.1 reviewer 에이전트에 `permission: { file_edit: "deny" }` 설정
- [ ] 4.2 cross-reviewer 에이전트에 `permission: { file_edit: "deny", bash: "deny", task: "deny" }` 설정

## 5. 빌드 및 검증

- [ ] 5.1 `npm run build` 통과 확인
- [ ] 5.2 각 에이전트 프롬프트가 역할에 맞는 지침 포함 확인 (리뷰)
- [ ] 5.3 배포 동기화 — `.opencode/plugins/harness/`에 빌드 결과 복사
