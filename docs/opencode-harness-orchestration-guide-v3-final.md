# OpenCode 커스텀 하네스 + 오케스트레이션 플러그인 구현 가이드

> 이 문서는 Hugh Kim의 하네스/오케스트레이션 아키텍처를 OpenCode 플러그인 시스템 위에 재구현하기 위한 상세 가이드다.
> 단일 에이전트 품질 제어(하네스)부터 멀티 에이전트 조율(오케스트레이션)까지 4단계로 점진적으로 구축한다.

---

## 목차

1. [핵심 개념 정의](#1-핵심-개념-정의)
2. [전체 아키텍처 개요](#2-전체-아키텍처-개요)
3. [공통 인프라: 공유 저장소 스키마](#3-공통-인프라-공유-저장소-스키마)
4. [Step 1 — 하네스 초안 (harness-observer + harness-enforcer)](#4-step-1--하네스-초안)
5. [Step 2 — 하네스 고도화 (harness-improver + 확장)](#5-step-2--하네스-고도화)
6. [Step 3 — 하네스↔오케스트레이션 브릿지](#6-step-3--하네스오케스트레이션-브릿지)
7. [Step 4 — 오케스트레이션 구현 (harness-orchestrator)](#7-step-4--오케스트레이션-구현)
8. [참고 문서 인덱스](#8-참고-문서-인덱스)

---

## 1. 핵심 개념 정의

### 하네스(Harness)와 오케스트레이션(Orchestration)의 구분

이 구분을 명확히 하지 않으면 구현 과정에서 관심사가 섞여 구조가 무너진다.

**하네스**는 단일 에이전트의 실행을 감싸는 외부 장치다.
세션/턴 인터셉트, 실행 관측, 규칙 기반 차단, 자동 규칙 생성, 자가개선 폐루프가 하네스의 영역이다.
하네스는 에이전트가 "하나"일 때도 독립적으로 가치를 제공한다.

**오케스트레이션**은 복수의 에이전트를 하나의 목적으로 조율하는 제어 흐름이다.
역할별 에이전트 분리, 서브에이전트 위임, 병렬 실행, 스킬/툴 주입, 태스크 분배와 결과 합산이 오케스트레이션의 영역이다.

**왜 하네스를 먼저 구현하는가:**
오케스트레이션에서 서브에이전트를 띄우면, 각 서브에이전트가 하네스의 통제를 받는 구조가 된다.
하네스가 먼저 있으면 어떤 에이전트를 띄우든 품질 보장이 자동으로 따라온다.
반대로 하네스 없이 오케스트레이션부터 만들면, 서브에이전트마다 품질 제어를 개별로 구현해야 한다.

> **참고:** Hugh Kim도 하네스(hook, scaffold, 자가개선 폐루프)를 먼저 구축한 뒤 오케스트레이션(manager-orchestrator)을 얹었다.

### L1~L6 레이어 모델

Hugh Kim이 정의한 하네스 성숙도 모델이다. 각 레벨은 이전 레벨을 전제로 한다.

| Level | 의미          | 구현 목표                                                                 |
| ----- | ------------- | ------------------------------------------------------------------------- |
| L1    | 관측 가능성   | 세션, 도구 사용, 실패가 구조화된 로그로 남는다                            |
| L2    | 신호 변환     | 로그에서 actionable signal을 추출한다 (fix: 커밋, 에러 반복, 사용자 불만) |
| L3    | 프로젝트 격리 | pending, ack, 상태 파일이 프로젝트별로 분리된다                           |
| L4    | 규칙 차단     | 규칙이 실제로 에이전트 행동을 변경한다 (경고가 아닌 차단)                 |
| L5    | 자동 수정     | 시스템이 스스로 수정안을 만들고 검증한다                                  |
| L6    | 폐루프        | 감지→수정→acceptance→ack가 사람 개입 없이 닫힌다                          |

> **참고 문서:**
>
> - L1~L6 정의 및 충족 분석: [claude-code-harness-system.html](https://hugh-kim.space/claude-code-harness-system.html)
> - Codex 환경 practical L6: [codex-loop-era-l6.html](https://hugh-kim.space/codex-loop-era-l6.html)

### SOFT→HARD 자동 승격

모든 규칙은 SOFT로 시작한다. SOFT 규칙은 프롬프트 주입이므로 에이전트가 무시할 수 있다.
같은 위반이 2회 이상 재발하면 HARD로 승격된다. HARD 규칙은 hook에서 실행을 차단(throw Error / exit)하므로 에이전트가 우회할 수 없다.

이 메커니즘이 하네스의 핵심 차별점이다. 일반 설정 시스템은 규칙이 SOFT로 영원히 남지만, 이 하네스는 재발에 비례하여 강제력이 자동으로 올라간다.

**승격 흐름:** enforcer가 SOFT 규칙 위반을 감지 → violation_count 증가 (차단하지는 않음) → violation_count ≥ 2가 되면 improver가 HARD로 승격 → 이후 동일 패턴은 enforcer가 throw Error로 차단.

**예외: scope: 'prompt' 규칙은 승격 대상이 아니다.** 행동 패턴("떠넘기기", "거짓 보고" 등)은 도구 실행 시점에 위반을 감지할 수 없다. 이 규칙들은 `experimental.session.compacting` 훅으로 컨텍스트에 주입되어 에이전트에게 인지시키는 방식으로만 강제된다. Hugh Kim의 harsh-critic도 행동 패턴을 코드 패턴과 다른 별도 방어선으로 분류했다.

> **참고 문서:** SOFT→HARD 승격 상세: [self-evolving-system.html](https://hugh-kim.space/self-evolving-system.html)

### 3개 피드백 루프와 구현 단계

Hugh Kim의 자가개선 시스템은 3개의 피드백 루프로 구성된다. **모든 루프가 Step 1에서 동시에 구현되는 것이 아니다:**

| 루프 | 설명 | 구현 시점 |
|------|------|-----------|
| Loop 1 — Reactive (실수 학습) | fix: 커밋 감지 → diff 분석 → scaffold 추가 | **Step 2 기본** |
| Loop 2 — Proactive (불만 학습) | 사용자 불만 키워드 → 규칙 생성 | **Step 1 + Step 2** (signal 생성은 Step 1, 규칙 변환은 Step 2) |
| Loop 3 — Meta (효과 검증) | 30일 경과 → 효과 평가 → 승격/폐기 | **Step 2** |

Step 1에서 동작하는 것은 **에러 반복 감지 + HARD/SOFT 규칙 차단 + SOFT 위반 추적**이다. 자동 규칙 생성과 폐루프는 Step 2(improver)부터 동작한다.

> **참고 문서:** 3개 피드백 루프 상세: [self-evolving-system.html](https://hugh-kim.space/self-evolving-system.html)

---

## 2. 전체 아키텍처 개요

### 플러그인 구성

4개의 독립 플러그인이 레이어별로 분리되며, 공유 저장소(파일 시스템)를 통해 데이터를 교환한다.

```
┌─────────────────────────────────────────────────────────┐
│  OpenCode Runtime                                       │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Plugin 4: harness-orchestrator (Step 4)        │    │
│  │  역할: 멀티 에이전트 태스크 분배·조율            │    │
│  │  훅: event, tool.execute.before                 │    │
│  └──────────────────────┬──────────────────────────┘    │
│                         │ task() 호출                    │
│  ┌──────────────────────▼──────────────────────────┐    │
│  │  Plugin 3: harness-improver (Step 2)            │    │
│  │  역할: 자가개선 워커, SOFT→HARD 승격, 폐루프     │    │
│  │  훅: event, experimental.session.compacting     │    │
│  └──────────────────────┬──────────────────────────┘    │
│                         │ reads signals                  │
│  ┌──────────────────────▼──────────────────────────┐    │
│  │  Plugin 2: harness-enforcer (Step 1)            │    │
│  │  역할: HARD gate + SOFT 위반 추적, scaffold 차단 │    │
│  │  훅: tool.execute.before, event                 │    │
│  └──────────────────────┬──────────────────────────┘    │
│                         │ reads rules                    │
│  ┌──────────────────────▼──────────────────────────┐    │
│  │  Plugin 1: harness-observer (Step 1)            │    │
│  │  역할: 세션 로그 수집, 신호 변환                  │    │
│  │  훅: tool.execute.after, event                  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Shared Store (파일 시스템)                       │    │
│  │  ~/.config/opencode/harness/                     │    │
│  │    ├── logs/          ← observer 기록             │    │
│  │    ├── signals/       ← observer→improver        │    │
│  │    ├── rules/         ← improver→enforcer        │    │
│  │    ├── scaffold/      ← NEVER DO 규칙            │    │
│  │    ├── memory/        ← 크로스세션 기억           │    │
│  │    └── projects/      ← 프로젝트별 격리 상태      │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### 왜 파일 시스템 기반인가

Hugh Kim의 오케스트레이터 진화 과정에서 가장 중요한 교훈 중 하나가 "파일 = 진실" 원칙이다.
초기에는 Context7, TaskManager 같은 외부 MCP 서버에 의존했으나, 동기화 사고로 오케스트레이터 파일이 삭제되는 사건이 발생했다.
이후 파일 시스템을 유일한 진실의 원천으로 확립했다.

OpenCode 플러그인 간에도 동일한 원칙을 적용한다:

- 플러그인 간 데이터 교환은 공유 디렉토리의 JSON/JSONL 파일로
- 데이터베이스나 IPC 없이, 파일이 곧 상태
- 디버깅 시 파일만 열면 전체 상태를 파악할 수 있음

> **참고 문서:** "파일 = 진실" 원칙 확립 과정: [orchestrator-evolution.html](https://hugh-kim.space/orchestrator-evolution.html) — v2 기반 재설계 섹션

### 플러그인 실행 순서

OpenCode 플러그인은 모든 소스에서 로드되고 모든 훅이 순차 실행된다.
로드 순서: Global config → Project config → Global plugin dir → Project plugin dir.

이 순서를 활용하여:

1. **harness-observer**를 글로벌 플러그인으로 배치 (항상 먼저 로드)
2. **harness-enforcer**를 글로벌 플러그인으로 배치 (observer 뒤에 실행)
3. **harness-improver**를 글로벌 플러그인으로 배치
4. **harness-orchestrator**를 프로젝트 플러그인으로 배치 (프로젝트별 설정 가능)

> **참고 문서:** 플러그인 로드 순서 및 구조: [OpenCode Plugins 공식 문서](https://opencode.ai/docs/plugins/)

### 배포 구조: 단일 패키지, 다중 export

개발 시 4개 플러그인으로 관심사를 분리하되, 배포는 단일 npm 패키지로 묶는다.
집/회사/노트북 어디서든 설치는 1줄이다.

```json
// opencode.json
{
    "plugin": ["my-harness"]
}
```

```typescript
// my-harness/src/index.ts
export { HarnessObserver } from './observer';
export { HarnessEnforcer } from './enforcer';
export { HarnessImprover } from './improver'; // Step 2에서 추가
export { HarnessOrchestrator } from './orchestrator'; // Step 4에서 추가
```

OpenCode는 하나의 모듈에서 여러 Plugin 함수를 export하면 전부 로드한다.
점진적 구현 중 미완성 레이어는 export에서 제외하고, 해당 Step 완료 시 export에 추가한다.
설치한 환경에서는 패키지 버전만 올리면 새 레이어가 자동 활성화된다.

### 디렉토리 구조: 코드 vs 데이터 분리

플러그인 코드(npm 패키지)와 런타임 데이터(공유 저장소)는 완전히 분리된다.

**1. 플러그인 코드 (npm 배포 — 모든 환경에서 동일)**

```
my-harness/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                     # 플러그인 re-export (진입점)
    │
    ├── harness/                     # 하네스 레이어 (Step 1~2)
    │   ├── observer.ts              # Plugin 1: L1 관측 + L2 신호 변환
    │   ├── enforcer.ts              # Plugin 2: L4 HARD 차단 + SOFT 위반 추적
    │   └── improver.ts              # Plugin 3: L5 자가개선 + L6 폐루프
    │
    ├── orchestrator/                # 오케스트레이션 레이어 (Step 4)
    │   ├── orchestrator.ts          # Plugin 4: Phase 관리 + 태스크 분배
    │   └── phase-manager.ts         # Phase 상태 파일 관리 + Phase 2.5 gate
    │
    ├── agents/                      # 에이전트 정의 (Step 4)
    │   ├── agents.ts                # 에이전트 빌더 + 등록 로직
    │   └── prompts/                 # 에이전트별 시스템 프롬프트
    │       ├── orchestrator.md      # build 에이전트 프롬프트
    │       ├── frontend.md          # frontend 서브에이전트
    │       ├── backend.md           # backend 서브에이전트
    │       ├── tester.md            # tester 서브에이전트
    │       └── reviewer.md          # reviewer 서브에이전트
    │
    ├── hooks/                       # 훅 모듈 (omO 패턴)
    │   ├── index.ts                 # 훅 등록 배럴 export
    │   ├── tool-logger.ts           # tool.execute.after 로깅
    │   ├── rule-enforcer.ts         # tool.execute.before 차단
    │   ├── signal-detector.ts       # event 기반 신호 감지
    │   └── compaction-injector.ts   # experimental.session.compacting 컨텍스트 주입
    │
    ├── tools/                       # 커스텀 도구 (Step 2 확장)
    │   ├── index.ts                 # 도구 등록 배럴 export
    │   ├── harness-status.ts        # 하네스 상태 조회 도구
    │   └── harness-eval.ts          # 하네스 평가 실행 도구
    │
    ├── shared/                      # 공통 유틸리티
    │   ├── index.ts                 # 배럴 export
    │   ├── utils.ts                 # getProjectKey, ensureHarnessDirs, generateId
    │   ├── file-io.ts               # logEvent, 파일 읽기/쓰기 헬퍼
    │   └── constants.ts             # HARNESS_DIR, 디렉토리 경로 상수
    │
    ├── config/                      # 설정 스키마
    │   ├── index.ts                 # 설정 로더
    │   └── schema.ts                # Zod 기반 설정 유효성 검증
    │
    └── types.ts                     # Signal, Rule, ProjectState 등 전체 타입
```

**2. 런타임 데이터 (각 환경에서 자동 생성 — 환경마다 다름)**

```
~/.config/opencode/harness/
├── config.json
├── logs/
├── signals/
├── rules/
├── scaffold/
├── memory/
├── projects/
└── metrics/
```

플러그인 코드는 npm install로 `~/.cache/opencode/node_modules/my-harness/`에 설치되고,
런타임 데이터는 플러그인 최초 실행 시 `ensureDirs()`로 자동 생성된다.
집/회사/노트북에서 동일한 코드가 돌지만, 각 환경의 rules, signals, scaffold는 독립적으로 진화한다.

규칙을 환경 간에 동기화하고 싶으면 `~/.config/opencode/harness/`를 git repo로 관리하면 된다. 이것은 선택사항이다.

---

## 3. 공통 인프라: 공유 저장소 스키마

**이 섹션을 플러그인 구현 전에 먼저 확정해야 한다.**
공유 저장소 스키마가 모든 플러그인 간의 계약(contract)이다. 이것 없이 플러그인을 각각 만들면 인터페이스 불일치로 재작업하게 된다.

### 디렉토리 구조

```
~/.config/opencode/harness/
├── config.json                    # 하네스 전역 설정
├── logs/                          # L1: 관측 로그
│   ├── sessions/                  # 세션별 이벤트 로그
│   │   └── {session-id}.jsonl     # 한 세션의 모든 이벤트
│   ├── tools/                     # 도구 사용 로그
│   │   └── {date}.jsonl           # 일별 도구 사용 이력
│   └── errors/                    # 에러 로그
│       └── {date}.jsonl           # 일별 에러 이력
├── signals/                       # L2: 신호 저장소
│   ├── pending/                   # 처리 대기 신호
│   │   └── {signal-id}.json       # 개별 신호 (fix 커밋, 에러 반복 등)
│   └── ack/                       # 처리 완료 신호
│       └── {signal-id}.json       # ack 처리된 신호
├── rules/                         # L4: 규칙 저장소
│   ├── soft/                      # SOFT 규칙 (프롬프트 주입)
│   │   └── {rule-id}.json         # 개별 SOFT 규칙
│   ├── hard/                      # HARD 규칙 (hook 차단)
│   │   └── {rule-id}.json         # 개별 HARD 규칙
│   └── history.jsonl              # 규칙 생성/승격/삭제 이력
├── scaffold/                      # NEVER DO 규칙
│   └── {project-key}.md           # 프로젝트별 scaffold
├── memory/                        # 크로스세션 기억
│   ├── archive/                   # 세션 원본 보존
│   ├── index.sqlite               # 검색 인덱스 (고도화 시)
│   └── facts/                     # 추출된 사실 (고도화 시)
├── projects/                      # L3: 프로젝트별 격리
│   └── {project-key}/             # 프로젝트 단위 상태
│       ├── state.json             # 현재 상태 (pending 수, HARD 비율 등)
│       ├── scaffold.md            # 프로젝트 전용 NEVER DO
│       ├── violations.jsonl       # 위반 이력
│       ├── improvements.jsonl     # 자가개선 이력
│       ├── qa-failures.json       # QA 시나리오별 실패 추적 (Step 4)
│       └── .session-lock          # PID 세션 락 (Step 4a, 동시 실행 방지)
└── metrics/                       # 효과 측정

# Phase 상태 파일 (프로젝트 worktree 내부 — harness/ 외부)
{project}/.opencode/orchestrator-phase.json   # Phase 1~5 상태 + 이력
    ├── results.tsv                # loopy-era-eval 결과 이력
    └── effectiveness/             # 규칙별 효과 측정
        └── {rule-id}.json         # 30일 효과 평가 데이터
```

### 핵심 스키마 정의

모든 스키마는 `src/types.ts`에 정의하고, 각 플러그인에서 import한다. **플러그인별로 축소 버전을 재정의하지 않는다.** 축소 버전을 만들면 필드가 빠지거나 타입이 달라져서 플러그인 간 데이터 교환 시 런타임 에러가 발생한다.

#### Signal (신호)

```typescript
// src/types.ts
export interface Signal {
    id: string; // 고유 ID (uuid)
    type: 'fix_commit' | 'error_repeat' | 'user_feedback' | 'violation';
    project_key: string; // 프로젝트 식별자 (git repo realpath의 hash)
    session_id?: string; // 발생 세션 (획득 가능할 때만)
    agent_id?: string; // Step 4: 오케스트레이터/서브에이전트 식별용
    timestamp: string; // ISO 8601
    payload: {
        description: string; // 무엇이 감지되었는가
        source_file?: string; // 관련 파일
        pattern?: string; // 감지된 패턴 (grep 가능한 형태)
        recurrence_count: number; // 동일 패턴 재발 횟수
        related_signals?: string[]; // 연관 신호 ID 목록
    };
    status: 'pending' | 'processing' | 'acked' | 'discarded';
}
```

> **session_id가 optional인 이유:** OpenCode의 event 객체에서 session ID를 획득하는 방법이 공식 문서에 명시되어 있지 않다. 구현 시 실제 event 객체를 덤프하여 확인한 뒤, 획득 가능하면 채우고 아니면 생략한다.

#### Rule (규칙)

```typescript
// src/types.ts
export interface Rule {
    id: string; // 고유 ID
    type: 'soft' | 'hard';
    project_key: string | 'global'; // 프로젝트 또는 글로벌
    created_at: string; // 생성 시점
    promoted_at?: string; // HARD 승격 시점
    source_signal_id: string; // 이 규칙을 생성한 신호
    pattern: {
        type: 'code' | 'behavior'; // 코드 패턴 or 행동 패턴
        match: string; // 매칭 조건 (정규식 또는 키워드)
        scope: 'file' | 'tool' | 'prompt'; // 적용 범위
    };
    description: string; // 사람이 읽을 수 있는 설명
    violation_count: number; // 위반 횟수
    last_violation_at?: string; // 마지막 위반 시점
    effectiveness?: {
        // 효과 측정 (30일 후)
        measured_at: string;
        recurrence_after_rule: number;
        status: 'effective' | 'warning' | 'needs_promotion' | 'unmeasurable';
    };
}
```

> **scope 필드와 승격 관계:**
> - `scope: 'tool'` — 도구 실행 시 매칭. SOFT→HARD 승격 대상. enforcer가 violation_count를 추적한다.
> - `scope: 'file'` — 파일 경로 매칭. SOFT→HARD 승격 대상. enforcer가 violation_count를 추적한다.
> - `scope: 'prompt'` — 행동 패턴. **SOFT→HARD 승격 대상이 아니다.** 도구 실행 시점에 위반을 감지할 수 없으므로 violation_count가 증가하지 않는다. `experimental.session.compacting` 훅으로 컨텍스트에 주입되어 에이전트에게 인지시키는 방식으로만 강제된다.

#### Project State (프로젝트 상태)

```typescript
// src/types.ts
export interface ProjectState {
    project_key: string;
    project_path: string; // 실제 경로
    soft_rule_count: number;
    hard_rule_count: number;
    pending_signal_count: number;
    hard_ratio: number; // HARD / (SOFT + HARD) 비율
    last_improvement_at?: string;
    last_eval_at?: string;
    eval_history: Array<{
        timestamp: string;
        hard_ratio: number;
        total_checks: number;
        passed_checks: number;
    }>;
}
```

#### PhaseState (Phase 상태 — Step 4)

```typescript
// src/types.ts
export interface PhaseHistoryEntry {
    phase: number;          // 1~5
    entered_at: string;     // ISO 8601
    completed_at?: string;  // ISO 8601, 진행 중이면 undefined
}

export interface PhaseState {
    current_phase: number;          // 1~5
    phase_history: PhaseHistoryEntry[];
    qa_test_plan_exists: boolean;
    incomplete_phase?: number;      // 마지막 entry에 completed_at 없으면 설정
}
```

#### QAFailures (QA 실패 추적 — Step 4)

```typescript
// src/types.ts
export interface QAFailureDetail {
    timestamp: string;
    message: string;
    agent_id?: string;
}

export interface QAFailures {
    [scenarioId: string]: {
        count: number;
        last_failure_at: string;
        details: QAFailureDetail[];
    };
}
```

#### EvalResult (평가 결과)

```typescript
// src/types.ts
export interface EvalResult {
    total_checks: number;
    passed_checks: number;
    hard_ratio: number;
    failures: Array<{
        rule_id: string;
        description: string;
        timestamp: string;
    }>;
}
```

### 공통 유틸리티 (utils.ts)

`getProjectKey`, `ensureHarnessDirs`, 파일 I/O 헬퍼를 한 곳에서 관리한다. **각 플러그인에서 이 함수들을 복붙하지 않고 반드시 import한다.** 복붙하면 한 파일만 수정될 때 서로 다른 project_key가 생성되어 신호와 규칙이 다른 프로젝트에 할당되는 치명적 버그가 발생한다.

```typescript
// src/utils.ts
import { mkdirSync, appendFileSync, realpathSync } from 'fs';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';

export const HARNESS_DIR = join(process.env.HOME!, '.config/opencode/harness');

export function getProjectKey(worktree: string): string {
    try {
        const resolved = realpathSync(worktree);
        return createHash('sha256').update(resolved).digest('hex').slice(0, 12);
    } catch {
        return 'unknown';
    }
}

// 각 플러그인이 초기화 시 호출 — 자신이 필요한 디렉토리를 idempotently 생성
export function ensureHarnessDirs() {
    const dirs = [
        join(HARNESS_DIR, 'logs/sessions'),
        join(HARNESS_DIR, 'logs/tools'),
        join(HARNESS_DIR, 'logs/errors'),
        join(HARNESS_DIR, 'signals/pending'),
        join(HARNESS_DIR, 'signals/ack'),
        join(HARNESS_DIR, 'rules/soft'),
        join(HARNESS_DIR, 'rules/hard'),
        join(HARNESS_DIR, 'scaffold'),
        join(HARNESS_DIR, 'memory/archive'),
        join(HARNESS_DIR, 'projects'),
        join(HARNESS_DIR, 'metrics/effectiveness'),
    ];
    for (const dir of dirs) {
        mkdirSync(dir, { recursive: true });
    }
}

export function logEvent(category: string, filename: string, data: Record<string, unknown>) {
    const filepath = join(HARNESS_DIR, 'logs', category, filename);
    appendFileSync(filepath, JSON.stringify({ ...data, _ts: new Date().toISOString() }) + '\n');
}

export function generateId(): string {
    return randomUUID();
}
```

### project_key 생성 규칙

Hugh Kim 시스템에서 프로젝트 경계 혼선이 발생했던 원인은 basename 충돌이었다.
`/home/user/projectA`와 `/tmp/projectA`가 같은 key를 가지면 상태가 오염된다.
위 utils.ts의 `getProjectKey`가 git worktree root의 realpath를 hash하여 고유 키를 생성한다.

> **참고 문서:**
>
> - 프로젝트 격리 문제와 해결: [codex-loop-era-l6.html](https://hugh-kim.space/codex-loop-era-l6.html) — Isolation 섹션
> - basename 충돌 사례: [claude-code-harness-system.html](https://hugh-kim.space/claude-code-harness-system.html) — L3 프로젝트 경계 섹션

---

## 4. Step 1 — 하네스 초안

> **이 단계의 목표:** L1~L4를 구현하여 "관측→신호변환→규칙 저장→차단"까지 동작하는 기본 하네스를 완성한다.
> **이 단계에서 동작하는 것:** 에러 반복 감지 (Loop 2 일부), HARD 규칙 차단, SOFT 규칙 위반 추적.
> **이 단계에서 동작하지 않는 것:** 자동 규칙 생성 (Step 2 improver), fix: 커밋 학습 (Step 2 Loop 1), 30일 효과 측정 (Step 2 Loop 3). Step 1에서는 규칙을 수동으로 생성하여 enforcer가 작동하는지만 확인한다.
>
> **참고 문서:**
>
> - 전체 하네스 설계도: [self-evolving-system.html](https://hugh-kim.space/self-evolving-system.html)
> - L1~L6 충족 분석 및 파이프라인: [claude-code-harness-system.html](https://hugh-kim.space/claude-code-harness-system.html)
> - 행동 패턴 차단: [harsh-critic.html](https://hugh-kim.space/harsh-critic.html)

### 4.1 Plugin 1: harness-observer

**역할:** L1(관측) + L2(신호 변환)
**위치:** `src/observer.ts`

#### 사용할 OpenCode 훅

| 훅                        | 용도                                                | L레벨 |
| ------------------------- | --------------------------------------------------- | ----- |
| `tool.execute.after`      | 모든 도구 실행 결과 기록. 실패/성공, 소요시간, 인자 | L1    |
| `event` (session.idle)    | 세션 완료 시 세션 요약 생성, 신호 판정 트리거       | L2    |
| `event` (file.edited)     | 파일 변경 감지 (Step 2에서 fix: 커밋 패턴 추적에 사용) | L1 |
| `event` (message.part.updated) | 사용자 불만 키워드 감지 ("왜이래", "또", "안돼", ...)    | L2    |
| `event` (session.error)   | 에러 발생 기록, 반복 에러 카운트                    | L1    |

#### 구현 상세

```typescript
// src/harness/observer.ts
import type { Plugin } from '@opencode-ai/plugin';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { HARNESS_DIR, ensureHarnessDirs, getProjectKey, logEvent, generateId } from '../shared/utils';

function emitSignal(signal: Record<string, unknown>) {
    const id = generateId();
    writeFileSync(
        join(HARNESS_DIR, 'signals/pending', `${id}.json`),
        JSON.stringify({ id, status: 'pending', timestamp: new Date().toISOString(), ...signal }, null, 2),
    );
}

export const HarnessObserver: Plugin = async (ctx) => {
    ensureHarnessDirs();

    const errorCounts = new Map<string, number>();

    return {
        // L1: 도구 실행 후 기록 (순수 로깅만 담당)
        'tool.execute.after': async (input, output) => {
            const date = new Date().toISOString().slice(0, 10);
            logEvent('tools', `${date}.jsonl`, {
                tool: input.tool,
                args: input.args,
                title: output.title,
                output_preview: typeof output.output === 'string' ? output.output.slice(0, 500) : undefined,
            });
        },

        // L1 + L2: 이벤트 수신
        event: async ({ event }) => {
            if (event.type === 'session.idle') {
                logEvent('sessions', `${event.properties?.sessionID || 'unknown'}.jsonl`, {
                    event: 'session_idle',
                });
            }

            // L2: 세션 에러 감지 + 반복 에러 카운팅
            if (event.type === 'session.error') {
                const date = new Date().toISOString().slice(0, 10);
                const errorInfo = event.properties?.error || 'unknown';
                const key = `session_error:${String(errorInfo).slice(0, 100)}`;
                const count = (errorCounts.get(key) || 0) + 1;
                errorCounts.set(key, count);

                logEvent('errors', `${date}.jsonl`, {
                    event: 'session_error',
                    sessionID: event.properties?.sessionID,
                    error: errorInfo,
                    repeat_count: count,
                });

                if (count >= 3) {
                    emitSignal({
                        type: 'error_repeat',
                        project_key: getProjectKey(ctx.worktree),
                        payload: {
                            description: `세션 에러 ${count}회 반복: ${String(errorInfo).slice(0, 200)}`,
                            pattern: key,
                            recurrence_count: count,
                        },
                    });
                }
            }

            // 파일 편집 감지 — Step 1에서는 로깅만. Step 2에서 fix: 커밋 학습에 사용.
            if (event.type === 'file.edited') {
                logEvent('sessions', `current.jsonl`, {
                    event: 'file_edited',
                    file: event.properties?.file,
                });
            }

            // 사용자 메시지에서 불만 키워드 감지
            if (event.type === 'message.part.updated') {
                const { part } = event.properties;
                if (part.type === 'text') {
                    const content = (part as { type: 'text'; text: string }).text;
                    if (typeof content === 'string') {
                        const frustrationKeywords = ['왜이래', '안돼', '또', '이상해', '다시', '안되잖아', '장난해', '이상해', '에러', '버그', '깨졌어', '제대로'];
                        const found = frustrationKeywords.filter((kw) => content.includes(kw));
                        if (found.length > 0) {
                            emitSignal({
                                type: 'user_feedback',
                                project_key: getProjectKey(ctx.worktree),
                                payload: {
                                    description: `사용자 불만 감지: ${found.join(', ')}`,
                                    pattern: found.join('|'),
                                    recurrence_count: 1,
                                },
                            });
                        }
                    }
                }
            }
        },
    };
};
```

#### 왜 이 구조인가

**tool.execute.after를 사용하는 이유:** tool.execute.before는 실행 전이므로 결과를 모른다. 관측은 결과를 봐야 의미가 있으므로 after를 사용한다. before는 enforcer(차단)에서 사용한다.

**JSONL 포맷을 사용하는 이유:** append-only로 쓰기 충돌이 없고, 한 줄씩 읽을 수 있어 부분 파싱이 가능하다. JSON 배열이면 매번 전체 파일을 읽고 써야 한다.

**불만 키워드 감지의 한계:** 키워드 매칭은 false positive가 높다. 초안에서는 이 수준으로 시작하고, 고도화(Step 2)에서 LLM 기반 판정으로 교체할 수 있다. 핵심은 "불만 감지 → 신호 생성" 파이프라인이 존재하는 것이다.

**file.edited에서 fix_commit signal을 생성하지 않는 이유:** Loop 1(fix: 커밋 학습)은 git diff 분석과 패턴 추출이 필요하므로 Step 2에서 구현한다. Step 1에서는 file.edited를 로깅만 하고, Step 2의 improver가 이 로그를 기반으로 fix: 커밋을 감지한다.

> **주의:** harsh-critic.html의 분노 트리거 분류(EXTREME/HIGH/MEDIUM)를 참고하되, 초안에서는 키워드 기반으로 단순화한다.
> 실제 분노 패턴 데이터는 운영하면서 축적된다.
>
> **참고 문서:** [harsh-critic.html](https://hugh-kim.space/harsh-critic.html) — 실제 분노에서 추출한 체크리스트

---

### 4.2 Plugin 2: harness-enforcer

**역할:** L3(프로젝트 격리) + L4(규칙 차단) + SOFT 위반 추적
**위치:** `src/enforcer.ts`

#### 사용할 OpenCode 훅

| 훅                        | 용도                                                                | L레벨 |
| ------------------------- | ------------------------------------------------------------------- | ----- |
| `tool.execute.before`     | HARD 규칙 → 차단 (throw Error), SOFT 규칙 → 위반 감지 + count 증가 | L4    |
| `event` (session.created) | 세션 시작 시 해당 프로젝트의 규칙 로드                              | L3    |

#### 핵심 설계: SOFT 규칙 위반 추적

enforcer는 HARD 규칙 차단뿐 아니라 **SOFT 규칙의 위반도 감지하여 violation_count를 증가**시킨다. SOFT 위반은 차단하지 않지만 카운트를 올린다. 이 카운트가 2 이상이 되면 improver(Step 2)가 HARD로 승격한다.

**이 로직이 없으면 SOFT→HARD 승격이 영원히 발생하지 않는다.** violation_count를 올리는 코드는 enforcer에만 존재하고, improver는 이 카운트를 읽어서 승격 여부만 판단한다.

**scope: 'prompt' 규칙은 위반 추적에서 제외한다.** 이유: 행동 패턴("떠넘기기", "거짓 보고")은 도구 실행 시점(`tool.execute.before`)에 위반을 감지할 수 없다. 에이전트의 응답 텍스트를 분석해야 하는데, before 훅에서는 접근할 수 없다. 이 규칙들은 `experimental.session.compacting`의 컨텍스트 주입으로만 강제된다.

#### 구현 상세

```typescript
// src/enforcer.ts
import type { Plugin } from '@opencode-ai/plugin';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Rule } from './types';
import { HARNESS_DIR, ensureHarnessDirs, getProjectKey } from './utils';

function loadRules(type: 'soft' | 'hard', projectKey: string): Rule[] {
    const rules: Rule[] = [];
    const dir = join(HARNESS_DIR, `rules/${type}`);
    if (!existsSync(dir)) return rules;

    for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        try {
            const rule: Rule = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
            if (rule.project_key === 'global' || rule.project_key === projectKey) {
                rules.push(rule);
            }
        } catch {
            /* 파싱 실패한 규칙은 무시 */
        }
    }
    return rules;
}

function loadScaffold(projectKey: string): string[] {
    const patterns: string[] = [];
    const globalPath = join(HARNESS_DIR, 'scaffold/global.md');
    if (existsSync(globalPath)) {
        patterns.push(...extractNeverDoPatterns(readFileSync(globalPath, 'utf-8')));
    }
    const projectPath = join(HARNESS_DIR, `projects/${projectKey}/scaffold.md`);
    if (existsSync(projectPath)) {
        patterns.push(...extractNeverDoPatterns(readFileSync(projectPath, 'utf-8')));
    }
    return patterns;
}

function extractNeverDoPatterns(markdown: string): string[] {
    const patterns: string[] = [];
    let inNeverDo = false;
    for (const line of markdown.split('\n')) {
        if (line.includes('NEVER DO')) inNeverDo = true;
        else if (line.startsWith('#')) inNeverDo = false;
        else if (inNeverDo && line.trim().startsWith('-')) {
            patterns.push(line.trim().slice(1).trim());
        }
    }
    return patterns;
}

// SOFT 규칙 위반 시 violation_count 증가 (차단은 하지 않음)
function incrementViolation(rule: Rule) {
    const filePath = join(HARNESS_DIR, `rules/${rule.type}/${rule.id}.json`);
    try {
        const current: Rule = JSON.parse(readFileSync(filePath, 'utf-8'));
        current.violation_count = (current.violation_count || 0) + 1;
        current.last_violation_at = new Date().toISOString();
        writeFileSync(filePath, JSON.stringify(current, null, 2));
    } catch {
        /* 파일 접근 실패 시 무시 — 다음 세션에서 재시도 */
    }
}

// 정규식 실행을 try-catch로 보호 (잘못된 패턴에 의한 크래시 방지)
// 규칙의 pattern.match는 improver가 자동 생성하므로, 잘못된 정규식이 들어올 수 있다.
// try-catch로 감싸서 잘못된 패턴은 무시하되 플러그인은 계속 동작하게 한다.
function safeRegexTest(pattern: string, target: string): boolean {
    try {
        return new RegExp(pattern, 'i').test(target);
    } catch {
        return false;
    }
}

export const HarnessEnforcer: Plugin = async (ctx) => {
    ensureHarnessDirs();

    const projectKey = getProjectKey(ctx.worktree);
    let hardRules = loadRules('hard', projectKey);
    let softRules = loadRules('soft', projectKey);
    let scaffoldPatterns = loadScaffold(projectKey);

    return {
        // 세션 시작 시 규칙 리로드
        event: async ({ event }) => {
            if (event.type === 'session.created') {
                hardRules = loadRules('hard', projectKey);
                softRules = loadRules('soft', projectKey);
                scaffoldPatterns = loadScaffold(projectKey);
            }
        },

        // L4: 도구 실행 전 규칙 체크
        'tool.execute.before': async (input, output) => {
            const argsStr = JSON.stringify(output.args || {});

            // === HARD 규칙: 매칭 시 차단 (throw Error) ===
            for (const rule of hardRules) {
                if (rule.pattern.scope === 'tool') {
                    if (safeRegexTest(rule.pattern.match, input.tool) || safeRegexTest(rule.pattern.match, argsStr)) {
                        throw new Error(
                            `[HARNESS HARD BLOCK] ${rule.description}\nRule: ${rule.id} | Pattern: ${rule.pattern.match}`,
                        );
                    }
                }
                if (rule.pattern.scope === 'file' && ['write', 'edit', 'patch'].includes(input.tool)) {
                    const filePath = output.args?.filePath || output.args?.file || '';
                    if (safeRegexTest(rule.pattern.match, filePath)) {
                        throw new Error(
                            `[HARNESS HARD BLOCK] ${rule.description}\nRule: ${rule.id} | File: ${filePath}`,
                        );
                    }
                }
                // scope: 'prompt'인 HARD 규칙은 여기서 처리하지 않음 (컨텍스트 주입으로 처리)
            }

            // === SOFT 규칙: 매칭 시 차단하지 않고 violation_count만 증가 ===
            for (const rule of softRules) {
                // scope: 'prompt'는 도구 실행 시점에 위반을 감지할 수 없으므로 건너뜀
                if (rule.pattern.scope === 'prompt') continue;

                let matched = false;
                if (rule.pattern.scope === 'tool') {
                    matched = safeRegexTest(rule.pattern.match, input.tool) || safeRegexTest(rule.pattern.match, argsStr);
                }
                if (rule.pattern.scope === 'file' && ['write', 'edit', 'patch'].includes(input.tool)) {
                    const filePath = output.args?.filePath || output.args?.file || '';
                    matched = safeRegexTest(rule.pattern.match, filePath);
                }
                if (matched) {
                    incrementViolation(rule);
                }
            }

            // === Scaffold NEVER DO 체크 ===
            if (['write', 'edit', 'patch'].includes(input.tool)) {
                const content = output.args?.content || output.args?.newString || '';
                for (const pattern of scaffoldPatterns) {
                    const keywords = pattern.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
                    const contentLower = content.toLowerCase();
                    const matchCount = keywords.filter((kw) => contentLower.includes(kw)).length;
                    if (keywords.length > 0 && matchCount / keywords.length > 0.6) {
                        throw new Error(
                            `[HARNESS SCAFFOLD VIOLATION] ${pattern}\nMatched keywords: ${matchCount}/${keywords.length}`,
                        );
                    }
                }
            }

            // === 특수 차단: .env 파일 커밋 방지 ===
            if (input.tool === 'bash') {
                const cmd = output.args?.command || '';
                if (/git\s+(add|commit).*\.env/.test(cmd)) {
                    throw new Error('[HARNESS HARD BLOCK] .env 파일의 git add/commit이 금지되어 있습니다.');
                }
            }

            // === 특수 차단: git push 전 증거 파일 체크 ===
            // 초안에서는 경고만, 오케스트레이션(Step 4)에서 HARD로 전환
            if (input.tool === 'bash') {
                const cmd = output.args?.command || '';
                if (/git\s+push/.test(cmd)) {
                    // TODO: qa-evidence 파일 존재 확인 → Step 4에서 활성화
                }
            }
        },
    };
};
```

#### 왜 이 구조인가

**enforcer가 SOFT 규칙도 로드하는 이유:** SOFT→HARD 승격의 전제 조건은 violation_count의 증가다. enforcer만이 도구 실행 시점에 위반을 감지할 수 있으므로, SOFT 규칙의 위반 추적도 enforcer의 책임이다. SOFT 위반은 차단하지 않고 카운트만 올린다.

**scope: 'prompt'를 건너뛰는 이유:** "떠넘기기", "거짓 보고" 같은 행동 패턴은 에이전트의 응답 텍스트에서 나타나는데, `tool.execute.before` 훅에서는 에이전트의 응답에 접근할 수 없다. 이 규칙들은 `experimental.session.compacting` 훅에서 컨텍스트 주입으로만 강제하며, SOFT→HARD 승격 대상이 아니다. Hugh Kim의 harsh-critic도 행동 패턴을 코드 패턴과 다른 별도 방어선으로 분류했다.

**safeRegexTest를 사용하는 이유:** 규칙의 pattern.match는 improver가 자동 생성한다. 잘못된 정규식이 들어오면 `new RegExp()`이 예외를 던지고 enforcer 전체가 멈춘다. try-catch로 감싸서 잘못된 패턴은 무시하되 플러그인은 계속 동작하게 한다.

**tool.execute.before에서 throw Error를 사용하는 이유:** OpenCode에서 before 훅에서 에러를 throw하면 해당 도구 실행이 차단된다. 이것이 Hugh Kim의 `exit 2` HARD 차단에 대응한다.

**scaffold 패턴의 키워드 매칭 한계:** 자연어 NEVER DO를 정규식으로 완벽하게 매칭하는 건 불가능하다. 60% 임계값은 시작점이며, 운영하면서 false positive/negative를 줄여야 한다.

**규칙 리로드 시점:** session.created에서만 규칙을 리로드한다. 세션 중간에 규칙이 변경되는 경우는 improver가 처리하며, 변경 후 다음 세션부터 적용된다.

### 4.3 Step 1 검증 기준

두 플러그인을 구현한 뒤, 다음을 검증해야 Step 2로 넘어갈 수 있다:

1. **L1 검증:** 도구 사용 로그가 `~/.config/opencode/harness/logs/tools/` 에 JSONL로 기록되는가
2. **L2 검증:** 에러 3회 반복 시 `signals/pending/`에 signal 파일이 생성되는가
3. **L3 검증:** 서로 다른 프로젝트의 signal이 다른 project_key로 분리되는가
4. **L4 검증 (HARD):** `rules/hard/`에 테스트 규칙을 수동으로 넣었을 때, 해당 패턴의 도구 실행이 차단되는가
5. **L4 검증 (SOFT 추적):** `rules/soft/`에 scope: 'tool' 테스트 규칙을 수동으로 넣고 위반을 유발했을 때, violation_count가 증가하는가
6. **scope: 'prompt' 검증:** `rules/soft/`에 scope: 'prompt' 테스트 규칙을 넣었을 때, violation_count가 증가하지 않는 것을 확인

> **주의:** 이 단계에서 improver(자동 규칙 생성)는 아직 없다. 규칙은 수동으로 생성하여 enforcer가 작동하는지만 확인한다.
> "부품이 동작하는 걸 확인한 뒤 조합한다"는 원칙.

---

## 5. Step 2 — 하네스 고도화

> **이 단계의 목표:** L5(자동 수정) + L6(폐루프)를 구현하여 "신호→규칙 자동 생성→효과 측정→승격/폐기" 사이클을 완성한다.
> **이 단계에서 새로 동작하는 것:** 자동 규칙 생성 (improver), SOFT→HARD 자동 승격, 30일 효과 측정, 컨텍스트 주입.
> **이 단계 기본에 포함:** Loop 1 (fix: 커밋 학습), Loop 2 (불만→규칙 변환), Loop 3 (효과 검증).
>
> **참고 문서:**
>
> - 3개 피드백 루프 + SOFT→HARD 승격: [self-evolving-system.html](https://hugh-kim.space/self-evolving-system.html)
> - 이중 모델 검증, 에러 복구 4단계: [codex-integration.html](https://hugh-kim.space/codex-integration.html)
> - practical L6 구현: [codex-loop-era-l6.html](https://hugh-kim.space/codex-loop-era-l6.html)
> - 크로스세션 기억 (하위 3단계): [memory-bank-analysis.html](https://hugh-kim.space/memory-bank-analysis.html)
> - 외부 트렌드 자동 수집: [trend-harvest-log.html](https://hugh-kim.space/trend-harvest-log.html)
> - 표면 UX 래핑: [loopy-v2-surface-gap.html](https://hugh-kim.space/loopy-v2-surface-gap.html)

### 5.1 Plugin 3: harness-improver

**역할:** L5(자동 수정) + L6(폐루프)
**위치:** `src/improver.ts`

#### 사용할 OpenCode 훅

| 훅                                | 용도                                  | L레벨 |
| --------------------------------- | ------------------------------------- | ----- |
| `event` (session.idle)            | 세션 종료 시 pending signal 처리 시작 | L5    |
| `experimental.session.compacting` | 컴팩션 시 하네스 컨텍스트 주입        | L5    |
| `event` (file.edited)             | git commit 메시지에서 fix: 패턴 감지  | L2→L5 |

#### 핵심 로직: 자가개선 3단계 루프

**Loop 1 — Reactive (실수 학습) — Step 2 기본:**

```
fix: 커밋 감지 → diff 분석 → 패턴 추출 → scaffold NEVER DO 추가
```

구현: observer의 file.edited 로그를 기반으로, session.idle 시 `.git/COMMIT_EDITMSG`를 읽어 fix: 접두사가 있으면 트리거. `ctx.$\`git diff HEAD~1\``로 diff를 추출하고, 변경된 파일/패턴을 signal로 변환한다.

> **Step 1에서 이 로직이 없었던 이유:** git diff 분석과 패턴 추출은 improver의 책임이다. observer는 file.edited를 로깅만 한다.

**Loop 2 — Proactive (불만 학습):**

```
사용자 불만 키워드 감지 → feedback.jsonl 기록 → 근본 원인 분석 → 규칙 생성
```

구현: observer가 이미 불만 signal을 생성하므로, improver는 pending signal 중 `user_feedback` 타입을 읽고 처리한다. 생성되는 규칙의 scope는 'prompt'이며, 이 규칙은 SOFT→HARD 승격 대상이 아니라 컨텍스트 주입으로만 강제된다.

**Loop 3 — Meta (효과 검증):**

```
규칙 추가 후 30일 경과 → 재발 0건: effective → 재발 2건+: SOFT→HARD 승격
```

구현: `session.idle` 이벤트 시 모든 규칙의 `created_at`을 확인하여 30일이 경과한 SOFT 규칙의 `violation_count`를 체크한다. 단, scope: 'prompt' 규칙은 violation_count가 항상 0이므로 효과 측정 대상에서 자동으로 제외된다 (effective로 판정).

#### 구현 상세

```typescript
// src/improver.ts
import type { Plugin } from '@opencode-ai/plugin';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, appendFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { Rule, Signal } from './types';
import { HARNESS_DIR, ensureHarnessDirs, getProjectKey, generateId } from './utils';

export const HarnessImprover: Plugin = async (ctx) => {
    ensureHarnessDirs();

    const projectKey = getProjectKey(ctx.worktree);

    return {
        // L5: 세션 종료 시 pending signal 처리
        event: async ({ event }) => {
            if (event.type !== 'session.idle') return;

            const pendingDir = join(HARNESS_DIR, 'signals/pending');
            if (!existsSync(pendingDir)) return;
            const pendingFiles = readdirSync(pendingDir).filter((f) => f.endsWith('.json'));
            if (pendingFiles.length === 0) return;

            for (const file of pendingFiles) {
                const signalPath = join(pendingDir, file);
                let signal: Signal;
                try {
                    signal = JSON.parse(readFileSync(signalPath, 'utf-8'));
                } catch {
                    continue; // 파싱 실패한 signal은 건너뜀
                }

                if (signal.project_key !== projectKey && signal.project_key !== 'global') continue;

                const rule = signalToRule(signal, projectKey);
                if (rule) {
                    const ruleDir = join(HARNESS_DIR, `rules/soft`);
                    mkdirSync(ruleDir, { recursive: true });
                    writeFileSync(join(ruleDir, `${rule.id}.json`), JSON.stringify(rule, null, 2));

                    appendFileSync(
                        join(HARNESS_DIR, 'rules/history.jsonl'),
                        JSON.stringify({
                            action: 'created',
                            rule_id: rule.id,
                            type: 'soft',
                            scope: rule.pattern.scope, // 규칙의 scope를 이력에 기록
                            description: rule.description,
                            source_signal: signal.id,
                            timestamp: new Date().toISOString(),
                        }) + '\n',
                    );
                }

                // signal을 ack로 이동
                const ackDir = join(HARNESS_DIR, 'signals/ack');
                mkdirSync(ackDir, { recursive: true });
                signal.status = 'acked';
                writeFileSync(join(ackDir, file), JSON.stringify(signal, null, 2));
                try {
                    unlinkSync(signalPath);
                } catch {
                    /* 이미 삭제되었거나 권한 문제 — 무시 */
                }
            }

            promoteRules(projectKey);
            evaluateRuleEffectiveness(projectKey);
            updateProjectState(projectKey);
        },

        // L5: 컴팩션 시 하네스 컨텍스트 주입
        'experimental.session.compacting': async (input, output) => {
            // scaffold 주입
            const scaffoldPath = join(HARNESS_DIR, `projects/${projectKey}/scaffold.md`);
            if (existsSync(scaffoldPath)) {
                const scaffold = readFileSync(scaffoldPath, 'utf-8');
                output.context.push(`
## Harness Scaffold (NEVER DO)
${scaffold}

## Active HARD Rules
${loadRulesByType('hard', projectKey).map((r) => `- ${r.description}`).join('\n')}
                `);
            }

            // SOFT 규칙도 컨텍스트에 주입 (차단은 안 하지만 에이전트에게 인지시킴)
            // scope: 'prompt' 규칙은 이 주입이 유일한 강제 수단이다.
            const softRules = loadRulesByType('soft', projectKey);
            if (softRules.length > 0) {
                output.context.push(
                    '## HARNESS SOFT RULES (위반 시 규칙 강화됨)\n' +
                    softRules.map((r) => `- [${r.pattern.scope}] ${r.description}`).join('\n'),
                );
            }
        },
    };
};

function signalToRule(signal: Signal, projectKey: string): Rule | null {
    const id = generateId().slice(0, 8);
    const base = {
        id,
        type: 'soft' as const,
        project_key: projectKey,1.
        created_at: new Date().toISOString(),
        source_signal_id: signal.id,
        violation_count: 0,
    };

    switch (signal.type) {
        case 'error_repeat':
            return {
                ...base,
                pattern: { type: 'code', match: signal.payload.pattern || '', scope: 'tool' },
                description: signal.payload.description,
            };
        case 'user_feedback':
            // scope: 'prompt' → SOFT→HARD 승격 대상이 아님. 컨텍스트 주입으로만 강제.
            return {
                ...base,
                pattern: { type: 'behavior', match: signal.payload.pattern || '', scope: 'prompt' },
                description: `사용자 불만에서 추출: ${signal.payload.description}`,
            };
        case 'fix_commit':
            // Step 2에서 구현. observer의 file.edited 로그 기반으로 session.idle에서 생성.
            return {
                ...base,
                pattern: { type: 'code', match: signal.payload.pattern || '', scope: 'file' },
                description: `fix 커밋에서 추출: ${signal.payload.description}`,
            };
        default:
            return null;
    }
}

function promoteRules(projectKey: string) {
    const softDir = join(HARNESS_DIR, 'rules/soft');
    const hardDir = join(HARNESS_DIR, 'rules/hard');
    if (!existsSync(softDir)) return;

    for (const file of readdirSync(softDir)) {
        if (!file.endsWith('.json')) continue;
        let rule: Rule;
        try {
            rule = JSON.parse(readFileSync(join(softDir, file), 'utf-8'));
        } catch {
            continue;
        }

        if (rule.project_key !== projectKey && rule.project_key !== 'global') continue;

        // scope: 'prompt' 규칙은 승격 대상이 아님 (violation_count가 항상 0)
        // 명시적으로 건너뛰어서 의도를 명확히 한다.
        if (rule.pattern.scope === 'prompt') continue;

        if (rule.violation_count >= 2) {
            rule.type = 'hard';
            rule.promoted_at = new Date().toISOString();
            mkdirSync(hardDir, { recursive: true });
            writeFileSync(join(hardDir, file), JSON.stringify(rule, null, 2));
            try {
                unlinkSync(join(softDir, file));
            } catch {
                /* 무시 */
            }

            appendFileSync(
                join(HARNESS_DIR, 'rules/history.jsonl'),
                JSON.stringify({
                    action: 'promoted',
                    rule_id: rule.id,
                    from: 'soft',
                    to: 'hard',
                    violation_count: rule.violation_count,
                    timestamp: new Date().toISOString(),
                }) + '\n',
            );
        }
    }
}

function evaluateRuleEffectiveness(projectKey: string) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    for (const dir of ['soft', 'hard']) {
        const rulesDir = join(HARNESS_DIR, `rules/${dir}`);
        if (!existsSync(rulesDir)) continue;

        for (const file of readdirSync(rulesDir)) {
            if (!file.endsWith('.json')) continue;
            let rule: Rule;
            try {
                rule = JSON.parse(readFileSync(join(rulesDir, file), 'utf-8'));
            } catch {
                continue;
            }

            if (rule.project_key !== projectKey && rule.project_key !== 'global') continue;
            if (rule.created_at > thirtyDaysAgo) continue;
            if (rule.effectiveness?.measured_at && rule.effectiveness.measured_at > thirtyDaysAgo) continue;

            const recurrence = rule.violation_count;
            rule.effectiveness = {
                measured_at: new Date().toISOString(),
                recurrence_after_rule: recurrence,
                // scope: 'prompt' 규칙은 violation_count=0이므로 항상 'effective'로 판정됨
                status: recurrence === 0 ? 'effective' : recurrence === 1 ? 'warning' : 'needs_promotion',
            };

            writeFileSync(join(rulesDir, file), JSON.stringify(rule, null, 2));
        }
    }
}

function updateProjectState(projectKey: string) {
    const projectDir = join(HARNESS_DIR, `projects/${projectKey}`);
    mkdirSync(projectDir, { recursive: true });

    const softCount = countRules('soft', projectKey);
    const hardCount = countRules('hard', projectKey);
    const pendingCount = countPendingSignals(projectKey);

    const state = {
        project_key: projectKey,
        soft_rule_count: softCount,
        hard_rule_count: hardCount,
        pending_signal_count: pendingCount,
        hard_ratio: softCount + hardCount > 0 ? hardCount / (softCount + hardCount) : 0,
        last_improvement_at: new Date().toISOString(),
    };

    writeFileSync(join(projectDir, 'state.json'), JSON.stringify(state, null, 2));
}

function countRules(type: string, projectKey: string): number {
    const dir = join(HARNESS_DIR, `rules/${type}`);
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter((f) => {
        if (!f.endsWith('.json')) return false;
        try {
            const r = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
            return r.project_key === projectKey || r.project_key === 'global';
        } catch {
            return false;
        }
    }).length;
}

function countPendingSignals(projectKey: string): number {
    const dir = join(HARNESS_DIR, 'signals/pending');
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter((f) => {
        if (!f.endsWith('.json')) return false;
        try {
            const s = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
            return s.project_key === projectKey;
        } catch {
            return false;
        }
    }).length;
}

function loadRulesByType(type: 'soft' | 'hard', projectKey: string): Rule[] {
    const dir = join(HARNESS_DIR, `rules/${type}`);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
            try {
                return JSON.parse(readFileSync(join(dir, f), 'utf-8'));
            } catch {
                return null;
            }
        })
        .filter((r): r is Rule => r && (r.project_key === projectKey || r.project_key === 'global'));
}
```

### 5.2 고도화 확장 포인트

Step 2에서 기본 improver가 동작한 뒤, 다음 확장을 순차적으로 추가한다:

#### 5.2.1 크로스세션 기억 (memory-bank 하위 3단계)

memory-bank의 7단계 파이프라인 중 하위 3단계(Sync, Index, Search)만 구현한다:

- **Sync:** session.idle 이벤트 시 세션 JSONL을 `memory/archive/`에 복사
- **Index:** 세션에서 결정(decision), 선호(preference), 제약(constraint)을 키워드 기반으로 추출하여 `memory/facts/`에 JSON으로 저장
- **Search:** `experimental.session.compacting` 훅에서 관련 fact를 검색하여 컨텍스트에 주입

상위 4단계(Extract, Consolidate, Relate, Recall Surface)는 하네스가 충분히 동작하여 데이터가 축적된 뒤에 구현한다.

> **참고 문서:** [memory-bank-analysis.html](https://hugh-kim.space/memory-bank-analysis.html) — 7-Step Data Flow

#### 5.2.2 이중 모델 검증

Hugh Kim의 codex-integration 패턴을 OpenCode에 적용한다.
OpenCode는 멀티 프로바이더를 지원하므로, 서브에이전트를 다른 모델로 설정하여 크로스 리뷰를 구현할 수 있다.

```json
// opencode.json — 크로스 리뷰 에이전트 설정
{
    "agent": {
        "cross-reviewer": {
            "description": "다른 모델로 코드 리뷰. blind spot 보완",
            "mode": "subagent",
            "model": "openai/gpt-5.4",
            "prompt": "adversarial review 모드. 보안 취약점, 엣지케이스, 타입 안전성에 집중.",
            "tools": { "write": false, "edit": false, "bash": false }
        }
    }
}
```

이중 모델 검증은 하네스의 "3차 방어선"이다:

- 1차: Hook (HARD) — 코드 패턴 차단
- 2차: Harsh Critic (SOFT→HARD) — 행동 패턴 차단
- 3차: 크로스 모델 리뷰 — blind spot 보완

> **참고 문서:** [codex-integration.html](https://hugh-kim.space/codex-integration.html) — 이중 모델 검증 아키텍처

#### 5.2.3 외부 트렌드 자동 수집

trend-harvest-log의 패턴을 플러그인 커스텀 도구(custom tool)로 구현한다.
6시간 주기로 GitHub trending을 수집하고, 5축 철학 필터(자동화·마찰 제거·HARD 전환·토큰 효율·측정 가능)로 평가하여 규칙에 반영한다.

이 기능은 하네스가 안정된 뒤 가장 마지막에 추가한다.

> **참고 문서:** [trend-harvest-log.html](https://hugh-kim.space/trend-harvest-log.html) — 5축 필터와 keep/discard 판정

#### 5.2.4 표면 UX 래핑

내부 스킬/플러그인 기능을 사용자 친화적 커맨드로 래핑한다.
OpenCode의 Commands 기능을 활용:

```
~/.config/opencode/commands/
├── harness-status.md      # 현재 HARD 비율, pending signal 수, 규칙 수
├── harness-history.md     # 규칙 생성/승격 이력
├── harness-eval.md        # 전체 체크리스트 평가 실행
└── harness-measure.md     # 특정 규칙의 효과 측정
```

> **참고 문서:** [loopy-v2-surface-gap.html](https://hugh-kim.space/loopy-v2-surface-gap.html) — 표면 명령 6개 설계

### 5.3 Step 2 검증 기준

1. **L5 검증:** session.idle 후 pending signal이 자동으로 SOFT 규칙으로 변환되는가
2. **L6 검증:** SOFT 규칙(scope: 'tool' 또는 'file')의 violation_count가 2 이상이 되면 HARD로 자동 승격되는가 (enforcer가 count를 올리고, improver가 승격)
3. **scope: 'prompt' 비승격 검증:** scope: 'prompt' 규칙이 HARD로 승격되지 않는 것을 확인
4. **폐루프 검증:** "에러 발생 → signal 생성 → 규칙 생성 → 위반 추적 → 승격 → 다음 세션에서 차단"까지 사람 개입 없이 동작하는가
5. **효과 측정 검증:** 30일 경과한 규칙에 effectiveness 필드가 자동 생성되는가

---

## 6. Step 3 — 하네스↔오케스트레이션 브릿지

> **이 단계의 목표:** 하네스 3개 플러그인의 인터페이스를 정리하고, 오케스트레이터가 호출할 수 있는 계약을 확정한다.
> 새로운 코드를 작성하기보다, 기존 플러그인의 인터페이스를 오케스트레이션 관점에서 검증하고 보완하는 단계.
>
> **참고 문서:**
>
> - 하네스↔오케스트레이션 접점: [loopy-v2-surface-gap.html](https://hugh-kim.space/loopy-v2-surface-gap.html) — /loopy:start, /loopy:auto 래퍼
> - 오케스트레이터 진화 교훈: [orchestrator-evolution.html](https://hugh-kim.space/orchestrator-evolution.html)

### 6.1 인터페이스 계약 정의

오케스트레이터가 하네스를 사용할 때의 계약:

```typescript
// 오케스트레이터 → 하네스 인터페이스
interface HarnessContract {
    getProjectState(projectKey: string): ProjectState;
    getActiveRules(projectKey: string): Rule[];
    getScaffold(projectKey: string): string;
    emitSignal(signal: Omit<Signal, 'id' | 'timestamp' | 'status'>): void;
    runEval(projectKey: string): EvalResult;
}

interface EvalResult {
    total_checks: number;
    passed_checks: number;
    hard_ratio: number;
    failures: string[];
}
```

이 계약은 파일 시스템을 통해 구현된다 — 함수 호출이 아니라 파일 읽기/쓰기로:

- `getProjectState` → `projects/{project-key}/state.json` 읽기
- `getActiveRules` → `rules/hard/` 디렉토리 스캔
- `getScaffold` → `projects/{project-key}/scaffold.md` 읽기
- `emitSignal` → `signals/pending/` 에 파일 쓰기
- `runEval` → `metrics/results.tsv`에 결과 추가

### 6.2 서브에이전트가 하네스 통제를 받는 구조

오케스트레이터가 서브에이전트를 띄울 때, 하네스의 enforcer가 모든 서브에이전트에 동일하게 적용된다.
이것이 가능한 이유: OpenCode의 플러그인 훅(tool.execute.before)은 모든 에이전트(primary + subagent)의 도구 실행에 적용되기 때문이다.

따라서 오케스트레이터는 별도의 품질 제어 로직을 구현할 필요가 없다. 하네스가 이미 모든 에이전트를 감싸고 있다.

### 6.3 브릿지 단계에서 보완할 항목

1. **enforcer에 scaffold 프롬프트 주입 추가:** `experimental.session.compacting` 훅을 활용한다. 컴팩션 시점에 SOFT 규칙을 컨텍스트에 주입하면, 컴팩션 이후에도 규칙이 유지된다. 이미 improver에서 이 훅을 사용하고 있으므로, enforcer 쪽에서도 동일한 훅에 SOFT 규칙을 추가 주입하는 방식으로 통합한다.

단, 컴팩션은 세션이 길어졌을 때만 발생하므로 세션 초반에는 적용되지 않는다. 세션 시작부터 SOFT 규칙을 적용하려면 OpenCode의 Rules 기능(`.opencode/rules/` 마크다운 파일)을 병행한다. improver가 SOFT 규칙 생성 시 `rules/soft/`에 JSON을 쓰는 동시에 `.opencode/rules/harness-soft-rules.md`도 자동 갱신하는 방식이다.

2. **signal에 agent_id 필드 추가:** 오케스트레이션 환경에서는 어떤 에이전트가 신호를 발생시켰는지 추적해야 한다. Signal 스키마에 `agent_id?: string` 필드를 추가한다.

3. **git push gate 활성화:** Step 1에서 주석 처리했던 push 전 증거 파일 체크를 HARD로 전환한다.

### 6.4 교훈 체크리스트

orchestrator-evolution.html에서 추출한, 오케스트레이션 구현 전 반드시 확인할 교훈:

| 교훈                | 체크 항목                                              | 확인 |
| ------------------- | ------------------------------------------------------ | ---- |
| 에이전트 팽창 방지  | 서브에이전트 수가 12개를 넘지 않는가                   | ☐    |
| 파일 = 진실         | 외부 MCP 의존 없이 파일만으로 상태 관리 가능한가       | ☐    |
| 계약 먼저           | QA 시나리오(계약)가 코드보다 먼저 정의되어 있는가      | ☐    |
| 세밀한 에스컬레이션 | 시나리오별 3회 실패 기준인가 (전체 3회가 아닌)         | ☐    |
| 모델 전략           | Manager는 opus급, Specialist는 sonnet급으로 분리했는가 | ☐    |

---

## 7. Step 4 — 오케스트레이션 구현

> **이 단계의 목표:** 멀티 에이전트 태스크 분배·조율 플러그인을 구현한다.
> 하네스 3개 플러그인이 모든 에이전트의 품질을 보장하는 기반 위에서, 오케스트레이터는 순수하게 "조율"에만 집중한다.
> **이 섹션은 설계 방향만 제시한다.** 완전한 Plugin export 골격과 훅 연결은 Step 3(브릿지) 완료 후 실제 구현 시 작성한다.
>
> **참고 문서:**
>
> - 3계층 아키텍처, 8-Phase 워크플로우: [manager-orchestrator (GitHub)](https://github.com/jung-wan-kim/manager-orchestrator)
> - v1→v5 진화 이력, 안티패턴: [orchestrator-evolution.html](https://hugh-kim.space/orchestrator-evolution.html)

### 7.1 Plugin 4: harness-orchestrator

**역할:** 사용자 요청 → 계획 수립 → 서브에이전트 분배 → 결과 검증 → QA → 완료
**위치:** `src/orchestrator.ts` (프로젝트 레벨에서 활성화)

#### 아키텍처: 3계층 매핑

Hugh Kim의 3계층을 OpenCode에 매핑:

| Hugh Kim 계층                        | OpenCode 대응                                             | 역할           |
| ------------------------------------ | --------------------------------------------------------- | -------------- |
| Layer 1: Manager-Orchestrator (opus) | Primary Agent "build" (opus 모델) + orchestrator 플러그인 | 계획·분배·검증 |
| Layer 2: Specialist Agents (sonnet)  | Subagents (sonnet 모델)                                   | 실제 구현      |
| Layer 3: Hooks (자동 정책 강제)      | harness-enforcer 플러그인                                 | 품질 강제      |

#### 에이전트 설정

```json
// opencode.json
{
    "agent": {
        "build": {
            "description": "프로젝트 매니저. 코드를 직접 쓰지 않고 계획·분배·검증만 수행",
            "mode": "primary",
            "model": "anthropic/claude-opus-4-6",
            "prompt": "{file:.opencode/prompts/orchestrator.md}"
        },
        "plan": {
            "description": "분석과 계획만 수행. 코드 변경 불가.",
            "mode": "primary",
            "model": "anthropic/claude-opus-4-6",
            "prompt": "{file:.opencode/prompts/plan.md}",
            "permissions": { "file_edit": "deny", "bash": "ask" }
        },
        "frontend": {
            "description": "프론트엔드 구현 전문. React/Next.js/TypeScript",
            "mode": "subagent",
            "model": "anthropic/claude-sonnet-4-20250514",
            "prompt": "{file:.opencode/prompts/frontend.md}"
        },
        "backend": {
            "description": "백엔드 구현 전문. API/DB/인프라",
            "mode": "subagent",
            "model": "anthropic/claude-sonnet-4-20250514",
            "prompt": "{file:.opencode/prompts/backend.md}"
        },
        "tester": {
            "description": "QA 테스트 작성 및 실행",
            "mode": "subagent",
            "model": "anthropic/claude-sonnet-4-20250514",
            "prompt": "{file:.opencode/prompts/tester.md}"
        },
        "reviewer": {
            "description": "코드 리뷰. 보안, 성능, 유지보수성 검토",
            "mode": "subagent",
            "model": "anthropic/claude-sonnet-4-20250514",
            "prompt": "{file:.opencode/prompts/reviewer.md}",
            "permissions": { "file_edit": "deny" }
        },
        "cross-reviewer": {
            "description": "다른 모델로 blind spot 보완 리뷰 (adversarial review. 보안 취약점, 엣지케이스에 집중.)",
            "mode": "subagent",
            "model": "openai/gpt-5.4",
            "prompt": "{file:.opencode/prompts/cross-reviewer.md}",
            "permissions": { "file_edit": "deny", "bash": "deny" }
        }
    }
}
```

#### 5-Phase 워크플로우

```
Phase 1: 계획 수립
  ├── 사용자 요청 분석
  ├── docs/plan.md 생성 (아키텍처, 파일 구조, 기술 스택)
  └── 서브에이전트별 태스크 정의

Phase 2: 아키텍처 + QA 계약 (Phase 2.5)
  ├── @frontend, @backend에게 설계 검토 요청
  ├── docs/qa-test-plan.md 생성 ← 가장 중요한 변화
  │   QA 시나리오가 코드보다 먼저 확정된다.
  │   시나리오 = 코드가 통과해야 할 "계약"
  └── QA 시나리오 미확정 시 Phase 3 진입 금지

Phase 3: 구현
  ├── @frontend, @backend에게 태스크 위임 (@ mention)
  ├── 병렬 가능한 태스크는 동시 위임
  └── 각 서브에이전트는 하네스 enforcer의 통제를 받음

Phase 4: QA + 수정 루프
  ├── @tester에게 qa-test-plan.md 기반 테스트 실행
  ├── 실패 시 해당 서브에이전트에게 수정 위임
  │   전달 정보: 시나리오 ID + 실패 횟수 + 예상/실제 결과
  ├── 동일 시나리오 3회 실패 시 사용자 에스컬레이션
  └── @reviewer + @cross-reviewer 코드 리뷰

Phase 5: 완료
  ├── 최종 빌드 검증
  ├── 하네스 eval 실행 (HARD 비율 체크)
  ├── 하네스 signal 주입 (이번 세션의 learning)
  └── git commit + push (qa-evidence 존재 시에만)
```

#### Phase 상태 관리

Phase 전환을 프로그래밍적으로 감지하는 것은 어렵다. 에이전트가 "Phase 3를 시작하겠습니다"라고 명시적으로 선언하지 않는 한, 도구 호출만으로는 현재 Phase를 알 수 없다. 따라서 **Phase 상태를 파일로 명시적으로 관리**한다.

```typescript
// Phase 상태 파일: .opencode/orchestrator-phase.json
interface PhaseState {
    current_phase: 1 | 2 | 3 | 4 | 5;
    phase_history: Array<{
        phase: number;
        entered_at: string;
        completed_at?: string;
    }>;
    qa_test_plan_exists: boolean;
}

// Phase 전환 시 파일 업데이트 + Phase 2.5 gate
function transitionPhase(ctx: any, targetPhase: number) {
    const statePath = join(ctx.worktree, '.opencode/orchestrator-phase.json');
    const state: PhaseState = existsSync(statePath)
        ? JSON.parse(readFileSync(statePath, 'utf-8'))
        : { current_phase: 1, phase_history: [], qa_test_plan_exists: false };

    // Phase 2.5 gate: Phase 3 진입 전 qa-test-plan.md 존재 확인
    if (targetPhase === 3) {
        const qaTestPlan = join(ctx.worktree, 'docs/qa-test-plan.md');
        if (!existsSync(qaTestPlan)) {
            throw new Error(
                '[ORCHESTRATOR BLOCK] Phase 3 진입 불가.\n' +
                'docs/qa-test-plan.md가 존재하지 않습니다.\n' +
                'Phase 2.5에서 QA 시나리오를 먼저 확정하세요.',
            );
        }
        state.qa_test_plan_exists = true;
    }

    const lastEntry = state.phase_history[state.phase_history.length - 1];
    if (lastEntry && !lastEntry.completed_at) {
        lastEntry.completed_at = new Date().toISOString();
    }

    state.current_phase = targetPhase as any;
    state.phase_history.push({ phase: targetPhase, entered_at: new Date().toISOString() });
    writeFileSync(statePath, JSON.stringify(state, null, 2));
}
```

#### 에스컬레이션: 파일 기반 시나리오별 실패 추적

Hugh Kim v5의 교훈: **전체 3회가 아니라 동일 시나리오 3회.**

QA 실패 추적은 파일 기반으로 관리한다. 인메모리 Map은 프로세스 재시작 시 손실되므로 사용하지 않는다.

```typescript
interface QAFailures {
    [scenarioId: string]: {
        count: number;
        last_failure_at: string;
        details: string[];
    };
}

function trackQAFailure(projectKey: string, scenarioId: string, detail: string): 'retry' | 'escalate' {
    const filePath = join(HARNESS_DIR, `projects/${projectKey}/qa-failures.json`);
    let failures: QAFailures = {};

    try {
        if (existsSync(filePath)) {
            failures = JSON.parse(readFileSync(filePath, 'utf-8'));
        }
    } catch {
        failures = {};
    }

    if (!failures[scenarioId]) {
        failures[scenarioId] = { count: 0, last_failure_at: '', details: [] };
    }

    failures[scenarioId].count += 1;
    failures[scenarioId].last_failure_at = new Date().toISOString();
    failures[scenarioId].details.push(detail);

    mkdirSync(join(HARNESS_DIR, `projects/${projectKey}`), { recursive: true });
    writeFileSync(filePath, JSON.stringify(failures, null, 2));

    if (failures[scenarioId].count >= 3) return 'escalate';
    return 'retry';
}
```

### 7.2 Step 4 검증 기준

1. **계획 검증:** 사용자 요청이 plan.md로 분해되고, 서브에이전트별 태스크가 정의되는가
2. **계약 검증:** qa-test-plan.md 없이 Phase 3에 진입하려 하면 차단되는가
3. **분배 검증:** @mention으로 서브에이전트에게 태스크가 위임되는가
4. **하네스 연동 검증:** 서브에이전트의 도구 실행이 harness-enforcer에 의해 HARD 차단되는가
5. **QA 루프 검증:** 시나리오 실패 → 수정 위임 → 재QA 루프가 동작하는가
6. **에스컬레이션 검증:** 동일 시나리오 3회 실패 시 사용자에게 에스컬레이션되는가
7. **Phase 상태 검증:** `.opencode/orchestrator-phase.json`이 Phase 전환마다 정확히 업데이트되는가

---

## 8. 참고 문서 인덱스

### Step 1 (하네스 초안) 참고

| 문서                       | URL                                                            | 역할                                                                    |
| -------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Self-Evolving System       | [링크](https://hugh-kim.space/self-evolving-system.html)       | **핵심.** 3개 피드백 루프, SOFT→HARD 승격, hook 구조의 원본 설계도      |
| Claude Code Harness System | [링크](https://hugh-kim.space/claude-code-harness-system.html) | **핵심.** L1~L6 레이어 정의, 36개 HARD 체크리스트, 15단계 파이프라인    |
| Harsh Critic               | [링크](https://hugh-kim.space/harsh-critic.html)               | 행동 패턴 차단 레이어. 코드 hook이 못 잡는 "떠넘기기", "거짓 보고" 차단 |
| OpenCode Plugins 공식 문서 | [링크](https://opencode.ai/docs/plugins/)                      | 플러그인 구조, 훅 목록, 로드 순서, 예제                                 |
| OpenCode Agents 공식 문서  | [링크](https://opencode.ai/docs/agents/)                       | 에이전트 타입, 서브에이전트, @mention 호출, 설정 방법                   |

### Step 2 (하네스 고도화) 참고

| 문서                 | URL                                                      | 역할                                                        |
| -------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| Codex QA Integration | [링크](https://hugh-kim.space/codex-integration.html)    | 이중 모델 검증, 3중 강제 게이트, 에러 복구 4단계            |
| Codex Loop Era L6    | [링크](https://hugh-kim.space/codex-loop-era-l6.html)    | practical L6 구현, wrapper 기반 폐루프, acceptance plane    |
| Memory Bank Analysis | [링크](https://hugh-kim.space/memory-bank-analysis.html) | 크로스세션 기억, 7-Step 파이프라인 (하위 3단계만 초기 구현) |
| Trend Harvest Log    | [링크](https://hugh-kim.space/trend-harvest-log.html)    | 외부 트렌드 자동 수집, 5축 필터, keep/discard 판정          |
| Loopy V2 Surface Gap | [링크](https://hugh-kim.space/loopy-v2-surface-gap.html) | 내부 기능→표면 UX 래핑, 6개 사용자 명령 설계                |

### Step 3 (브릿지) 참고

| 문서                       | URL                                                        | 역할                                                                     |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| Loopy V2 Surface Gap       | [링크](https://hugh-kim.space/loopy-v2-surface-gap.html)   | /loopy:start와 /loopy:auto가 하네스↔오케스트레이션 접점                  |
| Orchestrator 진화 히스토리 | [링크](https://hugh-kim.space/orchestrator-evolution.html) | 에이전트 팽창→정리, 파일=진실, 계약 먼저 패턴 — 브릿지 설계 시 필수 교훈 |

### Step 4 (오케스트레이션) 참고

| 문서                          | URL                                                          | 역할                                                                       |
| ----------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Manager-Orchestrator (GitHub) | [링크](https://github.com/jung-wan-kim/manager-orchestrator) | 3계층 아키텍처, Phase별 워크플로우, 에이전트 구성                          |
| Orchestrator 진화 히스토리    | [링크](https://hugh-kim.space/orchestrator-evolution.html)   | v1→v5 안티패턴 목록: 에이전트 수 제한, 에스컬레이션 세밀화, 병렬 실행 격리 |

---

## 부록: grep 한계와 런타임 검증

Hugh Kim이 스스로 인정한 핵심 한계:
36개 체크 중 35개가 grep 기반이고 1개만 bash -n 런타임 체크.
"문서에 적혀있다"는 증명할 수 있지만 "실행된다"는 증명할 수 없다.

이 하네스를 OpenCode에 구현할 때 이 한계를 의식적으로 개선해야 한다:

1. **tool.execute.after에서 실제 출력을 검증한다.** grep이 아니라 도구의 실행 결과를 직접 확인한다.
2. **violation_count는 실제 위반 횟수를 추적한다.** enforcer가 SOFT 위반을 감지한 횟수(scope: 'tool', 'file')와 HARD 차단 횟수가 곧 위반 횟수다. scope: 'prompt'는 도구 시점에서 감지 불가하므로 별도 경로(컨텍스트 주입)로 처리한다.
3. **eval은 파일 존재가 아니라 동작 결과를 측정한다.** "규칙 파일이 있는가"가 아니라 "해당 패턴이 최근 N세션에서 차단된 적 있는가"를 본다.

이렇게 하면 grep 천장을 넘어 런타임 검증 비율을 높일 수 있다.

---

> **이 문서의 갱신 주기:** 각 Step 완료 시마다 해당 섹션의 "검증 기준"을 통과했는지 기록하고, 다음 Step의 구현 전에 문서를 업데이트한다.
