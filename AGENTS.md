# Role & Identity

- 당신은 이 프로젝트의 전담 AI 코딩 어시스턴트입니다.
- 주력 분야: OpenCode 플러그인 개발, 하네스(Harness) 시스템 아키텍처, 멀티 에이전트 오케스트레이션.

# Project Overview

## 프로젝트명 (임시)

**harness-orchestration** — OpenCode 플러그인 기반 하네스 + 오케스트레이션 시스템

## 목표

Hugh Kim의 하네스/오케스트레이션 아키텍처를 OpenCode 플러그인 시스템 위에 재구현한다.
단일 에이전트 품질 제어(하네스)부터 멀티 에이전트 조율(오케스트레이션)까지 4단계로 점진적으로 구축한다.

## 핵심 문서

| 문서 | 경로 | 용도 |
|------|------|------|
| 가이드 | `/docs/opencode-harness-orchestration-guide-v3-final.md` | **유일한 진실의 원천.** 모든 구현은 이 문서를 기준으로 한다 |

**구현 시 v3-final과 충돌하면 v3-final이 항상 우선이다.**

## 4단계 구축 로드맵

| Step | 내용 | 플러그인 | 상태 |
|------|------|----------|------|
| 1 | 하네스 초안 | observer + enforcer | ✅ 완료 |
| 2 | 하네스 고도화 | + improver | ✅ 완료 |
| 3 | 브릿지 | .opencode/rules/ 병행 + 크로스세션 기억(Index, Search) + history 로테이션 + fix: 파싱 고도화 | ✅ 완료 |
| 4 | 오케스트레이션 | + orchestrator (에러 복구 4단계, 이중 모델 검증, 5-Phase, 서브에이전트) | 구현 전 |

### Step 3 구현 범위 (확정)

| 항목 | 내용 | 근거 |
|------|------|------|
| `.opencode/rules/` 병행 | scope:prompt 규칙을 세션 시작부터 노출. compacting은 긴 세션에서만 발동하므로 짧은 세션에서도 규칙이 보이도록 | v3 5.2.4, 실제 갭 |
| 크로스세션 기억 하위 3단계 | Sync(이미 observer가 함) + Index(JSONL → 키워드 인덱스) + Search(키워드 기반 회수). 상위 4단계(Extract~Recall)는 데이터 축적 후 | v3 5.2.1 |
| history.jsonl 로테이션 | 파일 사이즈 체크 + 일정 크기 초과 시 rotate. 10줄 수준의 간단한 유틸 | 오라클 I4 |

### Step 4 구현 범위 (확정)

