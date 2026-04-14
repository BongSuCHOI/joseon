# harness-orchestration

OpenCode 플러그인 기반 하네스(Harness) + 오케스트레이션(Orchestration) 시스템.

Hugh Kim의 [Self-Evolving System](https://hugh-kim.space/self-evolving-system.html) 아키텍처를 OpenCode 플러그인 시스템 위에 재구현합니다. 단일 에이전트 품질 제어부터 멀티 에이전트 조율까지 4단계로 점진적으로 구축합니다.

## 아키텍처

### 성숙도 모델 (L1~L6)

| Level | 의미 | 구현 상태 |
|-------|------|-----------|
| L1 | 관측 가능성 | ✅ observer |
| L2 | 신호 변환 | ✅ observer |
| L3 | 프로젝트 격리 | ✅ enforcer |
| L4 | 규칙 차단 | ✅ enforcer |
| L5 | 자동 수정 | ✅ improver |
| L6 | 폐루프 | ✅ improver |

### 4단계 로드맵

| Step | 내용 | 플러그인 | 상태 |
|------|------|----------|------|
| 1 | 하네스 초안 | observer + enforcer | ✅ 완료 |
| 2 | 하네스 고도화 | + improver | ✅ 완료 |
| 3 | 브릿지 | .opencode/rules/ 병행 + Memory Index/Search + history 로테이션 | ✅ 완료 |
| 4 | 오케스트레이션 | + orchestrator | ✅ 완료 — 4a~4E (통합 테스트 121/121 통과) |

### 핵심 원칙

- **파일 = 진실:** DB/IPC 없이 파일 시스템만으로 상태 관리 (`~/.config/opencode/harness/`)
- **SOFT → HARD 자동 승격:** 모든 규칙은 SOFT로 시작, 위반 2회 재발 시 HARD로 자동 승격
- **단일 패키지, 다중 export:** 4개 플러그인을 하나의 npm 패키지로 배포

## 설치

### 로컬 개발 (권장)

```bash
git clone <repo-url>
cd harness-orchestration
npm install
npm run build
```

### OpenCode에 로컬 플러그인으로 등록

`opencode.json`:

```json
{
  "plugin": ["./.opencode/plugins/harness"]
}
```

### npm 패키지로 설치

```json
{
  "plugin": ["my-harness"]
}
```

## 작동 방식

### 3개 피드백 루프

```
Loop 1 (Reactive):  fix: 커밋 → diff 분석 → scaffold NEVER DO 자동 추가
Loop 2 (Proactive): 사용자 불만 키워드 → signal → SOFT 규칙 자동 생성
Loop 3 (Meta):      30일 경과 규칙 → 효과 측정 → 승격/경고/유지
```

### Signal → Rule → Enforcement 흐름

```
이벤트 관측 (observer)
    ↓
Signal 생성 (pending/)
    ↓
session.idle에서 자동 처리 (improver)
    ↓
SOFT 규칙 생성 (rules/soft/)
    ↓
위반 2회 재발 시 HARD 승격 (rules/hard/)
    ↓
도구 실행 차단 (enforcer)
```

### 플러그인 구성

| 플러그인 | 파일 | 역할 |
|----------|------|------|
| **observer** | `src/harness/observer.ts` | L1 도구 실행 로깅 + L2 에러/불만 signal 생성 |
| **enforcer** | `src/harness/enforcer.ts` | L4 HARD 차단 + SOFT 위반 추적 + scaffold NEVER DO |
| **improver** | `src/harness/improver.ts` | L5 signal→규칙 변환 + fix: 커밋 학습 + L6 승격/효과측정 + compacting 컨텍스트 주입 + .opencode/rules/ 마크다운 동기화 + Memory Index/Search |
| **phase-manager** | `src/orchestrator/phase-manager.ts` | Phase 상태 파일 관리 + Phase 2.5 gate + PID 세션 락 (Step 4a) |
| **agents** | `src/agents/agents.ts` + `src/agents/prompts/` | 9개 에이전트 정의 + config 콜백 자동 등록 (Step 4b) |
| **error-recovery** | `src/orchestrator/error-recovery.ts` | 에러 복구 5단계 에스컬레이션 (Step 4c) |
| **qa-tracker** | `src/orchestrator/qa-tracker.ts` | QA 시나리오별 실패 추적, 3회 시 에스컬레이션 (Step 4c) |
| **orchestrator** | `src/orchestrator/orchestrator.ts` | Plugin 4: session.idle Phase 정리 + 4개 플러그인 통합 진입점 (Step 4D) |
| **config** | `src/config/` | JSONC/JSON 설정 로더 + 글로벌/프로젝트 병합 + 에이전트 오버라이드 |
| **hooks** | `src/hooks/` | 위임 재시도, JSON 에러 복구, 파일/읽기 넛지, Phase 리마인더 |

## 런타임 데이터

모든 상태는 `~/.config/opencode/harness/`에 파일로 관리됩니다.

```
~/.config/opencode/harness/
├── logs/
│   ├── harness.jsonl       # 통합 로그 (구조화된 로깅, 4레벨)
│   ├── sessions/           # 세션 로그 + session_start 타임스탬프
│   └── errors/             # 에러 로그 (JSONL)
├── signals/
│   ├── pending/            # 대기 중인 signal
│   └── ack/                # 처리 완료된 signal
├── rules/
│   ├── soft/               # SOFT 규칙 (위반 추적만)
│   ├── hard/               # HARD 규칙 (실행 차단)
│   └── history.jsonl       # 규칙 생성/승격 이력
├── scaffold/               # scaffold 파일 (global.md)
├── memory/
│   ├── facts/              # Memory Index — 추출된 키워드 fact
│   └── archive/            # 세션 아카이브
├── projects/
│   ├── {key}/
│   │   ├── state.json      # 프로젝트 상태
│   │   └── .session-lock   # PID 세션 락 (동시 실행 방지)
│   └── ...

# 설정 파일 (JSONC 우선 + JSON 폴백)
~/.config/opencode/harness.jsonc          # 글로벌 설정
{project}/.opencode/harness.jsonc         # 프로젝트 설정 (우선)

# Phase 상태 (프로젝트 worktree 내부)
{project}/.opencode/orchestrator-phase.json   # Phase 1~5 상태 + 이력
```

## 개발

```bash
# 빌드
npm run build

# 소스 수정 후 로컬 플러그인에 동기화
rsync -av --exclude='__tests__' src/ .opencode/plugins/harness/
```

자세한 개발/테스트 절차는 [`docs/development-guide.md`](docs/development-guide.md)를 참조.

## 프로젝트 구조

```
src/
├── index.ts                     # 플러그인 진입점 (loadConfig + createAllHooks + 4개 플러그인 병합 + config 콜백)
├── types.ts                     # Signal, Rule, ProjectState, PhaseState, QAFailures, EvalResult 타입 정의
├── config/                      # A2: 설정 시스템
│   ├── schema.ts                # HarnessConfig, AgentOverrideConfig, HarnessSettings + defaults
│   ├── loader.ts                # JSONC/JSON 로더 + 글로벌/프로젝트 병합
│   └── index.ts                 # 배럴 export
├── hooks/                       # A3: 훅 모듈
│   ├── delegate-task-retry.ts    # 서브에이전트 위임 실패 감지 + 재시도 가이드
│   ├── json-error-recovery.ts    # JSON 파싱 에러 감지 + 수정 프롬프트 주입
│   ├── post-file-tool-nudge.ts   # 파일 조작 후 위임 넛지
│   ├── post-read-nudge.ts        # 파일 읽기 후 위임 넛지
│   ├── phase-reminder.ts         # builder 에이전트 Phase 리마인더
│   └── index.ts                  # createAllHooks() + 핸들러 병합
├── shared/
│   ├── constants.ts             # HARNESS_DIR 경로 상수
│   ├── utils.ts                 # getProjectKey, ensureHarnessDirs, mergeEventHandlers, rotateHistoryIfNeeded
│   ├── logger.ts                # 구조화된 로깅 (debug/info/warn/error + HARNESS_LOG_LEVEL)
│   └── index.ts                 # 배럴 export
├── harness/
│   ├── observer.ts              # Plugin 1: L1 관측 + L2 신호 변환 + PID 세션 락
│   ├── enforcer.ts              # Plugin 2: L4 HARD 차단 + SOFT 위반 추적
│   └── improver.ts              # Plugin 3: L5 자가개선 + L6 폐루프
├── orchestrator/
│   ├── orchestrator.ts          # Plugin 4: session.idle Phase 정리 (Step 4D)
│   ├── phase-manager.ts         # Phase 상태 관리 + Phase 2.5 gate (Step 4a)
│   ├── error-recovery.ts        # 에러 복구 5단계 에스컬레이션 (Step 4c)
│   └── qa-tracker.ts            # QA 시나리오별 실패 추적 (Step 4c)
└── agents/
    ├── agents.ts                # 에이전트 빌더 + config 오버라이드 적용 (Step 4b)
    └── prompts/                 # 11개 에이전트 프롬프트
        ├── orchestrator.md
        ├── builder.md
        ├── frontend.md
        ├── backend.md
        ├── tester.md
        ├── reviewer.md
        ├── advisor.md
        ├── designer.md
        ├── explorer.md
        ├── librarian.md
        └── coder.md
```

## 참고

- [OpenCode Plugins](https://opencode.ai/docs/plugins/) — 플러그인 구조, 훅 목록
- [OpenCode Agents](https://opencode.ai/docs/agents/) — 에이전트 타입, 서브에이전트
- [Self-Evolving System](https://hugh-kim.space/self-evolving-system.html) — 원본 아키텍처
- [`docs/opencode-harness-orchestration-guide-v3-final.md`](docs/opencode-harness-orchestration-guide-v3-final.md) — 구현 가이드 (유일한 진실의 원천)
