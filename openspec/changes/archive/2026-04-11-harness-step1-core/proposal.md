## Why

harness-orchestration 프로젝트의 4단계 로드맵 중 Step 1로, 단일 에이전트 품질 제어의 기반을 구축한다. L1(관측)~L4(규칙 차단)까지 동작하는 기본 하네스를 완성하여, 이후 Step 2~4의 모든 레이어가 이 기반 위에 올라갈 수 있게 한다. 하네스가 먼저 있어야 오케스트레이션에서 서브에이전트를 띄울 때 자동으로 품질 보장이 따라온다.

## What Changes

- **observer 플러그인 신규 구현**: `tool.execute.after` 훅으로 모든 도구 실행 결과를 JSONL로 기록(L1). `event` 핸들러로 세션 에러 반복 감지 및 사용자 불만 키워드 감지(L2).
- **enforcer 플러그인 신규 구현**: `tool.execute.before` 훅으로 HARD 규칙 매칭 시 도구 실행 차단(L4). SOFT 규칙 위반 시 violation_count 증가(승격 전제 조건). scaffold NEVER DO 패턴 체크.
- **공통 인프라 구축**: `types.ts`(Signal, Rule, ProjectState 스키마), `shared/utils.ts`(getProjectKey, ensureHarnessDirs, logEvent, generateId), `shared/file-io.ts`, `shared/constants.ts`.
- **npm 패키지 scaffold**: package.json, tsconfig.json, index.ts(진입점 — observer + enforcer만 export).
- **런타임 디렉토리 구조**: `~/.config/opencode/harness/` 하위에 logs/, signals/, rules/, scaffold/, projects/ 등 자동 생성.

## Capabilities

### New Capabilities
- `harness-observer`: 도구 실행 로깅(L1), 에러 반복 감지(L2), 사용자 불만 신호 생성(L2), 파일 편집 로깅(L1)
- `harness-enforcer`: HARD 규칙 차단(L4), SOFT 규칙 위반 추적(violation_count), scaffold NEVER DO 체크, .env 커밋 방지
- `harness-shared-infra`: 공유 저장소 스키마(Signal, Rule, ProjectState), 공통 유틸리티(getProjectKey, ensureHarnessDirs, logEvent, generateId), 파일 I/O 헬퍼, 상수 정의

### Modified Capabilities
_(없음 — 최초 구현)_

## Impact

- **새 코드**: `src/` 하위 약 10개 파일 (types.ts, shared/*, harness/observer.ts, harness/enforcer.ts, index.ts)
- **런타임 데이터**: `~/.config/opencode/harness/` 디렉토리 자동 생성 (JSONL 로그, JSON 규칙/신호 파일)
- **의존성**: `@opencode-ai/plugin` (플러그인 타입), `zod` (설정 스키마 검증, Step 1에서는 최소 사용)
- **외부 API**: OpenCode Plugin 훅 (`tool.execute.before`, `tool.execute.after`, `event`, `experimental.session.compacting` — Step 1에서는 before/after/event만 사용)
- **배포**: 단일 npm 패키지로 observer + enforcer export. Step 2에서 improver 추가 export.
