## Tasks

### Phase 1: Shared Infrastructure

- [x] **1.1** `src/shared/utils.ts`에 `rotateHistoryIfNeeded()` 함수 추가
  - `history.jsonl` append 전 파일 크기 체크 (1MB = 1048576 bytes)
  - 초과 시 `history-{YYYYMMDD-HHmmss}.jsonl`로 rename 후 새 파일 생성
  - spec: `openspec/changes/harness-step3-bridge/specs/harness-shared-infra/spec.md`

- [x] **1.2** `src/shared/index.ts`에 `rotateHistoryIfNeeded` re-export 추가

### Phase 2: Improver 확장 — .opencode/rules/ 병행

- [x] **2.1** `src/harness/improver.ts`에 `syncRulesMarkdown()` 함수 추가
  - `.opencode/rules/harness-soft-rules.md` 갱신 (SOFT 규칙 목록)
  - `.opencode/rules/harness-hard-rules.md` 갱신 (HARD 규칙 목록)
  - 파일 없으면 생성, `# Harness Rules (auto-generated)` 헤더 포함
  - spec: improver spec "SOFT rule created updates markdown"

- [x] **2.2** `signalToRule()`에서 규칙 생성 후 `syncRulesMarkdown()` 호출

- [x] **2.3** `promoteRules()`에서 승격 후 `syncRulesMarkdown()` 호출

### Phase 3: Improver 확장 — Memory Index/Search

- [x] **3.1** `src/harness/improver.ts`에 `indexSessionFacts()` 함수 추가
  - session.idle에서 세션 JSONL 읽기
  - 키워드 패턴 추출 (decision:, NEVER DO:, ALWAYS:, MUST:, constraint:, FIXME: 등)
  - `memory/facts/{id}.json`에 저장 (keywords, content, source_session, created_at)
  - spec: memory spec "Decision keyword extracted and stored as fact"

- [x] **3.2** `src/harness/improver.ts`에 `searchFacts()` 함수 추가
  - `memory/facts/`에서 키워드 매칭으로 관련 fact 검색
  - 최대 10개 제한

- [x] **3.3** compacting 훅(`buildCompactionContext`)에 fact 검색 결과 주입 추가
  - 기존 scaffold + HARD + SOFT 주입 후 memory 섹션 추가
  - `[HARNESS MEMORY — past decisions]` 헤더와 함께
  - spec: memory spec "Relevant fact injected during compacting"

- [x] **3.4** session.idle 핸들러에 `indexSessionFacts()` 호출 추가

- [x] **3.5** `ensureHarnessDirs()`에 `memory/facts/` 디렉토리 추가

### Phase 4: Improver 확장 — fix: 커밋 파싱 고도화

- [x] **4.1** `detectFixCommits()`에서 git log 포맷 변경
  - 기존: `--format="%H|||%s|||" --name-only`
  - 변경: `--format="COMMIT_START%n%H%n%s" --name-only`
  - `COMMIT_START` delimiter로 명확하게 블록 분리
  - 파일 목록을 첫 번째 non-empty line에서 추출
  - spec: improver spec "fix: commit with changed files correctly parsed"

### Phase 5: history 로테이션 연동

- [x] **5.1** `improver.ts`의 `appendHistory()`에서 `rotateHistoryIfNeeded()` 호출하도록 수정

### Phase 6: 빌드 및 검증

- [x] **6.1** `npm run build` 성공 확인

- [x] **6.2** 배포 동기화 — `.opencode/plugins/harness/`에 빌드 결과 복사

- [x] **6.3** 실동작 테스트 (tmux)
  - [x] .opencode/rules/ 마크다운 자동 생성/갱신 확인
  - [x] Memory Index: 세션에서 키워드 추출 → facts/ 저장 확인 (스모크 25/25 통과)
  - [x] Memory Search: compacting 시 fact 주입 확인
  - [x] fix: 커밋 파싱: source_file 정상 추출 확인 (COMMIT_START delimiter)
  - [x] history.jsonl 로테이션 동작 확인

### Phase 7: 문서 업데이트

- [x] **7.1** 전체 md 파일 검색 후 업데이트 필요 항목 반영
  - AGENTS.md: Step 3 상태 "✅ 완료" 업데이트
  - README.md: Step 3 상태 + Memory Index/Search + 런타임 구조 업데이트
  - development-guide.md: Step 3 테스트 결과 10개 추가
