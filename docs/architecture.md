# System Architecture

## Overview

**harness-orchestration**은 Hugh Kim의 하네스/오케스트레이션 아키텍처를 OpenCode 플러그인으로 재구현한 프로젝트다. 단일 에이전트 품질 제어(하네스)부터 멀티 에이전트 조율(오케스트레이션)까지 점진적으로 구축했다.

- **진실의 원천:** `docs/v3-final.md`. 구현 시 v3-final이 항상 우선.
- **핵심 원칙:** 파일 = 진실. DB/IPC 없이 파일 시스템만으로 상태 관리. `~/.config/opencode/harness/`가 유일한 진실의 원천.
- **배포 형태:** 단일 npm 패키지, 다중 플러그인 export.

---

## Build Roadmap

| Step | 내용 | 플러그인 | 상태 |
|------|------|----------|------|
| 1 | 하네스 초안 | observer + enforcer | ✅ 완료 |
| 2 | 하네스 고도화 | + improver | ✅ 완료 |
| 3 | 브릿지 | `.opencode/rules/` + Memory Index/Search + history 로테이션 | ✅ 완료 |
| 4 | 오케스트레이션 | + orchestrator (에러 복구, 서브에이전트 라우팅) | ✅ 완료 |
| 5a~5h | Shadow/Guarded-Off 인프라 | canary + ack plane + candidate grouping | ✅ 완료 (전부 default-off 또는 passive-only) |

---

## Maturity Model (L1~L6)

하네스는 6단계 성숙도 모델로 구성된다. 각 Level은 이전 Level 위에 구축된다.

| Level | 의미 | 구현 | 담당 모듈 |
|-------|------|------|-----------|
| L1 | 관측 가능성 | 도구 실행 이벤트를 JSONL로 로깅 | `observer.ts` |
| L2 | 신호 변환 | 에러 반복, 사용자 불만, fix 커밋 → Signal 생성 | `observer.ts` |
| L3 | 프로젝트 격리 | `project_key` 기반 상태 분리 | `enforcer.ts` |
| L4 | 규칙 차단 | HARD rule 매칭 시 도구 실행 차단 | `enforcer.ts` |
| L5 | 자동 수정 | Signal → 규칙 자동 변환 (signalToRule) | `improver.ts` |
| L6 | 폐루프 | 30일 효과 측정 + 승격/유지 판정 | `improver.ts` |

---

## Harness Layer

### Observer (`src/harness/observer.ts`)

Observer는 L1(관측)과 L2(신호 변환)를 담당하는 하네스의 첫 번째 계층이다.

**L1: 이벤트 로깅**
- 도구 실행 이벤트를 JSONL 파일(`history.jsonl`)에 기록
- 세션 메타데이터(시작 시간, project_key 등) 관리

**L2: Signal 생성**
- `error_repeat`: 동일 에러 메시지가 3회 이상 반복 시 Signal 생성
- `user_feedback`: 11개 한국어 불만 키워드 매칭 시 Signal 생성
- `fix_commit`: `git log --since=<session_start>`로 fix: 커밋 감지 후 Signal 생성

**Signal 생성 흐름:**
```
이벤트 관측 → 패턴 매칭 (에러 반복/불만 키워드/fix 커밋)
    → pending/{id}.json에 Signal 저장
```

**세션 락:** `session.created`에서 PID 파일로 동일 프로젝트의 동시 세션을 차단한다.

**서브에이전트 깊이 추적:** `SubagentDepthTracker`로 max depth 초과 시 차단한다.

---

### Enforcer (`src/harness/enforcer.ts`)

Enforcer는 L4(HARD 차단)와 SOFT 위반 추적을 담당한다.

**HARD 차단:** `tool.execute.before` 훅에서 rule 매칭 시 도구 실행을 차단한다.

**SOFT 위반 추적:** 위반 시 `violation_count`를 증가시킨다.

**scope:prompt 규칙:** 위반 추적에서 제외되며, 승격 대상이 아니다.

> **중요:** enforcer는 오직 L4 차단만 담당한다. L5 자가개선은 improver의 역할이다.

---

### Improver (`src/harness/improver.ts`)

Improver는 L5(자동 수정)와 L6(폐루프)를 담당하는 하네스의 세 번째 계층이다.

#### 3개 피드백 루프

Hugh Kim의 원본 설계에서 도출된 3개의 피드백 루프:

