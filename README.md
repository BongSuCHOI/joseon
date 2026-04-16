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
| 4 | 오케스트레이션 | + orchestrator | ✅ 완료 — 4a~4f (stability follow-up 포함, 통합 테스트 248/248 통과). Step 5a foundation도 구현/검증 완료 |

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
| **improver** | `src/harness/improver.ts` | L5 signal→규칙 변환 + fix: 커밋 학습/하드닝 + bounded compacting + L6 승격/효과측정 + .opencode/rules/ 마크다운 동기화 + Memory Index/Search |
| **phase-manager** | `src/orchestrator/phase-manager.ts` | Phase 상태 파일 관리 + Phase 2.5 gate + PID 세션 락 (Step 4a) |
| **agents** | `src/agents/agents.ts` + `src/agents/prompts/` | 11개 에이전트 정의 + config 콜백 자동 등록 (Step 4b) |
| **error-recovery** | `src/orchestrator/error-recovery.ts` | 에러 복구 5단계 에스컬레이션 (Step 4c) |
| **qa-tracker** | `src/orchestrator/qa-tracker.ts` | QA 시나리오별 실패 추적, 3회 시 에스컬레이션 (Step 4c) |
| **orchestrator** | `src/orchestrator/orchestrator.ts` | Plugin 4: session.idle Phase 정리 + 4개 플러그인 통합 진입점 (Step 4D~4f) |
| **config** | `src/config/` | JSONC/JSON 설정 로더 + 글로벌/프로젝트 병합 + 에이전트 오버라이드 |
| **hooks** | `src/hooks/` | 위임 재시도, JSON 에러 복구, 파일/읽기 넛지, Phase 리마인더, foreground-fallback(reactive same-session recovery), filter-available-skills |

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
│   │   ├── state.json               # 프로젝트 상태
│   │   ├── phase-signal-shadow.jsonl # phase/signal 그림자 로그
│   │   ├── mistake-pattern-shadow.jsonl # diff 실수 요약 그림자 로그
│   │   ├── ack-status.jsonl          # written/accepted ack 상태 로그
│   │   ├── foreground-fallback.json # 세션별 폴백 상태
│   │   └── .session-lock            # PID 세션 락 (동시 실행 방지)
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
│   ├── foreground-fallback.ts    # abort + prompt_async 재프롬프트로 same-session 복구
│   ├── filter-available-skills.ts # 에이전트별 스킬 노출 필터
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
│   ├── orchestrator.ts          # Plugin 4: session.idle Phase 정리 (Step 4D~4f)
│   ├── phase-manager.ts         # Phase 상태 관리 + Phase 2.5 gate (Step 4a)
│   ├── error-recovery.ts        # 에러 복구 5단계 에스컬레이션 (Step 4c)
│   └── qa-tracker.ts            # QA 시나리오별 실패 추적 (Step 4c)
└── agents/
    ├── agents.ts                # 11개 에이전트 빌더 + config 오버라이드 적용 (Step 4b)
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

## 권장 모델 매핑

에이전트별 권장 모델 설정입니다. `.opencode/harness.jsonc`에서 오버라이드할 수 있습니다.

| 에이전트 | 권장 모델 | 설명 |
|----------|-----------|------|
| orchestrator | glm-5-turbo (빠른 추론) | 판단/라우팅에 최적화. 응답 속도 중요 |
| builder | glm-5.1 (고품질) | Phase 관리 + 서브에이전트 분배. 정확성 중요 |
| frontend | glm-4.7 | 프론트엔드 구현 |
| backend | glm-4.7 | 백엔드 구현 |
| tester | glm-4.7 | QA 테스트 |
| coder | glm-4.7 | 기계적 실행 (빠른 타이핑) |
| reviewer | glm-5.1 (고품질) | 코드 리뷰. 정확한 분석 필요 |
| advisor | glm-5.1 (고품질) | 아키텍처 자문. 심층 분석 필요 |
| designer | glm-4.7 (temperature 0.7) | UI/UX 기획. 창의성 필요 |
| explorer | glm-4.7 | 코드베이스 검색 |
| librarian | glm-4.7 | 외부 문서 조사 |

