# Development Guide

> OpenCode 플러그인 개발, 로컬 로드, 테스트, 배포 절차.

---

## 1. 플러그인 로드 방식

### 개발 중: 로컬 플러그인

`.opencode/plugins/` 디렉토리에 TypeScript 파일을 직접 배치. Bun 런타임이 컴파일 없이 실행.

```
.opencode/plugins/harness/
├── package.json          # { "name": "my-harness", "type": "module" }
├── index.ts              # export default { id, server() }
├── types.ts
├── shared/
│   ├── constants.ts
│   ├── utils.ts          # getProjectKey, ensureHarnessDirs, logEvent, generateId, mergeEventHandlers
│   ├── logger.ts         # 구조화된 로깅 (debug/info/warn/error + HARNESS_LOG_LEVEL)
│   └── index.ts
├── config/               # A2: 설정 시스템
│   ├── schema.ts         # HarnessConfig, AgentOverrideConfig, HarnessSettings + defaults
│   ├── loader.ts         # JSONC/JSON 로더 + 글로벌/프로젝트 병합
│   └── index.ts
├── hooks/                # A3: 훅 모듈
│   ├── delegate-task-retry.ts
│   ├── json-error-recovery.ts
│   ├── post-file-tool-nudge.ts
│   ├── post-read-nudge.ts
│   ├── phase-reminder.ts
│   ├── foreground-fallback.ts   # abort + prompt_async 재프롬프트로 same-session 복구
│   ├── filter-available-skills.ts
│   └── index.ts          # createAllHooks()
├── harness/
│   ├── observer.ts
│   ├── enforcer.ts
│   └── improver.ts       # Step 2 추가: L5 자가개선 + L6 폐루프
├── orchestrator/
│   ├── orchestrator.ts
│   ├── phase-manager.ts
│   ├── error-recovery.ts
│   └── qa-tracker.ts
└── agents/               # 11개 에이전트
    ├── agents.ts
    └── prompts/
```

**설정 파일:**
- 프로젝트: `.opencode/harness.jsonc` — 에이전트 model/temperature/hidden + 하네스 임계값 오버라이드
- 글로벌: `~/.config/opencode/harness.jsonc` — 모든 프로젝트에 적용 (프로젝트 설정이 우선)

**핵심 규칙:**
- `package.json`에 `"type": "module"` 필수
- `index.ts`는 `export default { id, server() }` 패턴 사용
- `src/`의 소스를 복사해서 사용 (import 경로에 `.js` 확장자 필수 — Bun이 처리)
- OpenCode 재시작 시 자동 로드됨

### 실사용/배포: npm 패키지

`opencode.json`에 패키지명 등록:

```json
{
  "plugin": ["my-harness"]
}
```

OpenCode가 자동으로 `bun install` 실행 후 `~/.cache/opencode/node_modules/`에 캐싱.

**빌드 및 배포:**
```bash
npm run build    # tsc → dist/
npm publish      # npm 레지스트리에 배포
```

---

## 2. 로컬 개발 워크플로우

### src/ 수정 후 로컬 플러그인에 반영

```bash
# 1. src/에서 수정 후 빌드
npm run build

# 2. .opencode/plugins/harness/에 복사
cp -r src/types.ts .opencode/plugins/harness/types.ts
cp -r src/shared/ .opencode/plugins/harness/shared/
cp -r src/harness/ .opencode/plugins/harness/harness/
cp -r src/orchestrator/ .opencode/plugins/harness/orchestrator/

# 3. index.ts는 진입점이 다르므로 별도 관리 (이미 .opencode/plugins/harness/index.ts에 있음)

# 4. OpenCode 재시작
```

### 빠른 동기화 스크립트

```bash
# src/ 변경사항을 로컬 플러그인에 싱크 (__tests__만 제외)
rsync -av --exclude='__tests__' src/ .opencode/plugins/harness/
```

OpenCode는 TUI 앱이므로 tmux를 사용해서 자동화 테스트를 실행한다.

### 기본 패턴

```bash
# 1. tmux 세션 생성
tmux new-session -d -s harness-test -c /Users/choibongsu/projects/harness-orchestration

# 2. OpenCode에 프롬프트 전달
tmux send-keys -t harness-test "opencode --prompt '테스트할 명령이나 요청'" Enter

# 3. 대기 후 결과 확인
sleep 10 && tmux capture-pane -t harness-test -p

# 4. 정리
tmux kill-session -t harness-test
```

