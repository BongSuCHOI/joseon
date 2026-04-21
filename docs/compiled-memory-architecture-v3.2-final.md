# Compiled Memory Architecture v3.2 (Final)

> 세 아키텍처(Karpathy LLM Wiki / Memory Bank / LKB Harness)의 장점을 단일 파이프라인으로 통합한 커스텀 메모리 아키텍처.
> Hermes Agent, omOs(oh-my-opencode-slim) 등 자율형 AI 에이전트 프레임워크에 적용하기 위한 설계 문서.

---

## 설계 철학

세 아키텍처는 경쟁 관계가 아니라 보완 관계다.

- **Memory Bank**가 "기억의 원자(fact)"를
- **Karpathy Wiki**가 "기억의 문서(wiki page)"를
- **Harness**가 "기억의 품질 관리(규칙 승격 + self-improve)"를

각각 담당한다. Compiled Memory는 이 세 레이어를 **Archive → Fact → Wiki 단방향 컴파일** 원칙 아래 하나의 파이프라인으로 통합한다.

정보 흐름은 항상 아래에서 위로 올라가며 정제된다. Archive에서 Fact가 추출되고, Fact에서 Wiki가 컴파일되고, Schema가 전체 과정을 통제한다. 역방향 의존은 없다.

---

## 전체 구조

```
┌─────────────────────────────────────────────────────────┐
│                    Schema Layer                          │
│  AGENTS.md / CLAUDE.md / project-profile.md             │
│  하네스 규칙 (SOFT → HARD 승격 + 안전 퓨즈)               │
│  Memory Recall Protocol (mid-session 포함)               │
│  self-improve 루프 정의                                   │
└──────────────────────┬──────────────────────────────────┘
                       │ governs
┌──────────────────────▼──────────────────────────────────┐
│               Compiled Wiki Layer                        │
│  wiki/index.md — 전체 카탈로그                            │
│  wiki/entities/ — 엔티티 페이지                           │
│  wiki/decisions/ — 의사결정 로그 (Human-readable)         │
│  wiki/synthesis/ — 종합 분석 페이지                        │
│  [[위키링크]] 교차 참조                                   │
│  ※ Wiki는 Fact Store의 컴파일 산출물. 날려도 재생성 가능    │
└──────────────────────┬──────────────────────────────────┘
                       │ compiled from
┌──────────────────────▼──────────────────────────────────┐
│               Fact Store Layer                            │
│  ┌────────────────────────────────────────────────┐      │
│  │  hot_context                                    │      │
│  │  세션 시작 시 즉시 주입                           │      │
│  │  세션 중 명시적 partial update 가능               │      │
│  │  ~500 토큰 · confidence + must_verify 포함       │      │
│  └────────────────────────────────────────────────┘      │
│  facts ── status / origin_type / confidence              │
│           decision / preference / pattern / constraint   │
│  fact_revisions ── 변경 이력 전체 보존                    │
│  fact_relations ── typed relation + ontology              │
│  scope isolation ── global / project / session            │
│  promotion control ── extraction 시 내장 필터링           │
└──────────────────────┬──────────────────────────────────┘
                       │ extracted from
┌──────────────────────▼──────────────────────────────────┐
│               Archive Layer                              │
│  conversation JSONL (불변 원본)                           │
│  tool call 기록                                          │
│  session metadata                                        │
│  ※ 원본 보존. extraction 오류 시 재해석 가능               │
└─────────────────────────────────────────────────────────┘
```

---

## 핵심 메커니즘

### 1. Hot Context — cold-start 해결

세션 시작 시 에이전트가 현재 상태를 파악하기 위해 여러 번 검색하는 문제를 해결한다. 별도 상태 파일(active_task.md 등)을 추가하면 fact store와 desync가 생기므로, **hot_context를 Fact Store 내부의 자동 파생 캐시**로 구현한다.

```
세션 종료 시:
  1. fact extraction (기존 파이프라인)
  2. hot_context 자동 생성
     - 현재 활성 task 관련 fact를 우선순위로 5~10개 선별
     - 최근 변경된 fact, 미해결 contradiction, 활성 constraint 포함
     - 각 항목에 confidence + must_verify 메타데이터 부착
     - 500 토큰 이하로 압축
     - hot_context 테이블에 INSERT OR REPLACE

세션 시작 시:
  1. Schema(AGENTS.md) 로드
  2. hot_context 테이블에서 최신 스냅샷 SELECT (검색 아님, 단순 조회)
  3. 시스템 프롬프트에 주입
  4. 필요시에만 fact store / wiki 추가 검색
```

**세션 중 명시적 partial update**

hot_context는 기본적으로 세션 종료 시 갱신되는 안정된 캐시다. 하지만 중요한 결정이 세션 중간에 내려졌을 때 다음 에이전트 역할이 이를 즉시 인지해야 하는 경우가 있다. 에이전트가 `update_hot_context` 도구를 명시적으로 호출하면, 해당 fact를 hot_context 스냅샷에 즉시 반영한다.