> **참고:** 모델은 `.opencode/harness.jsonc`에서 자유롭게 변경 가능. FallbackChain(`"model": ["a", "b"]`)은 retryable provider 실패 시 같은 세션에서 다음 모델로 재프롬프트하는 reactive fallback을 지원.

## 권장 MCP 서버

### 필수 (librarian 전용)

| MCP 서버 | 용도 | 설치 |
|----------|------|------|
| **context7** | 라이브러리 문서 조회 | `opencode.json`의 `mcp.server`에 추가 |
| **grep_app** | 코드 검색 (ripgrep 클라우드) | `opencode.json`의 `mcp.server`에 추가 |
| **web-search-prime** | 웹 검색 | `opencode.json`의 `mcp.server`에 추가 |
| **web-reader** | URL→텍스트 변환 | `opencode.json`의 `mcp.server`에 추가 |
| **zread** | GitHub 리포지토리 문서/코드 검색 | `opencode.json`의 `mcp.server`에 추가 |

### 권장 (전체 에이전트용)

| MCP 서버 | 용도 |
|----------|------|
| **zai-mcp-server** | 스크린샷 분석, UI→코드 변환, 에러 진단 |

`opencode.json` 예시:

```json
{
  "mcp": {
    "server": {
      "context7": { "command": "npx", "args": ["-y", "@upstreamapi/context7"] },
      "grep_app": { "command": "npx", "args": ["-y", "@anthropic/grep-app-mcp"] }
    }
  }
}
```

> 플러그인은 MCP 서버를 직접 등록할 수 없으므로, `opencode.json`에 수동으로 추가해야 합니다. harness.jsonc의 `mcps` 필드로 각 에이전트의 접근 권한을 제어합니다.

## 빠른 시작

### 1. 설치

```bash
git clone <repo-url>
cd harness-orchestration
npm install
npm run build
```

### 2. OpenCode에 플러그인 등록

`opencode.json` (또는 `.opencode/opencode.json`):

```json
{
  "plugin": ["./.opencode/plugins/harness"]
}
```

### 3. 설정 파일 작성
`.opencode/harness.jsonc`:

```jsonc
{
    "agents": {
        "orchestrator": {
            "model": "zai-coding-plan/glm-5-turbo",
            "skills": ["*"],
            "mcps": ["*"]
        },
        "builder": {
            "model": "zai-coding-plan/glm-5.1",
            "skills": ["writing-plans", "subagent-driven-development"]
        },
        "reviewer": {
            "model": "zai-coding-plan/glm-5.1",
            "deny_tools": ["write", "edit", "patch", "bash"]
        },
        "advisor": {
            "model": "zai-coding-plan/glm-5.1",
            "deny_tools": ["write", "edit", "patch", "bash"]
        }
    },
    "harness": {
        "soft_to_hard_threshold": 2,
        "escalation_threshold": 3
    }
}
```

### 4. 로컬 플러그인 동기화

```bash
npm run deploy
# 또는 수동: rsync -av --exclude='__tests__' src/ .opencode/plugins/harness/
```

### 5. OpenCode 실행

```bash
opencode
# orchestrator 에이전트가 기본으로 활성화됩니다.
# 대규모 작업은 @builder에게 자동 위임됩니다.
```

## 참고

- [OpenCode Plugins](https://opencode.ai/docs/plugins/) — 플러그인 구조, 훅 목록
- [OpenCode Agents](https://opencode.ai/docs/agents/) — 에이전트 타입, 서브에이전트
- [Self-Evolving System](https://hugh-kim.space/self-evolving-system.html) — 원본 아키텍처
- [`docs/opencode-harness-orchestration-guide-v3-final.md`](docs/opencode-harness-orchestration-guide-v3-final.md) — 구현 가이드 (유일한 진실의 원천)