| 루프 | 이름 | 트리거 | 처리 | 산출물 |
|------|------|--------|------|--------|
| Loop 1 | Reactive | `fix:` 커밋 | diff 분석 → 패턴 추출 | scaffold NEVER DO 자동 추가 |
| Loop 2 | Proactive | 사용자 불만 키워드 | feedback.jsonl → 근본 원인 분석 | SOFT 규칙 자동 생성 |
| Loop 3 | Meta | 30일 경과 | 효과 평가 | 승격/경고/유지 |

#### Signal → Rule → Enforcement 파이프라인

```
Signal 생성 (observer)
    ↓ pending/{id}.json
session.idle에서 improver가 자동 처리
    ↓ signalToRule()
SOFT 규칙 생성 (rules/soft/{id}.json)
    ↓ 위반 2회 재발
HARD 승격 (rules/hard/{id}.json)
    ↓
도구 실행 차단 (enforcer)
```

#### 규칙 생명주기

- **SOFT → HARD 자동 승격:** `violation_count ≥ 2` 시 자동 승격
- **승격 시 violation_count 리셋:** delta 기반 측정을 위해 카운터 초기화
- **규칙 중복 방지:** `signalToRule()`에서 `soft/` + `hard/` 양쪽을 체크하여 동일 패턴의 중복 규칙 생성을 방지
- **scope:prompt 규칙:** `.opencode/rules/`에 마크다운으로 병행 노출 (`syncRulesMarkdown`)
- **30일 효과 측정:** `evaluateRuleEffectiveness()` — delta 기반 (누적값이 아닌 마지막 측정 이후 증분으로 판정)

#### Compacting (컨텍스트 주입)

- `experimental.session.compacting` 훅에서 동작
- scaffold + HARD 규칙 + SOFT 규칙을 세션 컨텍스트에 주입
- `scope:prompt` 규칙은 세션 시작부터 `.opencode/rules/`에 노출되어, compacting이 발동하지 않는 짧은 세션에서도 에이전트가 규칙을 인지

---

### Canary (`src/harness/canary.ts`)

Step 5f에서 추가된 metadata-based canary evaluation 모듈이다.

- **default-off:** `canary_enabled = false` 상태로 시작
- **동작:** deterministic 판정과 메타데이터 기반 평가를 비교
- **불일치 기록:** mismatch 발생 시 `canary-mismatches.jsonl`에 append
- **집계 리포트:** mismatch율, 패턴별 분포, 승격 후보 판정을 제공
- **LLM 호출 없음:** 플러그인 훅에서 LLM을 직접 호출할 수 없는 제약 때문에, 메타데이터 기반 평가만 수행

---

## Orchestration Layer

### Orchestrator (`src/orchestrator/orchestrator.ts`)

최상위 라우터. 모든 요청이 먼저 여기로 들어온다.

- **판단 로직:** 대화/단순 조회 → 직접 처리, 구현/복잡 작업 → specialist 에이전트에게 위임
- **워크플로우:** OpenCode의 superpowers 스킬 체인으로 관리
- **Phase 관리 시스템:** Simplify 리팩터링에서 제거됨 (`phase-manager.ts`, `phase-reminder.ts` 삭제). 이유는 builder 에이전트 삭제 후 아무도 호출하지 않는 데드 인프라였기 때문.

---

### Agent Roster (10개)

| 에이전트 | 역할 | 권한 |
|----------|------|------|
| orchestrator | 최상위 라우터 | 읽기/쓰기 |
| frontend | UI/styling 구현 | 읽기/쓰기 |
| backend | 서버/비즈니스 로직 | 읽기/쓰기 |
| tester | 테스트 작성/실행 | 읽기/쓰기 |
| reviewer | 읽기 전용 코드 리뷰 | 읽기 전용 |
| designer | UI/UX 아이디어, DESIGN.md | 읽기/쓰기 |
| explorer | 읽기 전용 코드베이스 탐색 | 읽기 전용 |
| librarian | 읽기 전용 외부 문서 조사 | 읽기 전용 |
| coder | 기계적 편집 전문 | 읽기/쓰기 |
| advisor | 읽기 전용 전략 자문 | 읽기 전용 |

- **등록 방식:** 플러그인 config 콜백에서 자동 등록 (`opencode.json` 수동 수정 불필요)
- **프롬프트:** `src/agents/prompts/*.md`에 내장
- **도구 권한:** `buildToolPermissions()`로 에이전트별 deny 리스트 적용

---

### Error Recovery (`src/orchestrator/error-recovery.ts`)

5단계 에스컬레이션 구조:

