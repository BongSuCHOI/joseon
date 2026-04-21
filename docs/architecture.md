# System Architecture

## Overview

**harness-orchestration**은 Hugh Kim의 하네스/오케스트레이션 아키텍처를 OpenCode 플러그인으로 재구현한 프로젝트다. 단일 에이전트 품질 제어(하네스)부터 멀티 에이전트 조율(오케스트레이션)까지 점진적으로 구축했다.

- **참고 문서:** `docs/v3-final.md` (초기 구현 가이드, 현재는 레거시)
- **핵심 원칙:** 파일 = 진실. DB/IPC 없이 파일 시스템만으로 상태 관리. `~/.config/opencode/harness/`가 유일한 진실의 원천.
- **배포 형태:** 단일 npm 패키지, 다중 플러그인 export.

---

## Build Roadmap

| Step | 내용 | 플러그인 | 상태 |
|------|------|----------|------|
| 1 | 하네스 초안 | observer + enforcer | ✅ 완료 |
| 2 | 하네스 고도화 | + improver | ✅ 완료 |
| 3 | 브릿지 | `.opencode/rules/` + Memory Index/Search + history 로테이션 | ✅ 완료 |
| 4 | 오케스트레이션 | + orchestrator (서브에이전트 라우팅, QA 추적 연동) | ✅ 완료 |
| 5a~5h | Shadow/Guarded-Off 인프라 | canary + ack plane + candidate grouping | ✅ 완료 (전부 활성화 — .opencode/harness.jsonc에서 토글 ON) |
| Token Opt. | 토큰 최적화 | Observer 낭비 탐지기(3개) + Memory Recall 3계층 공개 + Fact TTL/접근 추적 | ✅ 완료 |
| Mem v3.2 Phase 1a | 파일 기반 의미론 | Promotion Control + Hot Context + Boundary Hint + Contradiction Surfacing + 안전 퓨즈 확장 + 메트릭 | ✅ 완료 (default-off, .opencode/harness.jsonc에서 4개 토글) |

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
- `tool_loop`: 동일 툴+args 반복 호출이 `tool_loop_threshold`(기본 5) 도달 시 Signal 생성
- `retry_storm`: 에러→재시도 사이클이 `retry_storm_threshold`(기본 3) 도달 시 Signal 생성
- `excessive_read`: 동일 파일 반복 읽기가 `excessive_read_threshold`(기본 4) 도달 시 Signal 생성

**Signal 생성 흐름:**
```
이벤트 관측 → 패턴 매칭 (에러 반복/불만 키워드/fix 커밋)
    → pending/{id}.json에 Signal 저장
```

**낭비 탐지기 (Token Optimization):**
Observer의 `tool.execute.after` 훅에서 프록시 메트릭(툴 호출 횟수, 반복 패턴)을 기반으로 토큰 낭비 패턴을 감지한다. OpenCode API에서 실제 토큰 수를 알 수 없으므로 프록시 메트릭을 사용한다. 3개 탐지기 모두 인메모리 Map으로 세션별 추적하며, `session.created`/`session.deleted`에서 자동 초기화된다.

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
- **주입 순서:** hot context → scaffold → HARD 규칙 → SOFT 규칙 → 메모리 (3계층)
  - Phase 1a hot context는 `hot_context_enabled=true` 시에만 scaffold 앞에 주입
  - Boundary hint는 `boundary_hint_enabled=true` 시 L1/L2 레이어에 포함
- `scope:prompt` 규칙은 세션 시작부터 `.opencode/rules/`에 노출되어, compacting이 발동하지 않는 짧은 세션에서도 에이전트가 규칙을 인지
- **Project-scoped 격리:** compacting은 현재 project_key와 일치하는 fact만 주입. 다른 프로젝트 fact와 legacy(빈 project_key) fact는 제외

#### Memory Fact 접근 추적 및 TTL

- **접근 추적:** compacting 주입 시 적용된 fact의 `access_count`를 증가시키고 `last_accessed_at`을 갱신
- **TTL 기반 정리:** `access_count=0`인 fact가 `fact_ttl_days`(기본 30일) 경과 시 archive로 이동
- **TTL 연장:** `access_count ≥ fact_ttl_extend_threshold`(기본 5)인 fact는 TTL이 2배로 연장
- **하위 호환:** 기존 fact 파일에 `last_accessed_at`/`access_count` 필드가 없어도 기본값으로 동작