### L1 (로깅) 테스트

```bash
tmux new-session -d -s harness-test -c /Users/choibongsu/projects/harness-orchestration
tmux send-keys -t harness-test "opencode --prompt 'package.json 파일 내용을 보여줘'" Enter
sleep 10 && tmux capture-pane -t harness-test -p

# 확인: 통합 로그 파일에 도구 실행 로그가 있어야 함
cat ~/.config/opencode/harness/logs/harness.jsonl | tail -3

tmux kill-session -t harness-test
```

### L4 (HARD 차단) 테스트

```bash
# 1. 테스트용 HARD 규칙 생성
mkdir -p ~/.config/opencode/harness/rules/hard
cat > ~/.config/opencode/harness/rules/hard/test-block.json << 'EOF'
{
  "id": "test-block-001",
  "type": "hard",
  "project_key": "global",
  "created_at": "2026-04-11T00:00:00Z",
  "source_signal_id": "manual-test",
  "pattern": { "type": "code", "match": "rm -rf", "scope": "tool" },
  "description": "rm -rf 명령 차단 (테스트용)",
  "violation_count": 0
}
EOF

# 2. tmux로 테스트
tmux new-session -d -s harness-test -c /Users/choibongsu/projects/harness-orchestration
tmux send-keys -t harness-test "opencode --prompt 'rm -rf /tmp/test 디렉토리를 삭제해줘'" Enter
sleep 10 && tmux capture-pane -t harness-test -p

# 기대 결과: [HARNESS HARD BLOCK] rm -rf 명령 차단 (테스트용)

# 3. 정리
rm ~/.config/opencode/harness/rules/hard/test-block.json
tmux kill-session -t harness-test
```

### L4 (SOFT 위반 추적) 테스트

```bash
# 1. 테스트용 SOFT 규칙 생성
mkdir -p ~/.config/opencode/harness/rules/soft
cat > ~/.config/opencode/harness/rules/soft/test-soft.json << 'EOF'
{
  "id": "test-soft-001",
  "type": "soft",
  "project_key": "global",
  "created_at": "2026-04-11T00:00:00Z",
  "source_signal_id": "manual-test",
  "pattern": { "type": "code", "match": "console\\.log", "scope": "tool" },
  "description": "console.log 사용 감지 (테스트용)",
  "violation_count": 0
}
EOF

# 2. tmux로 테스트
tmux new-session -d -s harness-test -c /Users/choibongsu/projects/harness-orchestration
tmux send-keys -t harness-test "opencode --prompt 'console.log(\"hello\")를 추가해줘'" Enter
sleep 10 && tmux capture-pane -t harness-test -p

# 기대 결과: 차단은 안 되고 violation_count만 증가
# 확인:
cat ~/.config/opencode/harness/rules/soft/test-soft.json | grep violation_count
# → "violation_count": 1 이상

# 3. 정리
rm ~/.config/opencode/harness/rules/soft/test-soft.json
tmux kill-session -t harness-test
```

### .env 차단 테스트

```bash
tmux new-session -d -s harness-test -c /Users/choibongsu/projects/harness-orchestration
tmux send-keys -t harness-test "opencode --prompt '.env 파일을 git add 해줘'" Enter
sleep 10 && tmux capture-pane -t harness-test -p

# 기대 결과: [HARNESS HARD BLOCK] .env 파일의 git add/commit이 금지되어 있습니다.
tmux kill-session -t harness-test
```

### 팁

- `sleep` 시간은 모델 응답 속도에 따라 조정 (보통 10~15초)
- `tmux capture-pane -p` 대신 `-p -S -50`으로 더 많은 출력 캡처 가능
- 기존 로그와 구분하기 위해 테스트 전에 백업: `cp ~/.config/opencode/harness/logs/tools/$(date +%Y-%m-%d).jsonl /tmp/harness-backup.jsonl`

---

## 3.5 Step 2 (L5~L6) 실동작 테스트

### 준비: 프로젝트 키 확인