이 패턴은 Letta의 core memory 설계에서 참조했다. Letta는 에이전트가 매 턴 memory_replace/memory_insert 도구로 in-context memory block을 실시간 편집할 수 있는 구조를 사용한다. Compiled Memory에서는 이를 "매 턴 자동"이 아니라 "에이전트의 명시적 호출 시에만" 동작하도록 제한하여 noise를 방지한다.

```
세션 중 partial update 흐름:
  에이전트: 중요 결정 내림 (예: "API gateway를 Kong으로 결정")
    → update_hot_context 호출
      → promotion control 규칙 적용 (guardrail 통과 여부 확인)
      → fact store에 저장
      → hot_context 스냅샷에 해당 fact 추가
      → 같은 세션 내 다음 에이전트 역할이 갱신된 hot_context를 받음
```

**update_hot_context 가드레일:**

hot_context는 즉시 주입되는 권위 있는 컨텍스트이므로, 오염되면 세션 전체에 영향을 미친다. 남용을 방지하기 위해 다음 제한을 적용한다.

| 가드레일           | 규칙                                                 | 이유                                                             |
| ------------------ | ---------------------------------------------------- | ---------------------------------------------------------------- |
| status 제한        | `status = 'active'`인 fact만 반영 가능               | unreviewed/deprecated fact가 권위 있는 컨텍스트에 섞이는 것 방지 |
| confidence 하한    | `confidence >= 0.8` 또는 `origin_type != 'inferred'` | LLM이 추론한 low-confidence fact의 즉시 주입 차단                |
| 횟수 제한          | 동일 task 내 최대 5회                                | 과도한 갱신으로 hot_context가 비대해지는 것 방지                 |
| contradiction 처리 | 충돌 fact는 확정이 아닌 `must_verify: true`로만 반영 | 미해결 충돌이 확정된 사실처럼 주입되는 것 방지                   |

**update_hot_context 대상 fact도 promotion control 규칙을 따른다.** 세션 중 partial update가 promotion control을 bypass하지 않는다.

**hot_context 스냅샷 예시:**

```markdown
## Active Context

- 현재 작업: Hermes Agent API 게이트웨이 설계
- 핵심 결정: Kong 사용 (2026-04-10, PLANNER, confidence: 0.95)

## ⚠ Requires Verification

- API rate limiting 방식: 미정 (confidence: 0.3, must_verify: true)

## ⚠ Unresolved Contradictions

- 인증 방식: "JWT" vs "OAuth2 + session" (2026-04-09)
  → 다음 세션에서 PLANNER 재확인 필요

## Active Constraints

- HARD: import 순서 규칙 (2회 위반 이력, evidence: 3)
- SOFT: 함수명 camelCase 통일 (evidence: 1)
```

**Single source of truth는 여전히 fact store다.** hot_context는 fact store에서 자동 파생되는 뷰이며, partial update도 fact store를 먼저 갱신한 뒤 스냅샷을 재조립하는 방식으로 동작한다.

**토큰 효율:**

| 방식                         | 도구 호출 | 토큰 소모 | 지연 |
| ---------------------------- | --------- | --------- | ---- |
| hot_context 없이 (검색 기반) | 3~5회     | ~4000     | 높음 |
| hot_context 주입 후          | 0~2회     | ~800~2000 | 낮음 |

---

### 2. Mid-session Recall Protocol

hot_context는 세션 시작용 압축 상태이며, 장기 메모리 전체를 대체하지 않는다. 세션 중간에 에이전트가 hot_context에 없는 기억을 필요로 하는 상황은 반드시 발생한다.

이 문제를 3단계 recall 구조로 해결한다.

```
세션 시작  → [A] Start Recall    hot_context 자동 주입 (passive)
세션 중간  → [B] Active Recall   에이전트가 MCP/Hook 도구로 직접 검색 (on-demand)
           → [C] Boundary Hint  하네스가 task 전환점에서 존재 알림 (semi-passive)
세션 종료  → fact extraction + consolidation + wiki lint + hot_context 갱신
```

#### [A] Start Recall — 자동 주입

세션 시작 시 hot_context를 시스템 프롬프트에 주입한다. 검색 0회. 위 섹션 1에서 상세 기술.

#### [B] Active Recall — 에이전트 주도 검색

에이전트가 작업 중 "이거 전에 정했나?", "유사 버그가 있었나?", "이 프로젝트에서 금지된 접근인가?"를 느끼면 MCP/Hook 도구를 호출하여 fact store / wiki를 직접 검색한다.

**이것이 기본 recall 메커니즘이다.** 업계 레퍼런스: Letta의 archival memory는 on-demand 도구 호출로 검색하고, mem0도 memory.search()를 호출해서 관련 메모리를 꺼내는 구조다. "항상 보이는 메모리"와 "필요 시 조회하는 메모리"를 분리하는 패턴은 사실상 업계 표준이다.

**Tool Contract — 어떤 도구를 어떤 상황에서 호출하는가:**

