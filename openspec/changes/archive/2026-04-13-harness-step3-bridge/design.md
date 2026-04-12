## Context

Step 2에서 observer + enforcer + improver 3개 플러그인으로 L1~L6 폐루프 하네스를 완성했다. 하지만 실동작 테스트에서 3가지 갭이 확인되었다:

1. **scope:prompt 규칙 노출 부족:** compacting 훅에서만 주입되어 짧은 세션에서는 규칙이 전혀 보이지 않음
2. **세션 간 기억 없음:** 매 세션이 독립적으로 시작. 이전 세션의 결정/제약이 회수되지 않음
3. **fix: 커밋 파싱 품질:** 실동작에서 `source_file`이 빈 문자열로 나옴

**현재 제약:**
- v3 6장(Step 3)은 "인터페이스 계약 정의"에 집중하지만, 형님과 논의 결과 이것은 불필요함(파일 구조가 이미 계약)
- 대신 v3 5.2.1의 "크로스세션 기억 하위 3단계"를 Step 3으로 올려서 구현
- 참고 문서 3개(5.2.1, 6장, orchestrator-evolution) 모두 완독. 교훈은 대부분 Step 4 관련

## Goals / Non-Goals

**Goals:**
- scope:prompt 규칙이 세션 시작부터 `.opencode/rules/`에 노출됨
- 세션 종료 시 JSONL에서 키워드 추출 → `memory/facts/`에 저장 (Index)
- compacting 훅에서 관련 fact를 키워드 검색 → 컨텍스트에 주입 (Search)
- history.jsonl이 무한 증식하지 않음 (로테이션)
- fix: 커밋의 source_file이 정확히 추출됨

**Non-Goals:**
- 기억 상위 4단계 (Extract, Consolidate, Relate, Recall) — 데이터 축적 후
- 인터페이스 계약 정의 — 파일 구조가 이미 계약
- signal에 agent_id 필드 — Step 4에서 서브에이전트 생길 때
- git push gate — Step 4에서 QA 증거 파일 개념 도입 시

## Decisions

### 1. .opencode/rules/ 갱신 — improver가 규칙 생성 시 마크다운도 동시 갱신

**선택:** improver의 `signalToRule()`에서 SOFT 규칙 JSON 생성 후 `.opencode/rules/harness-soft-rules.md`도 갱신. `promoteRules()`에서 HARD 승격 시에도 반영.

**이유:** OpenCode는 `.opencode/rules/`의 마크다운 파일을 세션 시작부터 자동으로 로드. 별도 훅 없이도 규칙이 노출됨.

**포맷:**
```markdown
# Harness Rules (auto-generated)
## SOFT Rules
- [SOFT|tool] 세션 에러 3회 반복: TypeError...
- [SOFT|prompt] 사용자 불만 감지: 왜이래, 또, 에러

## HARD Rules
- [HARD|tool] console.log 사용 금지
```

### 2. Index — 키워드 추출 방식

**선택:** 세션 JSONL에서 미리 정의된 키워드 패턴(결정, 선호, 제약 관련)을 정규식으로 추출. LLM 기반 추출은 상위 단계(Extract)에서.

**추출 대상:**
- `decision:` / `결정:` / `DECISION:` 접두사
- `NEVER DO:` / `ALWAYS:` / `MUST:` / `FORBIDDEN:` 패턴
- `constraint:` / `제약:` / `TODO:` / `FIXME:` 패턴

**저장 포맷:** `memory/facts/{id}.json` — `{ keywords: string[], source_session: string, content: string, created_at: string }`

### 3. Search — compacting 훅에서 키워드 매칭

**선택:** compacting 훅에서 현재 대화 컨텍스트의 키워드와 `memory/facts/`의 키워드를 교집합 매칭. 관련도 높은 fact를 컨텍스트에 주입.

**이유:** 임베딩 없이 순수 키워드 매칭. 구현 단순, 의존성 없음. 정확도는 낮지만 Step 3에서 충분.

### 4. history.jsonl 로테이션 — 사이즈 기반

**선택:** append 전 파일 크기를 체크하여 1MB 초과 시 `history.jsonl` → `history-{timestamp}.jsonl`로 rename 후 새 파일 생성.

**이유:** 1MB면 수천 줄. 하네스 규칙 이력으로 충분히 검색 가능. 10줄 수준의 간단한 유틸.

### 5. fix: 커밋 파싱 — git log 포맷 개선

**선택:** `--format`과 `--name-only`를 분리해서 파싱. `git log --since=... --format="COMMIT_START%n%H%n%s" --name-only` 포맷 사용.

**이유:** 기존 `split('\n\n')` 방식은 git 출력 포맷에 따라 깨짐. 명확한 delimiter(`COMMIT_START`) 사용.

## Risks / Trade-offs

**[.opencode/rules/ 파일 동기화 누락]** → improver에서 JSON + 마크다운을 원자적으로 갱신. 실패 시 다음 session.idle에서 재동기화.

**[키워드 추출 품질]** → LLM 없이 정규식이므로 노이즈 가능. 상위 단계(Extract)에서 LLM 도입 시 개선. 지금은 데이터 축적이 우선.

**[memory/facts/ 증식]** → fact 수가 많아지면 Search 성능 저하 가능. 현재는 키워드 매칭이므로 O(n)이지만, 수백 개 이하면 문제없음. 나중에 인덱스 최적화.