```bash
PROJECT_KEY=$(node -e "const crypto=require('crypto');console.log(crypto.createHash('sha256').update(require('fs').realpathSync('$PWD')).digest('hex').slice(0,12))")
echo "Project Key: $PROJECT_KEY"
```

### L5: pending signal → SOFT 규칙 자동 변환

```bash
# 1. 테스트용 pending signal 생성
SIGNAL_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
cat > ~/.config/opencode/harness/signals/pending/${SIGNAL_ID}.json << EOF
{
  "id": "${SIGNAL_ID}",
  "type": "error_repeat",
  "project_key": "${PROJECT_KEY}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "payload": {
    "description": "테스트 에러 반복",
    "pattern": "TestError: step2-test-pattern",
    "recurrence_count": 3
  },
  "status": "pending"
}
EOF

# 2. OpenCode 실행 → session.idle에서 improver가 처리
tmux new-session -d -s harness-test -c /Users/choibongsu/projects/harness-orchestration
tmux send-keys -t harness-test "opencode --prompt '안녕, 1+1은 뭐야?'" Enter
sleep 30

# 3. 결과 확인
ls ~/.config/opencode/harness/signals/ack/   # signal이 ack로 이동했는지
ls ~/.config/opencode/harness/rules/soft/     # SOFT 규칙이 생성됐는지
cat ~/.config/opencode/harness/rules/history.jsonl  # rule_created 이벤트 확인
cat ~/.config/opencode/harness/projects/${PROJECT_KEY}/state.json  # 프로젝트 상태

tmux kill-session -t harness-test
```

### L6: SOFT→HARD 자동 승격

```bash
# 1. 방금 만든 SOFT 규칙의 violation_count를 2로 설정
SOFT_RULE=$(ls ~/.config/opencode/harness/rules/soft/*.json | head -1)
node -e "
const fs = require('fs');
const rule = JSON.parse(fs.readFileSync('${SOFT_RULE}', 'utf-8'));
rule.violation_count = 2;
rule.last_violation_at = new Date().toISOString();
fs.writeFileSync('${SOFT_RULE}', JSON.stringify(rule, null, 2));
"

# 2. session.idle 트리거 → promoteRules() 실행
tmux new-session -d -s harness-test -c /Users/choibongsu/projects/harness-orchestration
tmux send-keys -t harness-test "opencode --prompt '1+1은? 숫자만 답해'" Enter
sleep 40
tmux send-keys -t harness-test "q" Enter
sleep 3

# 3. 결과 확인
ls ~/.config/opencode/harness/rules/soft/     # 비어있어야 함 (HARD로 이동)
ls ~/.config/opencode/harness/rules/hard/     # 규칙이 여기 있어야 함
cat ~/.config/opencode/harness/rules/history.jsonl | tail -1  # rule_promoted 이벤트

# 4. HARD 규칙 내용 확인 (violation_count=0, promoted_at 기록)
cat ~/.config/opencode/harness/rules/hard/*.json | python3 -m json.tool

tmux kill-session -t harness-test
```

### HARD 차단 실동작 (승격된 규칙으로)

```bash
# 승격된 규칙의 패턴이 포함된 bash 명령 실행 시도
tmux new-session -d -s harness-test -c /Users/choibongsu/projects/harness-orchestration
tmux send-keys -t harness-test "opencode --prompt 'bash에서 echo TestError: step2-test-pattern 명령을 실행해줘'" Enter
sleep 30
tmux capture-pane -t harness-test -p -S -30

# 기대 결과: [HARNESS HARD BLOCK] 테스트 에러 반복

tmux kill-session -t harness-test
```

### 테스트 정리

```bash
# 테스트용 규칙 삭제
rm ~/.config/opencode/harness/rules/hard/*.json 2>/dev/null
rm ~/.config/opencode/harness/rules/soft/*.json 2>/dev/null
rm ~/.config/opencode/harness/signals/ack/*.json 2>/dev/null
rm ~/.config/opencode/harness/rules/history.jsonl 2>/dev/null
```

---

## 4. 테스트 완료 후 문서 업데이트

각 Step의 테스트가 전부 통과하면, **반드시 아래 두 문서를 업데이트**한다. 다른 세션에서도 상태를 즉시 파악할 수 있도록.

### AGENTS.md 로드맵 상태 업데이트

