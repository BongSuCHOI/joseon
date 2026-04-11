## Context

harness-orchestration 프로젝트는 Hugh Kim의 하네스/오케스트레이션 아키텍처를 OpenCode 플러그인 시스템 위에 재구현한다. 현재 프로젝트는 백지 상태로, 코드도, OpenSpec change도, specs도 없다.

Step 1에서 구현할 것은 L1(관측 가능성)~L4(규칙 차단)까지 동작하는 기본 하네스다. 이것은 4단계 로드맵의 기반이며, 이후 Step 2(improver), Step 3(브릿지), Step 4(오케스트레이터)가 모두 이 기반 위에 올라간다.

**현재 제약:**
- OpenCode Plugin API는 소스코드에서 전체 확인 완료 (`docs/api-confirmation.md` 참조)
- `tool.execute.after`에서 args는 `input.args`에 있음 (output 아님)
- `metadata.error`는 존재하지 않음 — 에러 감지는 `session.error` 이벤트로 처리
- `Message`에 텍스트 없음 — 불만 감지는 `message.part.updated`에서 `part.text`로 접근
- `file.edited`의 파일 경로는 `properties.file` (`filePath` 아님)

## Goals / Non-Goals

**Goals:**
- L1: 모든 도구 실행이 JSONL로 구조화 로깅됨
- L2: 에러 반복 3회 시 signal 생성, 사용자 불만 키워드 시 signal 생성
- L3: 서로 다른 프로젝트의 signal/rule이 다른 project_key로 격리됨
- L4: HARD 규칙이 tool.execute.before에서 throw Error로 도구 실행 차단
- L4: SOFT 규칙 위반 시 violation_count 증가 (scope: 'tool', 'file' 한정)
- scope: 'prompt' 규칙은 violation_count 증가하지 않음
- 공유 저장소(`~/.config/opencode/harness/`) 디렉토리 구조 자동 생성
- 단일 npm 패키지로 observer + enforcer export

**Non-Goals:**
- 자동 규칙 생성 (improver, Step 2)
- fix: 커밋 학습 (Loop 1, Step 2)
- 30일 효과 측정 (Loop 3, Step 2)
- SOFT→HARD 자동 승격 (improver, Step 2)
- experimental.session.compacting 컨텍스트 주입 (improver, Step 2)
- 오케스트레이션/서브에이전트 관리 (Step 4)

## Decisions

### 1. 파일 시스템을 유일한 상태 저장소로 사용

**선택:** DB, IPC, 외부 MCP 없이 `~/.config/opencode/harness/` 디렉토리의 JSON/JSONL 파일만으로 상태 관리

**이유:** Hugh Kim의 오케스트레이터 진화에서 가장 중요한 교훈. 외부 MCP 서버(Context7, TaskManager) 동기화 사고로 파일이 삭제된 전례. 파일은 디버깅이 직관적이고, 플러그인 간 결합도가 낮음.

**대안 고려:** SQLite — 검색에는 유리하지만 Step 1에서는 파일 순회로 충분. Step 2 고도화 시 검색 인덱스로 도입 가능.

### 2. JSONL 포맷으로 append-only 로깅

**선택:** 로그 파일을 JSONL(한 줄당 하나의 JSON)로 기록

**이유:** append-only로 쓰기 충돌이 없음. 한 줄씩 읽을 수 있어 부분 파싱 가능. JSON 배열은 매번 전체 파일을 읽고 써야 함.

### 3. 관측(observer)과 차단(enforce)의 훅 분리

**선택:** observer는 `tool.execute.after`(실행 후 관측), enforcer는 `tool.execute.before`(실행 전 차단)

**이유:** 관측은 결과를 봐야 의미가 있으므로 after. 차단은 실행 전에 끼어들어야 하므로 before. 한 플러그인에 섞으면 관심사가 꼬임.

### 4. 에러 감지를 session.error 이벤트로 이관

**선택:** `tool.execute.after`에서 `metadata.error` 체크 대신 `session.error` 이벤트로 에러 감지

**이유:** OpenCode에서 툴 에러는 throw로 처리되며, 에러 발생 시 `tool.execute.after`가 호출되지 않을 수 있음. `metadata.error` 필드는 존재하지 않음. observer는 순수 로깅만 담당.

### 5. 불만 키워드 감지를 message.part.updated로 처리

**선택:** `message.updated`의 `properties.info`(Message) 대신 `message.part.updated`의 `part.text`에서 키워드 감지

**이유:** `Message` 타입은 메타데이터만 포함하고 텍스트 내용이 없음. 실제 텍스트는 `Part` 객체의 `text` 필드에 있음. `part.type === 'text'`에서 접근.

### 6. safeRegexTest로 정규식 보호

**선택:** enforcer의 모든 정규식 패턴 매칭을 try-catch로 감싼 `safeRegexTest()` 사용

**이유:** 규칙의 `pattern.match`는 improver가 자동 생성(Step 2). 잘못된 정규식이 들어오면 `new RegExp()`가 예외를 던져 enforcer 전체가 멈춤. try-catch로 무효 패턴은 무시하고 플러그인은 계속 동작.

### 7. project_key를 git worktree realpath의 SHA-256 hash로 생성

**선택:** `realpathSync(worktree)` → SHA-256 hash → 앞 12자리

**이유:** basename 충돌 방지. `/home/user/projectA`와 `/tmp/projectA`가 같은 key를 가지면 상태 오염. realpath로 심볼릭 링크도 해결.

## Risks / Trade-offs

**[불만 키워드 false positive]** → 초안에서는 키워드 매칭으로 시작. Step 2에서 LLM 기반 판정으로 교체 가능. "불만 감지 → signal 생성" 파이프라인 존재 자체가 중요.

**[scaffold 키워드 매칭 한계]** → 자연어 NEVER DO를 정확히 매칭하는 건 불가능. 60% 임계값은 시작점. 운영하면서 false positive/negative 조정.

**[동일 파일 동시 쓰기]** → JSONL은 append-only라 충돌 가능성 낮음. Signal/Rule 파일은 UUID 기반 파일명으로 충돌 회피. violation_count 증가는 파일 읽기-수정-쓰기 패턴이나, 빈도가 낮아 실질적 리스크 낮음.

**[규칙 리로드 시점]** → session.created에서만 리로드. 세션 중간 규칙 변경은 다음 세션부터 적용. 실시간 반영이 필요하면 Step 3에서 개선.

**[Step 1은 수동 규칙만]** → improver(자동 규칙 생성)가 없으므로, 검증을 위해 rules/ 디렉토리에 테스트 규칙을 수동으로 넣어야 함. 이것은 의도된 설계.