| 단계 | 방법 | 내용 |
|------|------|------|
| 1차 | 직접 수정 | 타입 정의, import 경로, 로직 수정 |
| 2차 | 구조 변경 | 타입 가드, optional chaining, 대안 라이브러리 |
| 3차 | 다른 모델 rescue | 완전히 다른 접근으로 재시도 |
| 4차 | 리셋 | revert 후 다른 구현 방식으로 재시도 |
| 5차 | 사용자 에스컬레이션 | 4차까지 실패 시 사용자에게 보고 |

---

### QA Tracker (`src/orchestrator/qa-tracker.ts`)

- QA 시나리오별 실패 추적
- 반복 검출: 동일 에러 패턴 재발 시 에스컬레이션

---

## Memory System

### 하위 3단계 (본 경로, 활성)

하위 3단계는 현재 활성 경로다.

| 단계 | 동작 | 산출물 |
|------|------|--------|
| **Sync** | observer가 세션 종료 시 JSONL을 `memory/archive/`에 복사 | `{session_id}.jsonl` |
| **Index** | JSONL → 키워드 인덱스 | `projects/{key}/memory/index/` |
| **Search** | 키워드 기반 회수 | `projects/{key}/memory/search/` |
| **history.jsonl 로테이션** | 파일 크기 체크 + 일정 크기 초과 시 rotate | 로테이션된 아카이브 |

### 상위 4단계 (shadow/candidate, 비활성)

| 단계 | 현재 상태 | 설명 |
|------|----------|------|
| **Extract** | shadow only (`memory-upper-shadow.jsonl`) | 세션에서 결정/선호/제약 추출 후보만 기록 |
| **Consolidate** | 미구현 | 중복/충돌/진화 정리 |
| **Relate** | 미구현 | fact 간 관계 연결 |
| **Recall** | 미구현 | 다양한 회수 경로 |

상위 4단계는 데이터 충분히 축적 후 활성화 예정. 자세한 승격 기준은 `docs/roadmap.md` 참조.

---

## Shadow / Guarded-Off System

### 공통 원칙

Step 5a~5h의 모든 기능은 다음 4가지 원칙을 따른다:

1. **기본값은 끈다:** 새 기능은 default-off. 설정이 없으면 기존 결정적 경로가 그대로 동작.
2. **먼저 그림자 모드:** 기존 결과는 유지, 후보 결과만 별도 저장. 오답/비용/토큰 사용량 비교.
3. **가드 통과 후 반영:** 삭제/승격 등 되돌리기 어려운 동작은 샘플 수 + 일치율 + 오탐률 충족 후에만.
4. **파일이 진실, 이력은 증거:** 현재 상태는 얇은 JSON/JSONL, 판단 근거는 append-only 로그.

### Step 5a~5h 구현 현황

| Step | 내용 | 상태 |
|------|------|------|
| 5a | Foundation: phase/signal shadow, diff 실수 shadow, ack written/accepted 로그 | ✅ 완료 |
| 5b | Extract shadow + compacting relevance shadow/default-off | ✅ 완료 |
| 5c | Rule lifecycle 후보 경로 (`prune_candidate`, cross-project candidates) | ✅ 완료 |
| 5d | auto-update-checker (default-off, warn-only, 24h 쿨다운) | ✅ 완료 |
| 5e | Mistake pattern candidate grouping (`computePatternIdentity`, threshold=3) | ✅ 완료 |
| 5f | Metadata-based canary evaluation (`canary_enabled=false`, mismatches.jsonl) | ✅ 완료 |
| 5g | Compacting canary evaluation (`compacting_canary_enabled=false`) | ✅ 완료 |
| 5h | Ack acceptance plane — 3-check evaluator (`rule_written`, `rule_valid`, `not_prune_candidate`) | ✅ 완료 |

### 현재 활성화 상태

**모든 5a~5h 기능은 default-off 또는 passive-only.** 본 경로 롤아웃은 아직 아니다.
승격 판단 기준과 근거는 `docs/roadmap.md` 참조.

---

## Hooks (7개)

| 훅 | 파일 | 역할 |
|----|------|------|
| `delegate-task-retry` | `hooks/delegate-task-retry.ts` | 서브에이전트 위임 실패 감지 + 재시도 가이드 |
| `json-error-recovery` | `hooks/json-error-recovery.ts` | JSON 파싱 에러 감지 + 수정 프롬프트 주입 |
| `post-file-tool-nudge` | `hooks/post-file-tool-nudge.ts` | 파일 조작 후 위임 넛지 |
| `post-read-nudge` | `hooks/post-read-nudge.ts` | 파일 읽기 후 위임 넛지 |
| `foreground-fallback` | `hooks/foreground-fallback.ts` | same-session reactive fallback (rate limit 등) |
| `filter-available-skills` | `hooks/filter-available-skills.ts` | 에이전트별 스킬 노출 필터 |
| `auto-update-checker` | `hooks/auto-update-checker.ts` | npm 배포 후 버전 확인 (default-off, 24h 쿨다운) |