```markdown
## 4단계 구축 로드맵

| Step | 내용 | 플러그인 | 상태 |
|------|------|----------|------|
| 1 | 하네스 초안 | observer + enforcer | ✅ 완료 |    ← 여기 업데이트
| 2 | 하네스 고도화 | + improver | 구현 전 |
```

### docs/development-guide.md 테스트 결과 기록

각 Step 섹션 아래에 테스트 결과를 추가:

```markdown
## 테스트 이력

| 일자 | Step | 항목 | 결과 | 비고 |
|------|------|------|------|------|
| 2026-04-11 | Step 1 | L1 (로깅) | ✅ | glob, bash 로그 JSONL 기록 확인 |
| 2026-04-11 | Step 1 | L4 (HARD 차단) | ✅ | rm -rf 명령 차단 확인 |
| 2026-04-11 | Step 1 | L4 (.env 차단) | ✅ | git add .env 차단 확인 |
```

**핵심:** 테스트 완료 = 문서 업데이트까지 포함. 문서가 안 바뀌면 완료가 아님.

---

## 5. 빌드 및 타입 체크

```bash
# 의존성 설치
npm install

# 빌드 (tsc)
npm run build

# 타입 체크만 (파일 생성 안 함)
npx tsc --noEmit

# smoke test 실행
npx tsx test/smoke-test.ts
```

---

## 6. 런타임 데이터 확인

```bash
# 전체 파일 목록
find ~/.config/opencode/harness/ -type f | sort

# 오늘 도구 로그
cat ~/.config/opencode/harness/logs/tools/$(date +%Y-%m-%d).jsonl

# 활성 규칙
ls ~/.config/opencode/harness/rules/hard/
ls ~/.config/opencode/harness/rules/soft/

# 대기 중인 signal
ls ~/.config/opencode/harness/signals/pending/

# 프로젝트 상태
cat ~/.config/opencode/harness/projects/*/state.json
```

---

## 7. 테스트 이력