| 도구                 | 용도                                   | 호출 시점                                        |
| -------------------- | -------------------------------------- | ------------------------------------------------ |
| `search_facts`       | 키워드/의미 기반으로 관련 fact 검색    | 새 기능 구현 시작 전, 설계 결정 전, 에러 해결 시 |
| `trace_fact`         | 특정 fact의 출처(원본 대화)까지 역추적 | 결정의 이유가 궁금할 때, 규칙의 근거 확인 시     |
| `read_wiki`          | wiki 페이지 전문 읽기                  | 특정 엔티티/결정의 전체 맥락이 필요할 때         |
| `update_hot_context` | 중요 결정 직후 hot_context에 즉시 반영 | 에이전트 역할 전환 전 핵심 결정을 전달할 때      |

이 호출 시점은 AGENTS.md의 **Memory Recall Protocol** 규칙으로 강제한다:

```markdown
## Memory Recall Protocol (AGENTS.md에 삽입)

### Active Recall 규칙

- 새로운 기능 구현 또는 설계 결정 시작 전에 반드시
  search_facts()로 관련 이전 결정을 확인하라
- 에러 해결 시 search_facts()로 유사 패턴을 검색하라
- 검색 결과가 없으면 그대로 진행
- 검색 결과가 있으면 이전 결정을 존중하되,
  변경이 필요하면 이유를 명시하라

### Hot Context Update 규칙

- 에이전트 역할 전환 전에 핵심 결정이 있었다면
  update_hot_context()로 다음 역할에 전달하라
- update_hot_context는 가드레일을 따른다:
  active + confidence>=0.8 fact만, task당 최대 5회,
  contradiction은 must_verify로만 반영
```

#### [C] Boundary Hint — task 전환점에서의 경량 알림

Agent-driven recall의 약점은 **Case B("모르는 걸 모른다")**를 못 푸는 것이다. 에이전트가 관련 기억이 있다는 사실 자체를 모르면 검색할 생각을 하지 않는다.

Boundary Hint는 이 갭을 메운다. **전체 fact를 주입하지 않고, "관련 기억이 있다"는 존재 여부만 알린다.** 에이전트가 힌트를 보고 필요하다고 판단하면 Active Recall로 상세 검색하고, 불필요하면 무시한다.

**핵심 원칙: 매 턴 자동 주입은 하지 않는다.** 코딩 에이전트에서는 관련 없는 선호나 예전 결정이 끼면 오히려 집중이 깨진다. Boundary Hint는 특정 조건에서만 발동한다.

**트리거 방식 2가지 (구현 환경에 따라 선택):**

| 방식                    | 작동                                    | 장점                          | 단점                              |
| ----------------------- | --------------------------------------- | ----------------------------- | --------------------------------- |
| **이벤트 기반** (기본)  | 특정 이벤트 발생 시에만 relevance check | 불필요한 체크 없음, 비용 최소 | task boundary 감지 로직 구현 필요 |
| **cadence 기반** (대안) | N턴마다 자동 relevance check            | 구현 단순, 놓칠 확률 낮음     | 관련 없는 턴에서도 체크 비용 발생 |

이벤트 기반은 Compiled Memory의 기본 추천 방식이고, cadence 기반은 Honcho에서 검증된 대안이다. Honcho는 contextCadence와 dialecticCadence 두 파라미터로 자동 컨텍스트 조립 빈도를 조절한다. 구현 환경에서 이벤트 감지(hook)가 어려우면 cadence 방식을 사용한다.

**이벤트 기반 트리거 조건:**

| 트리거            | 감지 방법                                 |
| ----------------- | ----------------------------------------- |
| 새 태스크 시작    | 사용자가 새 기능/버그/리팩터 요청         |
| 파일/도메인 전환  | 에이전트가 다루는 파일 경로 변경 감지     |
| 작업 모드 전환    | "설계", "구현", "디버그", "리팩터" 키워드 |
| 새 엔티티 첫 등장 | 이전 턴에 없던 기술명/라이브러리명        |
| 회고적 표현 사용  | "전에", "원래", "다시", "예전" 등         |

**Relevance check 시 fact type 가중치:**

Boundary Hint가 과도하게 발동하는 것을 방지하기 위해, relevance check 시 fact type에 따라 우선순위를 적용한다.

| 우선순위 | fact type                            | 이유                                    |
| -------- | ------------------------------------ | --------------------------------------- |
| 높음     | decision, constraint                 | 구현 방향에 직접 영향                   |
| 중간     | pattern                              | 참고 가치는 있으나 강제는 아님          |
| 낮음     | preference                           | 코딩 스타일 수준, hint 없어도 무방      |
| 제외     | status='unreviewed' + confidence<0.5 | 검증되지 않은 fact는 hint 대상에서 제외 |

프로젝트 스코프 fact를 글로벌 스코프보다 우선 매칭한다.

**Boundary Hint 실제 작동 예시:**

