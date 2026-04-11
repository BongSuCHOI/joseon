## 1. 프로젝트 Scaffold

- [x] 1.1 package.json 생성 (이름: my-harness, main: dist/index.js, types: dist/index.d.ts, scripts: build/dev)
- [x] 1.2 tsconfig.json 생성 (target: ES2022, module: NodeNext, strict: true, outDir: dist, rootDir: src)
- [x] 1.3 src/index.ts 생성 (observer + enforcer export, improver/orchestrator는 주석 처리)
- [x] 1.4 .gitignore 생성 (node_modules, dist, ~/.config/opencode/harness/)

## 2. 공통 인프라 (shared)

- [x] 2.1 src/shared/constants.ts — HARNESS_DIR 상수 정의
- [x] 2.2 src/types.ts — Signal, Rule, ProjectState 인터페이스 정의 (v3-final 스키마 기준)
- [x] 2.3 src/shared/utils.ts — getProjectKey, ensureHarnessDirs, generateId, logEvent 구현
- [x] 2.4 src/shared/index.ts — 배럴 export
- [x] 2.5 단위 테스트: getProjectKey 동일 경로 동일 key, 상이 경로 상이 key, 미존재 경로 'unknown' 반환
- [x] 2.6 단위 테스트: ensureHarnessDirs 최초 호출 시 전체 디렉토리 생성, 2회째 에러 없음

## 3. Observer 플러그인

- [x] 3.1 src/harness/observer.ts — 플러그인 골격 생성 (HarnessObserver export, ensureHarnessDirs 호출)
- [x] 3.2 tool.execute.after 훅 — 도구 실행 결과 JSONL 로깅 (input.args, output.title, output.output)
- [x] 3.3 event(session.error) — 에러 감지 + 반복 카운팅 + 3회 시 error_repeat signal 생성
- [x] 3.4 event(session.idle) — 세션 완료 로깅 (event.properties.sessionID)
- [x] 3.5 event(file.edited) — 파일 편집 로깅 (event.properties.file)
- [x] 3.6 event(message.part.updated) — 불만 키워드 감지 + user_feedback signal 생성 (part.type === 'text'에서 part.text)

## 4. Enforcer 플러그인

- [x] 4.1 src/harness/enforcer.ts — 플러그인 골격 생성 (HarnessEnforcer export, ensureHarnessDirs 호출)
- [x] 4.2 loadRules() — rules/soft, rules/hard 디렉토리에서 프로젝트/global 규칙 로드
- [x] 4.3 loadScaffold() + extractNeverDoPatterns() — scaffold 파일에서 NEVER DO 패턴 추출
- [x] 4.4 safeRegexTest() — try-catch로 보호된 정규식 매칭 함수
- [x] 4.5 incrementViolation() — SOFT 규칙 위반 시 violation_count 증가
- [x] 4.6 tool.execute.before — HARD 규칙 매칭 시 throw Error로 차단 (scope: tool, file)
- [x] 4.7 tool.execute.before — SOFT 규칙 매칭 시 violation_count만 증가 (scope: prompt 건너뜀)
- [x] 4.8 tool.execute.before — scaffold NEVER DO 키워드 매칭 (60% 임계값)
- [x] 4.9 tool.execute.before — .env git add/commit 특수 차단
- [x] 4.10 event(session.created) — 세션 시작 시 규칙/스캐폴드 리로드

## 5. 빌드 및 동작 검증

- [x] 5.1 npm install + npm run build 성공 확인 (타입 에러 없음)
- [x] 5.2 L1 검증: 도구 사용 로그가 logs/tools/에 JSONL로 기록되는지 확인
- [x] 5.3 L2 검증: 에러 3회 반복 시 signals/pending/에 signal 파일 생성 확인
- [x] 5.4 L3 검증: 서로 다른 프로젝트에서 다른 project_key로 signal 분리 확인
- [x] 5.5 L4 HARD 검증: rules/hard/에 테스트 규칙 수동 생성 후 해당 패턴 도구 실행 차단 확인
- [x] 5.6 L4 SOFT 검증: rules/soft/에 scope: 'tool' 테스트 규칙 수동 생성 후 위반 시 violation_count 증가 확인
- [x] 5.7 scope: 'prompt' 검증: rules/soft/에 scope: 'prompt' 테스트 규칙 생성 후 violation_count 증가하지 않음 확인
- [x] 5.8 불만 키워드 검증: 불만 키워드 포함 메시지 시 user_feedback signal 생성 확인
- [x] 5.9 .env 차단 검증: `git add .env` 명령 시 차단 확인