| 항목 | 내용 | v3 섹션 |
|------|------|---------|
| 에러 복구 4단계 | 1차 직접수정 → 2차 구조변경 → 3차 다른 모델 rescue → 4차 리셋 | 5.2.2 |
| 이중 모델 검증 (cross-reviewer) | 다른 모델로 코드 리뷰. `model: "openai/gpt-5.4"`, `file_edit: deny, bash: deny` | 5.2.2, 7.1 |
| 5-Phase 워크플로우 | build → frontend → backend → tester → reviewer. Phase 간 의존성 관리 | 7장 |
| Phase 2.5 gate | 서브에이전트 완료 후 품질 게이트 | 7장 |
| 서브에이전트 정의 | agents.ts + prompts/*.md | 7.1 |

### Step 4 이후 고도화 (시기 미정)

| 항목 | 선행 조건 |
|------|----------|
| 크로스세션 기억 상위 4단계 (Extract, Consolidate, Relate, Recall) | 데이터 충분히 축적 후 |
| 규칙 자동 삭제 (Pruning) | 규칙 수십 개 이상 쌓일 때 |
| Compacting 토큰 한계 대응 (선택적 주입) | 규칙 수십 개 시 |
| 외부 트렌드 자동 수집 | 하네스 완전 안정화 후, 가장 마지막 |
| LLM 기반 Phase 구조 (#A) + LLM 기반 signal 판정 (#B) | deterministic 매핑으로 실제 데이터 축적 후, 틀린 규칙 패턴 파악 후 |
| fix: 커밋 패턴 추출 고도화 | 실동작에서 source_file 빈 문자열 이슈. git log 파싱 보강 + 파일 경로 정확도 개선 |

### 사용 안 함 (의식적 제외)

| 항목 | 이유 |
|------|------|
| 인터페이스 계약 확정 (명시적) | types.ts + 파일 구조가 이미 계약. 문서 정리일 뿐 코드 변경 없음 |
| harness-status / harness-eval 커스텀 도구 | `cat state.json`으로 충분. 규칙 수십 개 시 필요해지면 그때 추가 |
| Cross-Project 승격 | 단일 프로젝트 환경. 필요해지면 그때 |

## 핵심 아키텍처 원칙

1. **파일 = 진실:** DB/IPC 없이 파일 시스템만으로 상태 관리. `~/.config/opencode/harness/` 디렉토리가 유일한 진실의 원천.
2. **하네스 먼저:** 오케스트레이션보다 하네스를 먼저 구현. 서브에이전트가 하네스의 통제를 자동으로 받도록.
3. **SOFT→HARD 자동 승격:** 모든 규칙은 SOFT로 시작. 위반 2회 이상 재발 시 HARD로 자동 승격. 단, `scope: 'prompt'` 규칙은 승격 대상이 아님.
4. **단일 패키지, 다중 export:** 4개 플러그인을 하나의 npm 패키지로 배포. 미완성 레이어는 export에서 제외.
5. **공통 유틸리티 분리:** `utils.ts`의 `getProjectKey`, `ensureHarnessDirs` 등은 각 플러그인에서 반드시 import. 절대 복붙하지 않음.

## L1~L6 성숙도 모델

| Level | 의미 | 구현 Step |
|-------|------|-----------|
| L1 | 관측 가능성 | Step 1 (observer) |
| L2 | 신호 변환 | Step 1 (observer) |
| L3 | 프로젝트 격리 | Step 1 (enforcer) |
| L4 | 규칙 차단 | Step 1 (enforcer) |
| L5 | 자동 수정 | Step 2 (improver) |
| L6 | 폐루프 | Step 2 (improver) |

## scope: 'prompt' 설계 결정

행동 패턴("떠넘기기", "거짓 보고" 등)은 `tool.execute.before`에서 위반을 감지할 수 없다.
따라서 `scope: 'prompt'` 규칙은:
- enforcer에서 위반 추적에서 제외 (violation_count가 증가하지 않음)
- SOFT→HARD 승격 대상이 아님
- `experimental.session.compacting` 훅의 컨텍스트 주입으로만 강제 (Step 2)
- **Step 3에서 `.opencode/rules/` 병행 완료** — 세션 시작부터 prompt 규칙이 노출됨 (syncRulesMarkdown)
- 이것은 의도된 설계 결정이며, Hugh Kim의 harsh-critic 레이어와 동일한 분류

# Development Workflow: OpenSpec 기반

이 프로젝트는 **OpenSpec**을 사용하여 Spec-Driven Development 방식으로 개발한다.
OpenSpec은 파일 시스템 기반의 상태 관리를 통해 세션이 날아가도 작업 상태를 유지한다.

## OpenSpec 기본 명령

| 명령 | 용도 |
|------|------|
| `/opsx-explore` | 탐색 모드. 아이디어 구상, 문제 조사. 코드 작성 금지 |
| `/opsx-propose` | 새 Change 생성 + 모든 아티팩트 한 번에 생성 (proposal, design, tasks) |
| `/opsx-apply` | tasks.md의 체크리스트를 순서대로 코드로 구현 |
| `/opsx-archive` | 완료된 Change를 아카이브. Delta Spec을 메인 Spec에 병합 |

## 기본 워크플로우

```
/opsx-explore (탐색) → /opsx-propose (계획) → /opsx-apply (구현) → /opsx-archive (완료)
```

### 구현 시 필수 준수 사항
**[구현 전] 사전 숙지:** 각 단계/레이어 작업 시작 전, `/docs/opencode-harness-orchestration-guide-v3-final.md` 내 작업 범위에 해당하는 내용과 함께 첨부된 참고 링크를 반드시 완독한다.
**[구현 후] 실동작 검증:** 각 단계/레이어 작업 완료 시, MOCK/SMOKE 테스트뿐만 아니라 가벼운 실제 요청/응답을 수행하여 빌드 신뢰도와 실제 동작 가능 여부를 모두 검증한다.

## 하네스 Step별 OpenSpec 매핑

| 하네스 Step | OpenSpec Change명 | 아티팩트 |
|-------------|-------------------|----------|
| Step 1 | `harness-step1-core` | proposal: L1~L4 목표, design: 공유 저장소 스키마 + 훅 매핑, tasks: 검증 기준 6개 |
| Step 2 | `harness-step2-improver` | Delta Spec: Step 1 대비 추가/변경. proposal: L5~L6 목표 |
| Step 3 | `harness-step3-bridge` | proposal: .opencode/rules/ 병행 + 기억 Index/Search + history 로테이션, tasks: 브릿지 보완 항목 |
| Step 4 | `harness-step4-orchestrator` | design: 5-Phase 워크플로우, tasks: Phase 2.5 gate 구현 |

## OpenSpec 디렉토리 구조

```
openspec/
├── config.yaml          # 프로젝트 설정 (schema: spec-driven)
├── specs/               # Source of Truth (현재 시스템 동작)
└── changes/             # 활성/완료된 변경사항
    ├── {change-name}/   # 활성 Change
    │   ├── .openspec.yaml
    │   ├── proposal.md
    │   ├── design.md
    │   └── tasks.md
    └── archive/         # 완료된 Changes
```

## 세션 재개

세션이 꺼지거나 바뀌어도:
- `openspec/changes/{name}/tasks.md`의 체크박스(`- [ ]` / `- [x]`)로 진행률 파악
- `/opsx-apply` 실행 시 체크 안 된 항목부터 자동 재개
- 이전 세션의 아티팩트(proposal, design)를 읽어 컨텍스트 복원

## 하네스와 OpenSpec의 시너지

| 활용 | 설명 |
|------|------|
| 초기 scaffold | `openspec/specs/`의 시스템 동작 문서 → scaffold NEVER DO의 초기 소스 |
| 초기 memory | `design.md`의 기술적 결정 → memory/facts/의 초기 데이터 |
| fix: 커밋 학습 | OpenSpec 아카이브 히스토리 → 과거 실수 패턴 추적에 활용 |
| Delta Spec | "무엇이 변경되는가" → fix_commit signal의 정교한 버전 |
| 검증 기준 | 각 Step의 검증 기준 → tasks.md 체크리스트로 추적 |

# Code Conventions

## 플러그인 코드 구조

```
/src/
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

## 코딩 규칙

1. **스키마는 types.ts에만 정의.** 플러그인별 축소 버전 재정의 금지. import해서 사용.
2. **공통 함수는 utils.ts에서만 정의.** 복붙하면 서로 다른 project_key가 생성되어 치명적 버그 발생.
3. **각 플러그인은 초기화 시 `ensureHarnessDirs()` 호출.** observer만 호출하는 것이 아니라 모든 플러그인이 idempotently 자기 디렉토리를 보장.
4. **`import { randomUUID } from 'crypto'` 사용.** 전역 `crypto.randomUUID()` 대신 명시적 import.
5. **모든 `new RegExp()` 호출은 `safeRegexTest()`로 감싸기.** 잘못된 패턴이 들어오면 플러그인 전체가 멈춤.
6. **플러그인 export는 `export default { id, server() }` 패턴 사용.** (아래 참조)

### 플러그인 Export 패턴 (v1 형식 — 필수)

OpenCode는 `export default { id, server() }` 패턴(v1)을 사용한다. `export const PluginName = async (ctx) => {}` 패턴(legacy)도 동작하지만 명시적이지 않으므로 사용하지 않는다.

```typescript
// ✅ 올바른 패턴 (v1 — 반드시 이 방식 사용)
// src/index.ts
export default {
  id: "my-harness",
  server: async (input) => {
    const ctx = { worktree: input.worktree };
    const observerHooks = await HarnessObserver(ctx);
    const enforcerHooks = await HarnessEnforcer(ctx);
    return { ...observerHooks, ...enforcerHooks };
  },
};

// ❌ legacy 패턴 (동작은 하지만 사용하지 않음)
export const MyPlugin = async (ctx) => {
  return { "tool.execute.before": async (input, output) => { ... } };
};
```

**핵심:** 로컬(file) 플러그인은 `id` 필드가 필수. npm 패키지는 `package.json`의 `name`을 사용.

### 개발 및 테스트 워크플로우

**필수 숙지**

자세한 개발/테스트 절차는 [`/docs/development-guide.md`](/docs/development-guide.md)를 참조.

## API 확인 문서

모든 OpenCode Plugin API 필드는 소스코드에서 확인 완료. 상세 내용은 [`/docs/api-confirmation.md`](/docs/api-confirmation.md)를 참조.

## 런타임 데이터

런타임 데이터는 `~/.config/opencode/harness/`에 자동 생성된다.
이 디렉토리는 `.gitignore`에 포함하며, 환경 간 동기화가 필요하면 선택적으로 git repo로 관리한다.

# Key References

## 공식 문서

- [OpenCode Plugins](https://opencode.ai/docs/plugins/) — 플러그인 구조, 훅 목록, 로드 순서
- [OpenCode Agents](https://opencode.ai/docs/agents/) — 에이전트 타입, 서브에이전트, @mention 호출
- [OpenSpec Workflows](https://github.com/Fission-AI/OpenSpec/blob/main/docs/workflows.md) — 워크플로우 정의