```
사용자: "API rate limiting 구현해줘"

[하네스: 새 태스크 시작 감지 → relevance check]
  → fact store에서 "rate limiting" 키워드 매칭
  → 관련 fact 2건 존재 확인:
    - decision (높음): "Token bucket 방식 채택"
    - decision (높음): "Redis 글로벌 limit 보류"
  → 에이전트에게 힌트 주입:

  [MEMORY HINT] rate limiting 관련 이전 결정 2건 있음.
  필요시 search_facts("rate limiting") 호출

에이전트: 힌트를 보고 search_facts 호출
  → "Token bucket 방식 채택 (confidence: 0.9)"
  → "Redis 기반 글로벌 limit은 운영 복잡도 때문에 보류 (confidence: 0.85)"
  → 이전 결정을 반영하여 구현
```

#### Recall Budget — 검색 결과의 수명 관리

Active Recall로 가져온 fact는 컨텍스트 윈도우에 남는다. 세션이 길어지면 recall 결과가 누적되어 컨텍스트를 잠식한다.

**규칙:**

- recall 결과는 **해당 task가 완료될 때까지 유지**
- task 전환 시 이전 task의 recall 결과는 flush
- 단일 recall 호출의 결과는 **최대 5개 fact, ~500 토큰** 이내로 제한
- 동일 쿼리의 반복 검색은 캐시하여 도구 호출 절약

**Task boundary 판정 기준:**

recall budget의 flush 시점을 결정하기 위해, 다음 중 하나라도 해당하면 "task 전환"으로 판정한다.

| 기준                    | 설명                                                    |
| ----------------------- | ------------------------------------------------------- |
| 사용자 새 요청 도착     | 이전 요청과 다른 주제/기능에 대한 새 지시               |
| 에이전트 역할 전환      | PLANNER → FRONTEND 등 역할이 바뀔 때                    |
| 명시적 완료 선언        | 사용자가 "됐어", "다음" 등으로 현재 작업 완료를 알릴 때 |
| 파일/도메인 전환 임계치 | 다루는 파일 경로가 이전 task와 50% 이상 다를 때         |

이 기준은 AGENTS.md에 가이드라인으로 명시하되, 엄밀한 자동 판정보다는 에이전트의 합리적 판단에 위임한다.

---

### 3. Promotion Control — fact 품질의 첫 번째 방어선

fact extraction은 전체 아키텍처의 기반이다. 여기서 오판이 발생하면 모든 상위 레이어(wiki, hot_context, 규칙 승격)가 오염된다. 따라서 extraction 시점에 **promotion control을 내장**한다.

별도 파이프라인 단계나 별도 검증 서비스를 추가하지 않는다. extraction 프롬프트 자체가 다음을 함께 출력하도록 설계한다:

```
extraction 프롬프트 출력 스키마:
{
  "content": "Kong for API gateway",
  "type": "decision",
  "scope": "project",
  "origin_type": "user_explicit",
  "confidence": 0.9,
  "is_experimental": false,
  "agent_role": "PLANNER"
}
```

**origin_type 분류:**

| origin_type        | 의미                          | 기본 confidence |
| ------------------ | ----------------------------- | --------------- |
| user_explicit      | 사용자가 명시적으로 지시/선언 | 0.9             |
| execution_observed | 실행 결과/로그에서 확인       | 0.85            |
| tool_result        | 도구 호출 결과에서 추출       | 0.8             |
| inferred           | 대화 패턴에서 LLM이 추론      | 0.5             |

**저장 시 자동 분류:**

```
confidence >= 0.7  → status: 'active'
confidence < 0.7   → status: 'unreviewed'
confidence < 0.3   → 저장하지 않음 (Archive에만 보존)
```

---

### 4. Lint-driven Selective Recompile — wiki 갱신

wiki 페이지를 매 세션마다 전부 재생성하지 않는다. lint가 해당 페이지의 기반 fact가 변경됐다고 판단할 때만 재컴파일한다.

```
session end
  → fact extraction + promotion control
  → fact consolidation (중복/충돌/진화 처리)
  → wiki lint (자동)
    → wiki_fact_map에서 각 wiki 페이지의 source facts 체크
      → fact가 변경/추가/삭제됨?
        → YES: 해당 페이지만 재컴파일
        → NO: skip
  → hot_context 갱신
```

---

### 5. 규칙 승격 + 안전 퓨즈

규칙(constraint)도 fact store를 통과한다. 별도 rules.md가 아니라 `type: "constraint"` fact로 저장되므로 provenance 역추적이 가능하다.

**승격 흐름:**

```
실수 1회 → SOFT 규칙
            {type: "constraint", severity: "soft", evidence_count: 1}
            wiki/rules/ 에 human-readable 페이지 컴파일

같은 실수 재발 → 안전 퓨즈 통과 여부 확인 → 통과 시 HARD 승격
                severity: "hard", AGENTS.md에 자동 삽입, hook 강제

3회 이상 → 자동 테스트 케이스 생성 (auto_test 플래그)
```