| 일자 | Step | 항목 | 결과 | 비고 |
|------|------|------|------|------|
| 2026-04-11 | Step 1 | smoke test (21/21) | ✅ | getProjectKey, ensureHarnessDirs, logEvent, regex, violation tracking |
| 2026-04-11 | Step 1 | npm run build | ✅ | 타입 에러 없음 |
| 2026-04-11 | Step 1 | L1 (로깅) 실동작 | ✅ | glob, bash 도구 실행 결과가 JSONL에 기록됨 |
| 2026-04-11 | Step 1 | L4 (HARD 차단) 실동작 | ✅ | tmux로 rm -rf 명령 차단 확인 |
| 2026-04-11 | Step 1 | 참고 문서 5개 완독 | ✅ | self-evolving, claude-code-harness, harsh-critic, OpenCode plugins/agents |
| 2026-04-11 | Step 2 | 참고 문서 6개 완독 + 사전 분석 | ✅ | v3 버그 2건(C1, W3) 발견, 갭 6개 분석, 오라클 크로스 리뷰 |
| 2026-04-11 | Step 2 | npm run build | ✅ | 타입 에러 3건 수정 후 빌드 성공 |
| 2026-04-11 | Step 2 | smoke test (29/29) | ✅ | mergeEventHandlers, signalToRule, 중복처리, promoteRules, evaluateDelta, timestamp, state, compacting |
| 2026-04-11 | Step 2 | L5 (자동 수정) | ✅ | pending signal → SOFT 규칙 자동 변환 확인 |
| 2026-04-11 | Step 2 | L5 (fix: 커밋 감지) | ✅ | git log --since로 fix: 커밋 → signal 생성 코드 경로 확인 |
| 2026-04-11 | Step 2 | L6 (SOFT→HARD 승격) | ✅ | violation_count≥2 시 HARD 승격, prompt scope 제외, 승격 시 카운터 리셋 |
| 2026-04-11 | Step 2 | L6 (30일 효과 측정) | ✅ | delta 기반 측정으로 W3 버그 수정 확인 |
| 2026-04-11 | Step 2 | Compacting (컨텍스트 주입) | ✅ | scaffold + HARD/SOFT 규칙 주입 확인 |
| 2026-04-11 | Step 2 | C1 수정 (event 훅 병합) | ✅ | mergeEventHandlers로 observer event 핸들러 보존 확인 |
| 2026-04-11 | Step 2 | L5 실동작 (tmux) | ✅ | pending signal → SOFT 규칙 변환 + ack 이동 + history 기록 + state 갱신 |
| 2026-04-11 | Step 2 | L6 실동작 (tmux) | ✅ | violation_count=2 → HARD 승격 + 카운터 리셋 + promoted_at 기록 |
| 2026-04-11 | Step 2 | HARD 차단 실동작 (tmux) | ✅ | 승격된 규칙으로 bash 명령 차단 [HARNESS HARD BLOCK] |
| 2026-04-11 | Step 2 | session.created 타임스탬프 | ✅ | session_start_{key}.json에 timestamp+sessionID 기록 확인 |
| 2026-04-12 | Step 3 | npm run build | ✅ | 타입 에러 없음 |
| 2026-04-12 | Step 3 | smoke test (25/25) | ✅ | rotateHistoryIfNeeded, syncRulesMarkdown, Memory Index/Search, fix: 커밋 파싱, history 로테이션 |
| 2026-04-12 | Step 3 | .opencode/rules/ 마크다운 실동작 | ✅ | SOFT 규칙 생성 시 harness-soft-rules.md 자동 갱신, OpenCode가 세션 시작부터 읽음 |
| 2026-04-12 | Step 3 | Signal → SOFT 규칙 실동작 (tmux) | ✅ | pending signal → ack 이동 + SOFT 규칙 생성 + history 기록 + state 갱신 |
| 2026-04-12 | Step 3 | fix: 커밋 파싱 (COMMIT_START delimiter) | ✅ | 기존 ||| 파싱 → COMMIT_START delimiter로 개선, 스모크 테스트 2개 fix 커밋 정상 파싱 |
| 2026-04-12 | Step 3 | history.jsonl 로테이션 실동작 | ✅ | 1MB 초과 시 자동 로테이션 확인 |
| 2026-04-12 | Step 3 | Memory Index (indexSessionFacts) | ✅ | 스모크: 6개 키워드 추출 + facts 저장 확인. 실동작: observer가 이벤트만 로깅하여 대화 내용 미포함 (설계적 특성) |
| 2026-04-12 | Step 3 | Memory Search (searchFacts) | ✅ | 키워드 매칭 + 점수 정렬 + 최대 10개 제한 확인 |
| 2026-04-12 | Step 3 | Compacting 컨텍스트 (Memory 주입) | ✅ | [HARNESS MEMORY — past decisions] 섹션 주입 코드 구현 |
| 2026-04-12 | Step 3 | #8 scope:prompt 효과 측정 | ✅ | types.ts에 'unmeasurable' 추가, evaluateRuleEffectiveness에서 prompt scope 조기 분기 |
| 2026-04-12 | Step 3 | #1 Race Condition 방지 | ✅ | signalToRule()에서 write 직전 existsSync 재확인 (TOCTOU 완화) |
| 2026-04-12 | Step 3 | #5 Regex Backtracking 방지 | ✅ | safeRegexTest에 target 길이 10000자 제한 (improver + enforcer 양쪽) |
| 2026-04-12 | Step 3 | #6 Command Injection 방지 | ✅ | detectFixCommits에서 ISO_DATE_REGEX로 timestamp 검증 후 git log 실행 |
| 2026-04-12 | Step 3 | #7 Overly Broad Pattern 방지 | ✅ | isValidPattern() — 최소 3자, 메타문자만 구성 패턴 거부. rule_rejected 이력 기록 |
| 2026-04-12 | Step 3 | smoke test (50/50) | ✅ | 기존 25개 + #1,#5,#6,#7,#8 예외 케이스 25개 추가 |
| 2026-04-13 | Step 4a | npm run build | ✅ | 타입 에러 없음 |
| 2026-04-13 | Step 4a | smoke test — Phase Manager (22/22) | ✅ | Phase 전환, 2.5 gate, 리셋, 미완료 감지, 손상 파일 폴백 |
| 2026-04-13 | Step 4a | smoke test — PID Lock (9/9) | ✅ | 최초 생성, stale lock 교체, 활성 lock 경고, 정리 |
| 2026-04-13 | Step 4a | 기존 Step 1 스모크 (21/21) | ✅ | 회귀 없음 |
| 2026-04-13 | Step 4a | 기존 Step 3 스모크 (50/50) | ✅ | 회귀 없음 |
| 2026-04-13 | Step 4b | npm run build | ✅ | 에이전트 정의 + config 콜백 빌드 성공 |
| 2026-04-13 | Step 4c | npm run build | ✅ | 에러 복구 + QA 추적기 빌드 성공 |
| 2026-04-13 | Step 4c | smoke test — Error Recovery + QA (24/24) | ✅ | 에러 복구 5단계 진행, QA retry→escalate, 시나리오별 독립 추적 |
| 2026-04-13 | Step 4c | 기존 Step 1/3/4a 회귀 | ✅ | 회귀 없음 |
| 2026-04-14 | Step 4b | 프롬프트 품질 개선 (7개 전체) | ✅ | omOs+omO+agency-agents 기반 재작성. cross-reviewer→designer 교체. 빌드 성공 |
| 2026-04-14 | Step 4D | npm run build | ✅ | orchestrator.ts + index.ts 통합 빌드 성공 |
| 2026-04-14 | Step 4D | 기존 Step 1/3/4a/4c 회귀 | ✅ | 21+50+22+9+24=126 테스트 전원 통과 |
| 2026-04-14 | Step 4D | 배포 동기화 | ✅ | .opencode/plugins/harness/에 orchestrator.ts 포함 동기화 |
| 2026-04-14 | Step 4E | 통합 스모크 테스트 | ✅ | 121/121 통과 (Phase Manager + Error Recovery + QA Tracker + Agent Registration + Orchestrator Plugin) |
| 2026-04-14 | Step 4E | 전체 회귀 (Step 1+3+4) | ✅ | 기존 테스트 전원 통과 |
| 2026-04-14 | A1 | 구조화된 로깅 구현 | ✅ | logger.ts 신규 + 전 모듈 console.error/warn → logger 교체 (6곳) |
| 2026-04-14 | A1 | logEvent → logger 리다이렉트 | ✅ | 기존 logEvent 호출은 harness.jsonl로 자동 리다이렉트 |
| 2026-04-14 | A1 | HARNESS_LOG_LEVEL 환경변수 | ✅ | debug/info/warn/error 4레벨, 기본 info |
| 2026-04-14 | A2 | Config 시스템 구현 | ✅ | schema.ts + loader.ts 신규. JSONC 파싱 + 글로벌/프로젝트 병합 |
| 2026-04-14 | A2 | 에이전트 config 오버라이드 | ✅ | agents.ts applyOverrides()로 model/temperature/hidden 오버라이드 |
| 2026-04-14 | A2 | enforcer/improver/error-recovery/qa-tracker config 연동 | ✅ | 각 모듈에 settings 파라미터 전달 |
| 2026-04-14 | A3 | Hooks 보강 | ✅ | delegate-task-retry, json-error-recovery, post-file-tool-nudge, post-read-nudge, phase-reminder |
| 2026-04-14 | A3 | createAllHooks() + 다중 핸들러 병합 | ✅ | hooks/index.ts에서 createAllHooks()로 일괄 생성 |
| 2026-04-14 | A1~A3 | 전체 스모크 테스트 (247/247) | ✅ | smoke 21 + step3 50 + step4 121 + error-recovery 24 + phase-manager 22 + session-lock 9 |
| 2026-04-14 | A1~A3 | npm run build | ✅ | 타입 에러 없음 |
| 2026-04-14 | A1~A3 | 로컬 플러그인 동기화 | ✅ | rsync로 src/ → .opencode/plugins/harness/ 싱크 |
| 2026-04-14 | A1~A3 | harness.jsonc 설정 파일 생성 | ✅ | .opencode/harness.jsonc에 에이전트 model/temperature/hidden + 임계값 |
| 2026-04-15 | B1+B2 | AgentOverrideConfig 확장 | ✅ | ModelEntry, variant, skills, mcps, options, prompt, append_prompt, FallbackConfig |
| 2026-04-15 | B1+B2 | parseList() 유틸리티 | ✅ | `*`/`!name` 글로브 문법으로 skills/mcps 파싱 |
| 2026-04-15 | B1+B2 | applyOverrides 리팩토링 | ✅ | model 배열, FallbackChain, 커스텀 프롬프트, options, variant |
| 2026-04-15 | B1+B2 | MCP/Skills permission 자동 생성 | ✅ | config 콜백에서 mcps→permission.{mcp}_* 자동 설정 |
| 2026-04-15 | B1+B2 | 전체 스모크 테스트 (232/232) | ✅ | smoke 29 + step3 50 + step4 153 |
| 2026-04-15 | B1+B2 | npm run build | ✅ | 타입 에러 없음 |
| 2026-04-15 | B3 | SubagentDepthTracker 구현 | ✅ | 메모리 Map 기반 depth 추적, max 초과 시 등록 거부 + logger.warn |
| 2026-04-15 | B3 | Observer에 depthTracker 통합 | ✅ | subagent.session.created/deleted 이벤트에 registerChild/cleanup 연동 |
| 2026-04-15 | B3 | HarnessSettings.max_subagent_depth | ✅ | schema.ts에 설정 추가, 기본값 3 |
| 2026-04-15 | B3 | smoke test — SubagentDepthTracker (8/8) | ✅ | 등록/깊이조회/cleanup/cleanupAll/max초과차단/커스텀maxDepth |
| 2026-04-15 | B3 | 전체 스모크 테스트 (248/248) | ✅ | smoke 29 + step3 50 + step4 169 |
| 2026-04-15 | B3 | npm run build | ✅ | 타입 에러 없음 |
| 2026-04-16 | Step 4f | stability follow-up smoke | ✅ | bounded compacting, foreground-fallback, filter-available-skills 회귀 없음 |
| 2026-04-16 | Step 4f | foreground-fallback same-session recovery | ✅ | retryable provider failure 시 abort + next model prompt_async 재프롬프트 확인 |
| 2026-04-16 | Step 4f | foreground-fallback chained continuation | ✅ | sync 이벤트 전에 chained fallback이 이어지는지 확인 |
| 2026-04-16 | Step 4f | foreground-fallback prompt_async failure rollback | ✅ | 재프롬프트 실패 시 fallback state advancement 없음 확인 |
| 2026-04-16 | Step 4f | fix_commit hardening | ✅ | source_file 금지 + fix_commit scope를 tool로 고정 |
| 2026-04-16 | Step 4f | npm run build | ✅ | 안정화 후속 반영 후 빌드 성공 |
| 2026-04-16 | Deploy Prep | deny_tools 스키마 + buildToolPermissions | ✅ | AgentOverrideConfig에 deny_tools 필드, buildToolPermissions() + config 콜백 병합 |
| 2026-04-16 | Deploy Prep | harness.jsonc deny_tools 예시 | ✅ | reviewer, advisor, explorer, librarian에 write/edit/patch/bash, designer에 bash |
| 2026-04-16 | Deploy Prep | README.md 모델/MCP/빠른시작 | ✅ | 권장 모델 매핑 테이블, 권장 MCP 서버, 빠른 시작 가이드 추가 |
| 2026-04-16 | Deploy Prep | AGENTS.md 배포 준비 상태 | ✅ | deny_tools ✅ 완료, 모델/MCP 📝 문서로 해결 |
| 2026-04-16 | Deploy Prep | smoke test — buildToolPermissions | ✅ | 빈 배열, undefined, 특정 도구, 여러 도구 테스트 |
| 2026-04-16 | Deploy Prep | smoke test — deny_tools 통합 | ✅ | config 콜백에서 deny_tools가 permission에 병합되는지 확인 |
| 2026-04-16 | Deploy Prep | npm run build | ✅ | 타입 에러 없음 |
| 2026-04-16 | fix_commit 패턴 추출 수정 | detectFixCommits에서 source_file을 패턴으로 사용 금지 | ✅ | "수정한 파일 = 수정 금지 파일" 논리적 오류 수정. pattern을 커밋 메시지로 변경, source_file을 빈 문자열로 설정 |
| 2026-04-16 | fix_commit scope 수정 | mapSignalTypeToScope('fix_commit')을 'file' → 'tool'로 변경 | ✅ | 파일 경로 패턴 매칭으로 인한 설정 파일 차단 방지 |
| 2026-04-16 | fix_commit 테스트 | smoke-test.ts에 5개 신규 테스트 | ✅ | 43/43 통과 (기존 38 + source_file 금지 5) |