---

## Config System (`src/config/`)

- **JSONC/JSON 파일 로더:** 주석이 포함된 JSONC 파일도 파싱 가능
- **병합:** 글로벌(`~/.config/opencode/harness.jsonc`) + 프로젝트(`.opencode/harness.jsonc`) 병합
- **에이전트별 오버라이드:** `model`, `temperature`, `hidden`, `variant`, `skills`, `mcps`, `options`, `prompt`, `append_prompt`, `deny_tools`
- **FallbackChain:** 모델 배열로 자동 폴백 지원

---

## npm 배포 인프라

### 필수 (전부 완료)

- config 시스템, hooks 보강 (7개), 구조화된 로깅, 에이전트 설정 확장, 서브에이전트 깊이 추적

### 준비 단계 (완료)

- 에이전트별 도구 deny 리스트 (`buildToolPermissions`)
- 모델 권장 매핑 (`README.md`로 문서 해결)
- MCP 설정 가이드 (`README.md`로 문서 해결)

---

## Key Design Decisions

이 프로젝트는 Hugh Kim의 원본 아키텍처를 OpenCode 플러그인 환경에 맞게 단순화했다. 주요 의식적 선택:

| 항목 | 원본 | v3 (현재) | 단순화 이유 |
|------|------|-----------|-------------|
| Phase 구조 | Phase 0~4 다단계 LLM 판정 | `signalToRule()` 결정적 코드 | 플러그인에서 LLM 호출 불가 + 비결정성 회피 |
| Cross-Project 승격 | 2개 프로젝트에서 동일 패턴 → global 자동 승격 | 수동 `project_key: 'global'` | 단일 프로젝트 환경, 오버엔지니어링 |
| Pruning | 효과 없는 규칙 자동 삭제 | 측정만 자동, 삭제는 수동 | 삭제 기준 오류 시 복구 불가 |
| Memory 상위 4단계 | 7단계 전체 구현 | 하위 3단계만 | 데이터 축적 선행 필요 |
| Event 훅 병합 | 스프레드 연산자 (v3 버그) | `mergeEventHandlers` 유틸리티 | 오라클 크로스 리뷰에서 발견한 CRITICAL 버그 수정 |

---

## File Structure

```
src/
├── index.ts                  # 플러그인 진입점
├── types.ts                  # 전체 타입 정의
├── harness/                  # 하네스 레이어
│   ├── observer.ts           # L1 관측 + L2 신호 변환
│   ├── enforcer.ts           # L4 HARD 차단 + SOFT 위반 추적
│   ├── improver.ts           # L5 자가개선 + L6 폐루프
│   └── canary.ts             # canary 평가 (shadow + mismatch)
├── orchestrator/             # 오케스트레이션 레이어
│   ├── orchestrator.ts       # 최상위 라우터
│   ├── error-recovery.ts     # 에러 복구 5단계
│   ├── qa-tracker.ts         # QA 실패 추적
│   └── subagent-depth.ts     # 서브에이전트 깊이 추적
├── agents/                   # 에이전트 정의 (10개)
│   ├── agents.ts
│   └── prompts/              # 에이전트 프롬프트
├── hooks/                    # 훅 모듈 (7개)
├── shared/                   # 공통 유틸리티
│   ├── utils.ts              # getProjectKey, ensureHarnessDirs, mergeEventHandlers, ...
│   ├── logger.ts             # 구조화된 로깅
│   ├── constants.ts          # HARNESS_DIR 등 상수
│   └── index.ts              # 배럴 export
└── config/                   # 설정 시스템 (JSONC 로더)
```

런타임 데이터 구조:
```
~/.config/opencode/harness/
├── projects/{project_key}/
│   ├── state.json            # 프로젝트 상태
│   ├── scaffold.md           # NEVER DO scaffold
│   ├── rules/
│   │   ├── soft/{id}.json    # SOFT 규칙
│   │   └── hard/{id}.json    # HARD 규칙
│   ├── pending/{id}.json     # 처리 대기 Signal
│   ├── ack/{id}.json         # 처리 완료 Signal
│   ├── history.jsonl         # 규칙 변경 이력
│   └── memory/
│       ├── archive/          # 세션 JSONL 아카이브
│       ├── index/            # 키워드 인덱스
│       └── search/           # 검색 결과
├── events.jsonl              # 이벤트 로그
└── sessions/                 # 세션 관리
```