**안전 퓨즈 — 승격 차단 조건 4개:**

| 안전 퓨즈                           | 체크 방법                                          | 방지하는 오판                              |
| ----------------------------------- | -------------------------------------------------- | ------------------------------------------ |
| **다른 project scope의 위반인가**   | fact의 project_id 비교                             | 프로젝트 A의 실수를 프로젝트 B에서 승격    |
| **사용자가 명시적으로 부정했는가**  | `/not-a-rule` 명령 또는 "이건 규칙 아님" 발화 감지 | 의도적 실험을 실수로 오판                  |
| **experimental/tentative 발화인가** | extraction 시 `is_experimental: true`              | "실험적으로 해보자"를 규칙 위반으로 카운트 |
| **실제 tool failure가 있었는가**    | exit code / 에러 로그 체크                         | 실패 없는 "위반"을 승격 대상에서 제외      |

---

### 6. Contradiction-first Surfacing

fact consolidation 시 발견된 충돌(CONTRADICTION)은 자동으로 해결하지 않는다. **hot_context에 우선 노출**하여 에이전트/인간이 명시적으로 판단하게 유도한다. 충돌 fact에는 `must_verify: true`가 자동 부여된다.

---

### 7. 스코프 3단계

```
Global Scope     모든 프로젝트에 적용
                 예: "Korean responses", "named exports only"
                 hot_context에 항상 포함

Project Scope    특정 프로젝트의 의사결정/제약
                 예: "Hermes Agent는 MiniMax M2.7 사용"
                 해당 프로젝트 세션의 hot_context에만 포함

Session Scope    현재 세션의 임시 컨텍스트
                 세션 종료 시 → fact extraction + promotion control
                 → active이면 Project/Global로 승격
                 → unreviewed이면 보류 상태로 저장
                 → low confidence면 Archive에만 보존
```

---

## SQLite 스키마

```sql
-- ============================================================
-- 핵심 fact 저장
-- ============================================================
CREATE TABLE facts (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL,      -- decision / preference / pattern / constraint
  content           TEXT NOT NULL,
  scope             TEXT NOT NULL,      -- global / project / session
  project_id        TEXT,
  agent_role        TEXT,               -- PLANNER / FRONTEND / DEBUGGER / ...

  -- Promotion Control
  status            TEXT NOT NULL DEFAULT 'active',
                                        -- active / unreviewed / superseded / deprecated / disputed
  origin_type       TEXT NOT NULL DEFAULT 'inferred',
                                        -- user_explicit / execution_observed / tool_result / inferred
  confidence        REAL NOT NULL DEFAULT 0.5,
  is_experimental   INTEGER DEFAULT 0,

  -- 규칙 승격 (constraint 전용)
  severity          TEXT,               -- soft / hard
  auto_test         INTEGER DEFAULT 0,

  -- 신뢰도 추적
  evidence_count    INTEGER DEFAULT 1,
  last_confirmed_at TEXT,

  -- 메타데이터
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  source_session    TEXT,               -- 원본 세션 ID (provenance)
  embedding         BLOB                -- 384-dim vector (all-MiniLM-L6-v2)
);

CREATE INDEX idx_facts_scope ON facts(scope, project_id);
CREATE INDEX idx_facts_status ON facts(status);
CREATE INDEX idx_facts_type ON facts(type);

-- ============================================================
-- 변경 이력
-- ============================================================
CREATE TABLE fact_revisions (
  id          TEXT PRIMARY KEY,
  fact_id     TEXT NOT NULL REFERENCES facts(id),
  action      TEXT NOT NULL,            -- created / updated / superseded / merged / deprecated
  old_content TEXT,
  new_content TEXT,
  reason      TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_revisions_fact ON fact_revisions(fact_id);

-- ============================================================
-- Ontology 관계
-- ============================================================
CREATE TABLE fact_relations (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL REFERENCES facts(id),
  target_id   TEXT NOT NULL REFERENCES facts(id),
  relation    TEXT NOT NULL,             -- SUPPORTS / CONTRADICTS / SUPERSEDES / INFLUENCES
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_relations_source ON fact_relations(source_id);
CREATE INDEX idx_relations_target ON fact_relations(target_id);

-- ============================================================
-- Hot Context 캐시
-- ============================================================
CREATE TABLE hot_context (
  project_id  TEXT PRIMARY KEY,
  snapshot    TEXT NOT NULL,             -- 압축된 마크다운 (~500 토큰)
  fact_ids    TEXT NOT NULL,             -- 포함된 fact ID 목록 (JSON array)
  metadata    TEXT,                      -- 각 fact의 confidence, must_verify (JSON)
  created_at  TEXT NOT NULL
);

-- ============================================================
-- Wiki ↔ Fact 매핑 (lint-driven recompile)
-- ============================================================
CREATE TABLE wiki_fact_map (
  wiki_path   TEXT NOT NULL,
  fact_id     TEXT NOT NULL REFERENCES facts(id),
  PRIMARY KEY (wiki_path, fact_id)
);

-- ============================================================
-- 벡터 검색
-- ============================================================
CREATE VIRTUAL TABLE vec_facts USING vec0(
  embedding float[384]
);
```