#### 3계층 점진적 공개 (Memory Recall)

compacting 시 모든 fact를 전체 내용으로 주입하는 대신, 점수에 따라 3계층으로 나누어 주입한다.

- **Layer 3 (전체):** 점수 상위 30% fact — id + 전체 내용 + keywords (~200 토큰/fact)
- **Layer 2 (요약):** 점수 중간 40% fact — id + keywords + 첫 문장 (~50 토큰/fact)
- **Layer 1 (인덱스):** 점수 하위 30% fact — id + keywords만 (~15 토큰/fact)
- **조건:** `semantic_compacting_enabled=true` + fact > 2개일 때만 적용. 비활성화 시 기존 방식(L3 전체) 유지

#### Phase 1a: 파일 기반 의미론 (Memory v3.2)

Phase 1a는 SQLite/벡터/LLM 없이 기존 파일 기반 시스템에 의미적 패턴을 흡수한다. 모든 기능은 `.opencode/harness.jsonc`의 5개 토글로 제어되며, 기본값은 모두 `false`다.

**토글 설정:**

| 설정 | 기본값 | 담당 기능 |
|------|--------|-----------|
| `hot_context_enabled` | `false` | Hot Context 생성 + compacting 주입 |
| `rich_fact_metadata_enabled` | `false` | fact 메타데이터 자동 분류 (origin_type/confidence/status) |
| `confidence_threshold_active` | `0.7` | confidence ≥ 임계값 → active, 미만 → unreviewed |
| `boundary_hint_enabled` | `false` | compacting 시 L1/L2 boundary hint 포함 |
| `gate_a_monitoring_enabled` | `false` | Gate A 자동 평가 + status/alerts 기록 + compacting advisory |

**기능별 동작:**

| 기능 | 설명 | 항상 활성 |
|------|------|----------|
| Promotion Control | `origin_type`/`confidence`/`status` 메타데이터 프록시 자동 분류 | 아니오 |
| Hot Context | `session.idle` 시 `hot-context.json` 생성, compacting 시 scaffold 앞 주입 | 아니오 |
| Boundary Hint | L1/L2 fact에 "관련 기억 있음" 힌트 포함 | 아니오 |
| Contradiction Surfacing | `consolidateFacts()` 충돌 시 `must_verify` 자동 부여 | 아니오 (metadata 토글 필요) |
| 안전 퓨즈 확장 | `is_experimental` + scope 불일치 시 승격 차단 | **예** |
| TTL+Confidence 혼합 정리 | `status` 기반 archive 정책 추가 | 아니오 |
| 메모리 메트릭 | `memory-metrics.jsonl`에 성능 메트릭 append | **예** |
| Gate A 자동 모니터링 | 최근 5개 메트릭 이동 평균으로 `gate-a-status.json`/`gate-a-alerts.jsonl` 갱신 | 아니오 |

**Fact 타입 정제:** `origin_type`은 `'user_explicit'`/`'execution_observed'`/`'tool_result'`/`'inferred'` 유니온 리터럴. `status`는 `'active'`/`'unreviewed'`/`'deprecated'`/`'superseded'`. 기존 fact는 새 필드가 선택적이므로 그대로 동작.

**Hot Context 주입 포맷:**
```
[HARNESS HOT CONTEXT — previous session summary]
⚠ Contradictions to verify:
- [id] 충돌 내용 (needs verification)

Key decisions from previous sessions:
- [id] 결정 내용
```
Spoofed `[HARNESS ...]` 헤더와 마크다운은 fact content에서 자동 제거된다.

---

### Canary (`src/harness/canary.ts`)

Step 5f에서 추가된 metadata-based canary evaluation 모듈이다.

- **활성화:** `canary_enabled = true` (.opencode/harness.jsonc)
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
- **QA Tracker 연동:** orchestrator 훅에서 bash tool output을 파싱해 test failure를 감지 → `trackQAFailure()` 호출 → 반복 패턴 시 에스컬레이션 안내를 system prompt에 주입
- **agent_id 주입:** 각 에이전트 호출 시 `agent_id`를 컨텍스트에 주입하여 로깅/추적에 활용

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

