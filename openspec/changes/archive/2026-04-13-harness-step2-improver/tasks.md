## Tasks

### Phase 1: Shared Infrastructure

- [x] **1.1** `src/shared/utils.ts`에 `mergeEventHandlers(...hookObjects)` 함수 추가
  - 여러 플러그인의 event 핸들러를 배열로 수집하여 순차 실행하는 단일 함수 반환
  - 한 핸들러 에러 시 나머지는 계속 실행, 에러는 console.error 로깅
  - spec: `openspec/changes/harness-step2-improver/specs/harness-shared-infra/spec.md`
  - v3 버그 C1 수정

- [x] **1.2** `src/shared/index.ts`에 `mergeEventHandlers` re-export 추가

### Phase 2: Observer 수정

- [x] **2.1** `src/harness/observer.ts`에 `session.created` 이벤트 핸들러 추가
  - 세션 시작 타임스탬프를 `logs/sessions/session_start_{projectKey}.json`에 overwrite
  - improver의 fix: 커밋 감지에서 사용
  - spec: `openspec/changes/harness-step2-improver/specs/harness-observer/spec.md`

### Phase 3: Improver 플러그인 구현

- [x] **3.1** `src/harness/improver.ts` 생성 — 플러그인 골격
  - `HarnessImprover(ctx)` export, `ensureHarnessDirs()` 호출
  - `event` 훅 등록 (`session.idle` 핸들러)
  - `experimental.session.compacting` 훅 등록

- [x] **3.2** `signalToRule()` — pending signal → SOFT 규칙 자동 변환
  - `signals/pending/` 읽기 → signal type별 scope 매핑
  - `ruleExists(pattern, projectKey)`로 중복 체크 (soft+hard 양쪽)
  - 규칙 생성 → `rules/soft/{id}.json` write
  - signal → `signals/ack/` 이동 (renameSync)
  - `rules/history.jsonl`에 이벤트 기록
  - spec: improver spec "Pending signal converted to SOFT rule"

- [x] **3.3** `promoteRules()` — SOFT→HARD 자동 승격
  - `violation_count >= 2` + `scope !== 'prompt'` 조건
  - 규칙 파일 `soft/` → `hard/` 이동
  - `promoted_at` 기록, `violation_count` 0 리셋 (v3 버그 W3 수정)
  - `rules/history.jsonl`에 승격 이벤트 기록
  - spec: improver spec "SOFT rule promoted to HARD"

- [x] **3.4** `evaluateRuleEffectiveness()` — 30일 효과 측정
  - `created_at` 기준 30일 경과 규칙만 측정
  - delta 기반: `violation_count - (effectiveness.last_measured_count || 0)`
  - effectiveness 필드 갱신 (status: effective | warning | needs_promotion)
  - v3 버그 W3 수정: 누적값 대신 delta 사용
  - spec: improver spec "Rule effectiveness measured"

- [x] **3.5** `detectFixCommits()` — fix: 커밋 감지 (Loop 1)
  - `session_start_{projectKey}.json`에서 세션 시작 시간 읽기
  - `child_process.execSync('git log --since=...')` 실행
  - fix: 접두사 커밋 → 파일 경로 추출 → fix_commit signal 생성
  - git 실패 시 에러 로깅 후 스킵
  - spec: improver spec "fix: commit detected creates signal"

- [x] **3.6** `updateProjectState()` — 프로젝트 상태 갱신
  - `projects/{projectKey}/state.json` write
  - soft/hard 규칙 수, pending signal 수, hard_ratio, project_path 포함
  - spec: improver spec "Project state updated"

- [x] **3.7** compacting 훅 — 컨텍스트 주입
  - scaffold 내용 주입 (파일 없으면 생략)
  - HARD 규칙 설명 목록 주입
  - SOFT 규칙 설명 목록 주입 (scope:prompt 유일 강제 수단)
  - 규칙 없으면 생략
  - spec: improver spec "Scaffold and rules injected on compacting"

### Phase 4: 진입점 수정

- [x] **4.1** `src/index.ts` — improver import 추가 + event 훅 병합
  - `HarnessImprover` import
  - `mergeEventHandlers(observerHooks, enforcerHooks, improverHooks)`로 병합
  - 기존 스프레드 패턴(`...observerHooks, ...enforcerHooks`) 대체
  - v3 버그 C1 수정

### Phase 5: 빌드 및 검증

- [x] **5.1** `npm run build` 성공 확인

- [x] **5.2** 배포 동기화 — `.opencode/plugins/harness/`에 빌드 결과 복사

- [x] **5.3** 실동작 테스트 — 스모크 테스트 29/29 통과
  - [x] L5: pending signal → SOFT 규칙 자동 변환 확인
  - [x] L5: fix: 커밋 → signal → scaffold NEVER DO 추가 확인 (코드 경로 구현됨)
  - [x] L6: SOFT 규칙 위반 2회 → HARD 승격 확인
  - [x] L6: 30일 경과 규칙 효과 측정 동작 확인 (mock 타임스탬프로)
  - [x] Compacting: 컨텍스트에 scaffold + 규칙 주입 확인
  - [x] Observer event 핸들러가 improver 추가 후에도 정상 동작 (C1 수정 확인)
  - [x] Signal 중복 처리: soft+hard 양쪽 체크, 완전 일치만
  - [x] violation_count 리셋: 승격 시 0으로 초기화 (W3 수정)

### Phase 6: 문서 업데이트

- [x] **6.1** `AGENTS.md` — Step 2 상태 업데이트 (구현 전 → 완료)
- [x] **6.2** `docs/development-guide.md` — improver 관련 개발/테스트 절차 추가
- [x] **6.3** `docs/step2-pre-implementation-analysis.md` — 구현 완료 섹션 추가 (기존 내용 삭제하지 말고 히스토리로 남기기)