---

## 실전 적용 시나리오

### Hermes Agent — 역할 전환 + mid-session recall

```
Session: PLANNER → FRONTEND 역할 전환이 포함된 세션

[PLANNER 역할 시작]
  → hot_context 주입: 현재 프로젝트 상태 즉시 인지
  → 사용자: "API 인증 방식 결정해줘"
  → PLANNER: JWT 방식 결정
    → update_hot_context 호출
      → 가드레일 체크: active + confidence 0.95 + user_explicit → 통과
      → fact store에 저장 + hot_context 스냅샷에 추가

[FRONTEND 역할로 전환]
  → 갱신된 hot_context 로드 → "인증: JWT" 즉시 인지 (도구 호출 0회)
  → 사용자: "로그인 페이지 만들어줘"
  → FRONTEND: JWT 기반 로그인 구현 시작

  [Boundary Hint 발동 — 새 엔티티 "로그인" 첫 등장]
    → relevance check: "login" 관련 fact 존재 여부 확인
    → fact type 가중치 적용: decision 1건(높음), pattern 1건(중간)
    → [MEMORY HINT] 로그인 관련 이전 결정 1건 + 패턴 1건 있음.
    → FRONTEND: search_facts("login UI pattern") 호출
    → "이전 프로젝트에서 로그인 폼은 react-hook-form + zod 조합 사용"
    → 이전 패턴 참고하여 구현

[Task 완료 — 사용자: "다음으로 넘어가자"]
  → task boundary 판정: 명시적 완료 선언
  → recall budget flush: 로그인 관련 recall 결과 컨텍스트에서 제거
```

### omOs — 실험적 코드 + 안전 퓨즈

```
opencode 세션 시작:
  → AGENTS.md 로드 + hot_context 주입:
    "현재 작업: TimePrep 앱 디자인 시스템 적용"
    "HARD: Tailwind만 사용 (evidence: 3, 2회 위반)"
    "⚠ must_verify: 다크모드 토글 방식 미정 (confidence: 0.3)"

사용자: "실험적으로 CSS 직접 써보자"
  → extraction: is_experimental: true
  → 기존 SOFT 규칙 위반 카운트 시도
  → 안전 퓨즈 #3 발동: is_experimental = true → 승격 차단

사용자: "다크모드 토글 어떻게 하면 좋을까?"
  [Boundary Hint 발동 — "다크모드"가 must_verify fact에 해당]
  → relevance check: decision 1건(높음, must_verify)
  → [MEMORY HINT] 다크모드 관련 미확정 결정 1건 있음 (must_verify).
  → 에이전트: search_facts("dark mode toggle") 호출
  → "미정 (confidence: 0.3)" → 사용자와 논의 후 결정
  → update_hot_context: 결정 사항 반영
    → 가드레일 체크: confidence 0.9 + user_explicit → 통과
```

---

## 구현 로드맵

```
Phase 1: Fact Store + Hot Context + Promotion Control      예상: 2~3일
───────────────────────────────────────────────────────
  - SQLite 스키마 생성
  - session end hook:
    → fact extraction 프롬프트 (origin_type + confidence + is_experimental)
    → promotion control: confidence 기반 status 분류
    → fact consolidation
    → hot_context 자동 생성
  - session start hook:
    → hot_context SELECT + 시스템 프롬프트 주입
  - MCP/Hook 도구 4개:
    → search_facts, trace_fact, read_wiki, update_hot_context
  - update_hot_context 가드레일 4개 구현
  - AGENTS.md에 Memory Recall Protocol 삽입 (Active Recall + Update 규칙)

  검증 기준:
    ✓ 세션 시작 시 이전 결정을 도구 호출 0회로 인지하는가?
    ✓ origin_type별 confidence가 적절히 분류되는가?
    ✓ update_hot_context 호출 후 같은 세션 내 다음 역할이 갱신 내용을 받는가?
    ✓ update_hot_context 가드레일이 low-confidence fact를 차단하는가?
    ✓ Active Recall 규칙에 따라 에이전트가 구현 전 search_facts를 호출하는가?

Phase 2: Wiki 컴파일 + Boundary Hint                       예상: 3~4일
───────────────────────────────────────────────────────
  - wiki/ 디렉토리: index.md, entities/, decisions/, synthesis/
  - fact → wiki 페이지 컴파일러
  - wiki_fact_map 기반 lint-driven selective recompile
  - [[위키링크]] 자동 생성 + 백링크
  - Boundary Hint 구현:
    → 트리거 방식 선택 (이벤트 기반 또는 cadence 기반)
    → 경량 relevance check + fact type 가중치 적용
    → 힌트 포맷 정의 + 에이전트 프롬프트 주입
  - Recall budget 구현:
    → task boundary 판정 로직
    → task 전환 시 이전 recall 결과 flush

  검증 기준:
    ✓ wiki가 fact store와 일관성 유지하는가?
    ✓ fact 변경 시 해당 wiki 페이지만 재컴파일되는가?
    ✓ Boundary Hint가 decision/constraint fact에 우선 반응하는가?
    ✓ preference/low-confidence fact에는 hint가 과도하게 뜨지 않는가?
    ✓ task 전환 시 이전 recall 결과가 flush되는가?

Phase 3: 하네스 규칙 시스템 + 안전 퓨즈                      예상: 1~2일
───────────────────────────────────────────────────────
  - constraint fact의 severity 승격 로직
  - 안전 퓨즈 4개 구현
  - HARD 승격 시 AGENTS.md 자동 삽입 hook
  - self-improve: completion-check 기반 원문 재검증

  검증 기준:
    ✓ 의도적 실험이 승격을 트리거하지 않는가?
    ✓ 다른 프로젝트의 위반이 현재 프로젝트에서 승격되지 않는가?
    ✓ 승격된 규칙의 provenance가 trace_fact로 추적 가능한가?

Phase 4: 멀티 에이전트 + 크로스 프로젝트                     예상: 2~3일
───────────────────────────────────────────────────────
  - 에이전트 역할별 hot_context 필터링
  - 스코프 격리 쿼리 (project + global only)
  - cross_project_insights: 글로벌 fact 풀에서 유사 패턴 검색
  - explore_graph: fact 간 multi-hop 탐색

  검증 기준:
    ✓ PLANNER의 결정을 FRONTEND가 hot_context로 즉시 받는가?
    ✓ 프로젝트 A의 fact가 프로젝트 B에 노출되지 않는가?
    ✓ 새 프로젝트에서 기존 유사 패턴이 자동 제안되는가?
```