### QA Tracker (`src/orchestrator/qa-tracker.ts`)

QA Tracker는 orchestrator 훅에 와이어링되어 런타임에 자동 동작한다.

**런타임 흐름:**
```
bash tool output → test failure 패턴 감지 (orchestrator hook)
    → trackQAFailure() 호출
    → 동일 에러 패턴 반복 감지
    → 에스컬레이션 안내를 system prompt에 주입
```

- **QA 시나리오별 실패 추적:** `qa-failures.jsonl`에 실패 기록
- **반복 검출:** 동일 에러 패턴 재발 시 에스컬레이션
- **orchestrator 훅 연동:** 독립 실행이 아닌 orchestrator의 `tool.execute.after` 훅에서 자동 호출

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

### 상위 4단계 (활성 + Phase 1a 의미론 확장)

| 단계 | 현재 상태 | 설명 |
|------|----------|------|
| **Extract** | ✅ 활성 — 세션에서 결정/선호/제약 키워드 추출 | 세션에서 결정/선호/제약 추출 후보만 기록 |
| **Consolidate** | ✅ 활성 | Jaccard 유사도 + union-find로 중복 fact 병합 (consolidateFacts) |
| **Relate** | ✅ 활성 | 키워드 기반 fact 관계 연결 (relateFacts, relations.jsonl) |
| **Recall** | ✅ 활성 — 3계층 점진적 공개 (semantic compacting 시 점수 기반 L1/L2/L3 분할) | compacting 시 점수에 따라 fact를 3계층으로 분할 주입 |

Recall은 3계층 점진적 공개로 구현 완료되었고, Phase 1a에서 hot context, metadata 기반 ranking, contradiction surfacing, safety fuse, boundary hint, memory metrics가 파일 기반으로 추가되었다.

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

**모든 5a~5h 토글이 .opencode/harness.jsonc에서 활성화됨.** 실제 판정 경로에 반영 중.
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
- **Token 최적화 설정:** `tool_loop_threshold`(5), `retry_storm_threshold`(3), `excessive_read_threshold`(4), `fact_ttl_days`(30), `fact_ttl_extend_threshold`(5)
- **Phase 1a 메모리 의미론:** `hot_context_enabled`(false), `rich_fact_metadata_enabled`(false), `confidence_threshold_active`(0.7), `boundary_hint_enabled`(false), `gate_a_monitoring_enabled`(false) — 모두 default-off

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
| ~~Phase 구조~~ | Phase 0~4 다단계 LLM 판정 | 제거됨 (`signalToRule()` 결정적 코드로 대체) | 플러그인에서 LLM 호출 불가 + 비결정성 회피 |
| Cross-Project 승격 | 2개 프로젝트에서 동일 패턴 → global 자동 승격 | 수동 `project_key: 'global'` | 단일 프로젝트 환경, 오버엔지니어링 |
| Pruning | 효과 없는 규칙 자동 삭제 | 측정만 자동, 삭제는 수동 | 삭제 기준 오류 시 복구 불가 |
| Memory 상위 4단계 | 7단계 전체 구현 | 상위 4단계 활성 + Phase 1a 의미론(hot context, 메타데이터 분류, contradiction, boundary hint) | SQLite/벡터/LLM은 Phase 1b~3으로 연기 |
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
├── memory/
│   ├── facts/{id}.json         # project_key 포함 fact 저장소 (global shared path)
│   ├── archive/{id}.json       # TTL/consolidate로 이동된 fact archive
│   └── relations.jsonl         # fact 관계 (relate 단계)
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
│       ├── hot-context.json  # Phase 1a: 세션 간 컨텍스트 캐시 (hot_context_enabled)
│       ├── memory-metrics.jsonl  # Phase 1a: 메모리 성능 메트릭 (항상 수집)
│       ├── gate-a-status.json  # Gate A 자동 평가 상태 (gate_a_monitoring_enabled)
│       └── gate-a-alerts.jsonl  # Gate A 1회성 알림 로그
├── events.jsonl              # 이벤트 로그
└── logs/sessions/            # 세션 로그 / fact extraction source
```
