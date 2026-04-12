## Why

Step 2에서 L5~L6 폐루프 하네스를 완성했지만, 두 가지 실제 갭이 남아있다. 첫째, `scope: 'prompt'` 규칙은 compacting 훅에서만 주입되어 **짧은 세션에서는 규칙이 전혀 보이지 않는다**. 둘째, 세션 간 학습이 없어서 매 세션이 독립적으로 시작된다 — 이전 세션에서 발견한 결정·제약이 회수되지 않는다. 셋째, 실동작 테스트에서 fix: 커밋의 `source_file`이 빈 문자열로 나오는 파싱 품질 이슈가 있다.

## What Changes

- **.opencode/rules/ 병행 추가:** improver가 SOFT 규칙 생성 시 `rules/soft/` JSON과 함께 `.opencode/rules/harness-soft-rules.md`도 자동 갱신. 세션 시작부터 prompt 규칙이 노출됨
- **크로스세션 기억 하위 2단계 추가 (Index, Search):** improver의 session.idle에서 세션 JSONL의 키워드를 추출하여 `memory/facts/`에 저장(Index). compacting 훅에서 관련 fact를 키워드 검색하여 컨텍스트에 주입(Search). Sync는 observer가 이미 수행 중
- **history.jsonl 로테이션:** 파일 사이즈 체크 + 일정 크기 초과 시 rotate. 무한 증식 방지
- **fix: 커밋 파싱 고도화:** `detectFixCommits()`에서 `git log --name-only` 출력 파싱 개선. `source_file` 빈 문자열 이슈 수정

## Capabilities

### New Capabilities
- `harness-memory`: 크로스세션 기억 Index + Search. 키워드 기반 fact 저장 및 compacting 훅에서 회수

### Modified Capabilities
- `harness-improver`: .opencode/rules/ 병행 갱신, memory Index/Search 통합, fix: 커밋 파싱 개선
- `harness-shared-infra`: history.jsonl 로테이션 유틸리티 추가

## Impact

- **수정 코드:** `src/harness/improver.ts` (Index/Search/rules 갱신/파싱 개선), `src/shared/utils.ts` (로테이션 유틸)
- **런타임 데이터:** `memory/facts/` 신규 디렉토리, `.opencode/rules/harness-soft-rules.md` 자동 생성
- **의존성:** 변경 없음 (기존 fs, path만 사용)
- **배포:** improver 수정분 동기화. observer/enforcer 변경 없음