---

## 아키텍처 결정 기록 (ADR)

| #   | 결정                     | 선택                                          | 기각한 대안                   | 이유                                              |
| --- | ------------------------ | --------------------------------------------- | ----------------------------- | ------------------------------------------------- |
| 1   | cold-start 해결          | hot_context (fact store 내부 캐시)            | active_task.md (별도 파일)    | 별도 파일은 fact store와 desync 위험              |
| 2   | 지식 표현                | fact store + wiki 이중 표현                   | fact store만                  | human-readable 문서 필요                          |
| 3   | wiki 갱신 방식           | lint-driven selective recompile               | 매 세션 전체 재생성           | 비용 절감                                         |
| 4   | 규칙 저장 위치           | fact store (type=constraint)                  | 별도 rules.md                 | 동일 파이프라인으로 provenance 추적               |
| 5   | 충돌 처리                | hot_context에 우선 노출                       | 자동 해결 (최신 우선)         | 잘못된 최신 fact가 올바른 기존 fact를 덮어쓸 위험 |
| 6   | 임베딩 모델              | all-MiniLM-L6-v2 (384-dim)                    | OpenAI ada-002                | 로컬 실행, 외부 API 무의존                        |
| 7   | fact 품질 관리           | promotion control (extraction 내장)           | promotion gate (별도 단계)    | 별도 단계는 비용 2배                              |
| 8   | 승격 안전장치            | 안전 퓨즈 4개                                 | 풀 정책 엔진 (5축)            | 안전 퓨즈는 if 4개로 충분                         |
| 9   | mid-session recall       | Agent-driven 기본 + Boundary Hint             | 매 턴 자동 주입 (Honcho 방식) | 코딩 에이전트에서 noise 문제                      |
| 10  | hot_context 세션 중 갱신 | 명시적 update_hot_context 호출 + 가드레일 4개 | 매 턴 자동 편집 (Letta 방식)  | 자동 편집은 noise + desync + 추적 어려움          |
| 11  | Boundary Hint 트리거     | 이벤트 기반 기본, cadence 대안                | 이벤트 기반만                 | Honcho에서 cadence 방식도 검증됨                  |

---

## 업계 레퍼런스

Compiled Memory의 설계 결정은 다음 서비스들의 아키텍처를 검증하고 참조했다.

| 서비스             | 핵심 패턴                                                                                                                                                 | Compiled Memory에 반영된 점                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Letta** (MemGPT) | memory blocks(항상 in-context, 블록당 2000자) + archival memory(on-demand 도구 검색). 에이전트가 memory_replace/insert로 자체 편집                        | hot_context + fact store 분리. update_hot_context 도구로 세션 중 편집 옵션. 단, Letta의 매 턴 자동 편집은 채택하지 않고 명시적 호출로 제한 |
| **Honcho**         | 2-layer 자동 주입 (base context + dialectic supplement). contextCadence/dialecticCadence로 빈도 조절. 백그라운드 dreaming으로 지속적 추론                 | Boundary Hint의 cadence 기반 대안. 단, 매 턴 자동 주입은 코딩 에이전트 도메인에 부적합하여 기각                                            |
| **mem0**           | 4-tier 스코프 (conversation/session/user/org). memory.search()로 on-demand 검색. 벡터 + 그래프 하이브리드. 자동 fact 추출 + 중복/충돌 관리                | 3-tier 스코프 (session/project/global). Active Recall의 search 기반 설계. fact extraction + consolidation 파이프라인                       |
| **Zep/Graphiti**   | Bitemporal knowledge graph (event time + ingestion time). Neo4j 기반. DMR 벤치마크에서 기존 SOTA 대비 우위. 복잡한 시간적 추론 태스크에서 최대 18.5% 향상 | 현재는 도입하지 않으나, time semantics를 조건부 보류(B-4)로 분류한 근거                                                                    |

---

## 부록: 보류 및 기각 항목

### 보류 — 조건 충족 시 도입 검토

**B-1. 풀 승격 정책 엔진**

현재는 안전 퓨즈 4개(차단 조건)만 구현한다.

- 재검토 트리거: **안전 퓨즈가 있음에도 오승격이 3회 이상 발생할 때**
- 필요 데이터: 최소 50개 이상의 constraint fact + 승격/차단 이력

**B-2. Wiki transitive dependency 추적**

현재 wiki_fact_map은 direct dependency만 추적한다.

- 재검토 트리거: **wiki 페이지가 50개를 초과할 때**
- 구현 아이디어: wiki_fact_map에 `dependency_type` 컬럼 추가

**B-3. Fact expiry / TTL**

- 재검토 트리거: **6개월 이상 확인되지 않은 fact가 50개를 초과할 때**
- 구현 아이디어: `expires_at` 컬럼 + lint 시 만료 fact 자동 deprecated 처리

**B-4. Time semantics (VALID_DURING, REPLACED_BY 등) — 조건부 보류**

Zep/Graphiti가 bitemporal model로 DMR 벤치마크에서 기존 SOTA(MemGPT) 대비 우위를 달성하고, 특히 복잡한 시간적 추론 태스크에서 최대 18.5% 정확도 향상을 보여줬다. 코딩 에이전트에서는 현재 SUPERSEDES relation + fact_revisions로 충분하지만, 이 벤치마크 결과는 시간 의미론의 실전 가치를 입증한다.

- 재검토 트리거: **비즈니스 규칙 관리, 법률/규정 지식, 장기 프로젝트 히스토리 분석 등 시간성이 본질적인 도메인으로 확장할 때**
- 참고: Zep 논문 (arXiv:2501.13956)

**B-5. Organizational scope (4번째 스코프)**

mem0가 conversation/session/user/organizational 4-tier 스코프를 사용한다. 현재 3-tier(session/project/global)로 충분하지만, 팀 단위 운영 시 팀 공통 지식을 별도 스코프로 관리할 필요가 생길 수 있다.

- 재검토 트리거: **Hermes Agent가 팀(2명 이상) 단위로 사용될 때**

### 기각 — 현재 도메인에 부적합

**R-1. User model synthesis 레이어 (profiles/user-style.md 등)**

- 기각 이유: Hermes Agent / omOs는 프로젝트 단위 개발 에이전트. 글로벌 스코프 fact로 충분
- 대안: 필요시 wiki/synthesis/ 아래에 fact 컴파일 결과로 자연스럽게 생성
- 재검토 조건: 개인 비서/장기 학습 에이전트로 확장할 때

**R-2. 매 턴 자동 메모리 주입 (Honcho full context injection 방식)**

- 기각 이유: 코딩 에이전트에서 관련 없는 선호/결정이 매 턴 주입되면 noise가 집중을 깨뜨림
- 대안: Boundary Hint(이벤트/cadence 기반)로 필요한 시점에만 존재 여부 알림
- 참고: Honcho는 대화형 개인 비서 도메인에서 이 방식이 효과적이지만, 코딩 에이전트와는 도메인 특성이 다름

---

## 변경 이력

| 버전 | 날짜       | 주요 변경                                                                                                                                                                                                                   |
| ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1   | 2026-04-20 | 초안. Archive → Fact → Wiki 3-layer + 5 원칙                                                                                                                                                                                |
| v2   | 2026-04-20 | hot_context 메커니즘 추가, SQLite 스키마 초안, 구현 로드맵                                                                                                                                                                  |
| v3   | 2026-04-20 | promotion control, fact status/origin_type, 안전 퓨즈 4개, 보류/기각 부록                                                                                                                                                   |
| v3.1 | 2026-04-20 | Mid-session Recall Protocol, hot_context partial update, Boundary Hint cadence 병기, recall budget, 업계 레퍼런스 검증, time semantics 기각→조건부 보류                                                                     |
| v3.2 | 2026-04-20 | **최종안.** update_hot_context 가드레일 4개, task boundary 판정 기준, `read`→`read_wiki` 용어 통일, promotion control↔update_hot_context 관계 명시, Boundary Hint에 fact type 가중치, 시나리오에 가드레일/가중치/flush 반영 |
