# Memory v3.2 Phase 1a: 파일 기반 의미론 상세 구현 계획

> 날짜: 2026-04-21
> 상태: ✅ 완료 (Completed) — 작업 1a-1~1a-11 전부 구현, 테스트 통과
> 상위 문서: [`docs/plans/2026-04-21-memory-v32-partial-migration-plan.md`](./2026-04-21-memory-v32-partial-migration-plan.md)
> 완료 일시: 2026-04-21
> 선행 조건: Phase 0 기반 작업 완료

---

## 1. 목표

v3.2 아키텍처의 **의미론적 패턴**을 현재 파일 기반 하네스에 흡수한다. SQLite·벡터·LLM 없이, 기존 `MemoryFact` 인터페이스와 `improver.ts` 파이프라인을 확장하여 promotion control, hot context, boundary hint, contradiction surfacing, 안전 퓨즈 확장, TTL+confidence 혼합 정리를 구현한다.

구체적 성공 기준:
- 세션 시작 시 hot_context가 주입되어 이전 결정을 도구 호출 0회로 인지
- `origin_type`별 confidence가 메타데이터 프록시로 자동 분류됨
- `must_verify` 충돌 fact가 hot_context에 별도 섹션으로 표시됨
- `is_experimental: true` fact가 HARD 승격 차단됨
- 모든 Phase 1a 토글이 off일 때 기존 동작과 완전히 동일
- `memory-metrics.jsonl`에 메트릭이 정상적으로 append됨

---

## 2. 범위

### 2.1 In-Scope (Phase 1a)

| 작업 ID | 내용 | 담당 파일 |
|---------|------|-----------|
| 1a-1 | Promotion Control — 메타데이터 기반 `origin_type`/`confidence`/`status` 자동 분류 | `src/harness/improver.ts` |
| 1a-2 | Hot Context 자동 생성 — `session.idle` 시 `hot-context.json` 작성 | `src/harness/improver.ts` |
| 1a-3 | Hot Context 세션 시작 주입 — `experimental.session.compacting` 훅에서 scaffold 앞 주입 | `src/harness/improver.ts` |
| 1a-4 | 3계층 공개 가중치 확장 — `fact_type`·`confidence`·`status` 반영 | `src/harness/improver.ts` |
| 1a-5 | Boundary Hint — compacting 훅에 L1/L2 관련 기억 힌트 포함 | `src/harness/improver.ts` |
| 1a-6 | Contradiction-first Surfacing — `consolidateFacts()` 충돌 시 `must_verify` 부여 | `src/harness/improver.ts` |
| 1a-7 | 안전 퓨즈 확장 — `is_experimental` + scope 불일치 시 승격 차단 | `src/harness/improver.ts` |
| 1a-8 | TTL + Confidence 혼합 정리 — `status` 기반 archive 정책 추가 | `src/harness/improver.ts` |
| 1a-9 | Fact 인터페이스 타입 정제 — `src/types.ts` 선택적 필드 확정 | `src/types.ts` |
| 1a-10 | 메모리 메트릭 수집 — `memory-metrics.jsonl` append | `src/harness/improver.ts` |
| 1a-11 | Phase 1a smoke 테스트 | `src/__tests__/smoke-phase1a-file-semantics.ts` (신규) |

### 2.2 Out-of-Scope (Gate A / Phase 1b 이후로 연기)

| 항목 | 연기 사유 | 연기 대상 |
|------|----------|----------|
| SQLite 도입 (최소 KV 스토어) | 파일 기반으로 먼저 한계를 측정해야 함 | Phase 1b (Gate A 통과 시) |
| `relations.jsonl` 복잡 관계 유형 추가 | 순수 JSON에서 관계 쿼리 비용 증가만 초래 | Phase 1b |
| `revisions` 체인 추적 (전체 이력) | `updated_at` 수준에서 충분 | Phase 1b |
| `update_hot_context` MCP 도구 | Plugin API 도구 등록 경로 불확실 | Phase 2 |
| 벡터 임베딩 / 의미 검색 | 외부 의존성 | Phase 3 |
| LLM 기반 fact 추출 | Plugin 훅에서 LLM 직접 호출 불가 | Phase 3 |
| Wiki 컴파일 레이어 | fact 수 부족으로 오버엔지니어링 | 무기한 보류 |
| Cross-project 자동 승격 | `roadmap.md` #7에서 "guarded-off" 판정 | 무기한 보류 |
| `hot_context` 세션 중 갱신 | MCP 경로 불확실, Phase 1a는 세션 종료 시 자동 갱신만 | Phase 2 |

---

## 3. 의존성

### 3.1 선행 (Phase 0 완료 필수)

Phase 0에서 다음이 이미 완료되어 있어야 한다:

1. **`src/types.ts`** — `MemoryFact`에 선택적 필드 추가됨:
   - `origin_type?`, `confidence?`, `status?`, `scope?`, `evidence_count?`, `must_verify?`, `is_experimental?`, `severity?`, `agent_role?`
   - `HotContext` 인터페이스 정의됨
2. **`src/config/schema.ts`** — `HarnessSettings`에 Phase 1a 설정 추가됨:
   - `hot_context_enabled` (default: false)
   - `rich_fact_metadata_enabled` (default: false)
   - `confidence_threshold_active` (default: 0.7)
   - `boundary_hint_enabled` (default: false)
3. **`src/harness/improver.ts`** — `hot-context.json` 읽기/쓰기 헬퍼 추가됨 (아직 호출 없음)
4. **기존 580개 테스트 전부 통과** 확인됨

### 3.2 내부 의존성 (작업 순서)

```
1a-1 (Promotion Control)  ← 나머지 대부분의 전제조건
   │
   ├─→ 1a-2, 1a-3 (Hot Context 생성/주입) ← 1a-1 결과(origin_type, confidence) 사용
   │
   ├─→ 1a-4 (3계층 가중치) ← 1a-1 결과(confidence, fact_type) 사용
   │
   ├─→ 1a-5 (Boundary Hint) ← 1a-4 랭킹 결과 활용
   │
   ├─→ 1a-6 (Contradiction Surfacing) ← consolidateFacts 독립, must_verify는 1a-2에서 참조
   │
   ├─→ 1a-7 (안전 퓨즈) ← promoteRules 독립, is_experimental은 1a-1에서 설정
   │
   ├─→ 1a-8 (TTL+Confidence) ← 1a-1의 status 필드 기반
   │
   ├─→ 1a-9 (타입 정제) ← 1a-1~1a-8 구현 후 최종 확인
   │
   ├─→ 1a-10 (메트릭) ← 초기 작업과 병렬 가능
   │
   └─→ 1a-11 (테스트) ← 1a-1~1a-10 완료 후
```

**권장 순서:** `1a-1 → 1a-2~1a-3 → 1a-4~1a-5 → 1a-6~1a-8 → 1a-9~1a-10 → 1a-11`
- 1a-10은 초기 작업(1a-2 이후)과 병렬 진행 가능
- 1a-6, 1a-7, 1a-8은 서로 독립적이므로 병렬 가능

---

## 4. 파일별 변경 계획

### 4.1 `src/types.ts` — Fact 인터페이스 확장 (1a-9)

**현재 상태 (Phase 0에서 이미 확장됨):**

```typescript
export interface MemoryFact {
    id: string;
    project_key?: string;
    keywords: string[];
    content: string;
    source_session: string;
    created_at: string;
    last_accessed_at?: number;
    access_count?: number;
    // Phase 0에서 추가된 선택적 필드:
    origin_type?: string;
    confidence?: number;
    status?: string;
    scope?: string;
    evidence_count?: number;
    must_verify?: boolean;
    is_experimental?: boolean;
    severity?: string;
    agent_role?: string;
}
```

**Phase 1a 변경 사항:**
- Phase 0에서 추가한 선택적 필드의 **타입을 정제** (string → 유니온 리터럴 등)
- `HotContext` 인터페이스를 구체화 (Phase 0에서 이미 정의되었을 수 있으나, 1a-2/1a-3에서 실제 사용 형태에 맞춰 확정)
- 새로운 타입 추가:

```typescript
// Phase 1a에서 실제 사용하는 리터럴 유니온으로 정제
export type FactOriginType = 'user_explicit' | 'execution_observed' | 'tool_result' | 'inferred';
export type FactStatus = 'active' | 'unreviewed' | 'deprecated' | 'superseded';
export type FactSeverity = 'low' | 'medium' | 'high';

export interface MemoryFact {
    id: string;
    project_key?: string;
    keywords: string[];
    content: string;
    source_session: string;
    created_at: string;
    updated_at?: string;        // Phase 1a: revision 추적 (updated_at 수준)
    last_accessed_at?: number;
    access_count?: number;
    // Phase 1a 메타데이터
    origin_type?: FactOriginType;
    confidence?: number;        // 0.0 ~ 1.0
    status?: FactStatus;
    scope?: string;             // project_key와 동일한 스코프 식별자
    evidence_count?: number;
    must_verify?: boolean;
    is_experimental?: boolean;
    severity?: FactSeverity;
    agent_role?: string;
}

export interface HotContextEntry {
    id: string;
    content: string;
    origin_type: FactOriginType;
    confidence: number;
    must_verify?: boolean;
}

export interface HotContext {
    project_key: string;
    generated_at: string;
    session_count: number;        // 누적 세션 수 (rottenness 판단용)
    facts: HotContextEntry[];
    contradictions: HotContextEntry[];  // must_verify fact
}

export interface MemoryMetricRecord {
    ts: string;
    phase: string;
    active_fact_count: number;
    total_fact_count: number;
    relation_count: number;
    revision_count: number;
    hot_context_build_ms: number;
    compacting_build_ms: number;
    contradiction_count: number;
    // 임시 메트릭 (Phase 1a만)
    facts_scanned_per_compaction?: number;
    relations_scanned_per_lookup?: number;
    json_fact_load_ms?: number;
}
```

**하위 호환 보장:**
- 모든 새 필드는 선택적(`?`) 유지
- 기존 `MemoryFact` JSON 파일은 새 필드 없이도 정상 로드됨
- `origin_type`/`confidence`/`status`가 없는 기존 fact는 기본값 처리 로직에서 `'inferred'`/`0.5`/`'unreviewed'`로 간주

---

### 4.2 `src/config/schema.ts` — Phase 1a 설정 (Phase 0에서 이미 추가됨, 확정)

**Phase 0에서 추가된 설정 (1a 전체에서 사용):**

```typescript
// HarnessSettings에 추가 (Phase 0)
hot_context_enabled?: boolean;               // default: false
rich_fact_metadata_enabled?: boolean;        // default: false
confidence_threshold_active?: number;        // default: 0.7
boundary_hint_enabled?: boolean;             // default: false
```

**DEFAULT_HARNESS_SETTINGS 업데이트 (Phase 0):**

```typescript
hot_context_enabled: false,
rich_fact_metadata_enabled: false,
confidence_threshold_active: 0.7,
boundary_hint_enabled: false,
```

**Phase 1a 변경 사항:**
- 설정 자체는 Phase 0에서 이미 추가됨. Phase 1a에서는 이 설정을 **실제로 참조**하는 로직만 추가
- 추가 설정 필요 없음

**설정별 활용처:**

| 설정 | 활용 작업 | 활성화 시 동작 |
|------|----------|---------------|
| `hot_context_enabled` | 1a-2, 1a-3 | `session.idle`에서 hot-context.json 생성 + compacting에서 주입 |
| `rich_fact_metadata_enabled` | 1a-1 | fact 생성 시 `origin_type`/`confidence`/`status` 자동 분류 |
| `confidence_threshold_active` | 1a-1, 1a-8 | confidence ≥ 임계값 → `active`, 미만 → `unreviewed` |
| `boundary_hint_enabled` | 1a-5 | compacting 시 L1/L2에 관련 기억 힌트 포함 |

---

### 4.3 `src/harness/improver.ts` — 핵심 변경 대상

**현재 구조 (관련 함수/훅):**

| 함수/훅 | 라인 (대략) | 역할 | Phase 1a 변경 |
|----------|------------|------|--------------|
| `indexSessionFacts()` | ~L1220 | 세션 JSONL에서 fact 추출 | 1a-1: origin_type 프록시 분류 추가 |
| `consolidateFacts()` | ~L1346 | 중복 fact 병합 | 1a-6: 충돌 시 `must_verify` 부여 |
| `relateFacts()` | ~L1460 | fact 관계 발견 | 변경 없음 (최소한 유지) |
| `markFactPruneCandidates()` | ~L1550 | TTL 기반 fact 정리 | 1a-8: status 기반 정책 추가 |
| `formatFactLayer()` | ~L1585 | 3계층 fact 포맷 | 1a-4: 가중치 확장, 1a-5: boundary hint |
| `buildCompactionContext()` | ~L1598 | compacting 컨텍스트 빌드 | 1a-3: hot_context 주입, 1a-5: boundary hint |
| `promoteRules()` | 별도 위치 | SOFT→HARD 승격 | 1a-7: is_experimental + scope 방어 |
| `event` 훅 (`session.idle`) | ~L1691 | 세션 종료 처리 | 1a-2: hot_context 생성, 1a-10: 메트릭 기록 |
| `experimental.session.compacting` 훅 | ~L1804 | 컨텍스트 주입 | 1a-3: hot_context 읽기 |

**신규 추가 함수:**

| 함수 | 용도 | 작업 |
|------|------|------|
| `classifyOriginType(fact: MemoryFact): FactOriginType` | fact의 origin_type 프록시 분류 | 1a-1 |
| `computeConfidence(originType: FactOriginType): number` | origin_type별 confidence 매핑 | 1a-1 |
| `determineFactStatus(confidence: number, threshold: number): FactStatus` | confidence → status 변환 | 1a-1 |
| `enrichFactMetadata(fact: MemoryFact, settings): MemoryFact` | fact에 origin_type/confidence/status 일괄 부여 | 1a-1 |
| `generateHotContext(projectKey: string, facts: MemoryFact[]): HotContext` | hot-context.json 생성 | 1a-2 |
| `writeHotContext(projectKey: string, ctx: HotContext): void` | hot-context.json 파일 쓰기 | 1a-2 |
| `readHotContext(projectKey: string): HotContext | null` | hot-context.json 파일 읽기 | 1a-3 |
| `formatHotContextForCompacting(ctx: HotContext): string` | compacting용 문자열 변환 | 1a-3 |
| `rankFactsWithWeights(facts: MemoryFact[], ...): MemoryFact[]` | confidence + fact_type 가중치 랭킹 | 1a-4 |
| `buildBoundaryHints(facts: MemoryFact[], ranked: MemoryFact[]): string[]` | L1/L2 boundary hint 생성 | 1a-5 |
| `detectContradictions(facts: MemoryFact[]): MemoryFact[]` | 충돌 fact 탐지 + must_verify 설정 | 1a-6 |
| `isPromotionBlocked(fact: MemoryFact, targetProjectKey: string): boolean` | is_experimental + scope 검사 | 1a-7 |
| `cleanupWithStatus(projectKey: string, facts: MemoryFact[]): void` | status 기반 archive 정리 | 1a-8 |
| `appendMemoryMetrics(projectKey: string, metrics: MemoryMetricRecord): void` | memory-metrics.jsonl 기록 | 1a-10 |
| `collectMemoryMetrics(projectKey: string, startTime: number, ...): MemoryMetricRecord` | 메트릭 수집 | 1a-10 |

---

### 4.4 `src/harness/observer.ts` — 최소 수정 (1a-1)

**현재:** `session.idle` 이벤트에서 키워드 패턴 매칭으로 fact 원천 정보를 수집하지 않음.

**Phase 1a 변경:** fact 생성 시점에 `origin_type` 힌트를 전달할 수 있는 경로를 `observer.ts`에 추가할지 여부는 구현 시 판단. 마스터 플랜에서는 "선택적"으로 명시됨. 대안으로 `improver.ts`의 `indexSessionFacts()` 내에서 패턴 매칭으로 `origin_type`을 유추하는 방식도 가능. 후자를 권장 (`observer.ts` 수정 최소화).

---

### 4.5 신규 테스트 파일

**`src/__tests__/smoke-phase1a-file-semantics.ts`** (1a-11)

---

## 5. 작업별 상세 설계

### 5.1 작업 1a-1: Promotion Control (메타데이터 기반)

**목표:** fact 생성 시 `origin_type`, `confidence`, `status`를 메타데이터 프록시로 자동 분류.

**구현 위치:** `src/harness/improver.ts` — `indexSessionFacts()` 함수 내 및 신규 헬퍼 함수

**origin_type 분류 규칙 (패턴 매칭 기반):**

| `origin_type` | 판정 기준 | `confidence` |
|---------------|----------|-------------|
| `user_explicit` | 사용자 메시지에서 지시문 패턴 감지 (예: "반드시", "절대", "항상", "never", "always", "must" 등) | 0.9 |
| `execution_observed` | tool 실행 결과(`tool_result`, `bash` 호출 등)에서 확인 가능한 fact | 0.85 |
| `tool_result` | 검색/읽기 결과에서 추출된 fact (예: `read_file`, `search`, `grep` 결과) | 0.8 |
| `inferred` | 위 패턴에 해당하지 않음. `consolidateFacts`/`relateFacts`에서 파생된 fact의 기본값 | 0.5 |

**구현 세부:**

```typescript
// 신규 함수 — origin_type 프록시 분류
function classifyOriginType(fact: MemoryFact): FactOriginType {
    const content = fact.content.toLowerCase();
    const keywords = fact.keywords.map(k => k.toLowerCase());

    // 1. user_explicit: 지시문 패턴 감지
    const directivePatterns = [/반드시/, /절대/, /항상/, /never/i, /always/i, /must/i, /절대로/, /무조건/];
    if (directivePatterns.some(p => p.test(content))) return 'user_explicit';

    // 2. execution_observed: tool 실행 결과 패턴
    if (content.includes('exit code') || content.includes('stdout') || content.includes('stderr')) {
        return 'execution_observed';
    }

    // 3. tool_result: 파일/검색 결과 패턴
    if (keywords.some(k => ['read', 'search', 'grep', 'file'].includes(k))) {
        return 'tool_result';
    }

    // 4. 기본값
    return 'inferred';
}
```

**status 분류:**
- `confidence ≥ confidence_threshold_active` → `'active'`
- `confidence < confidence_threshold_active` → `'unreviewed'`
- `'deprecated'`와 `'superseded'`는 1a-8(정리)에서만 부여

**활성 조건:** `settings.rich_fact_metadata_enabled === true`

**연결점:**
- `indexSessionFacts()`에서 fact 저장 직전에 `enrichFactMetadata()` 호출
- `consolidateFacts()`에서 병합된 canonical fact에 `origin_type: 'inferred'` 재설정 (병합은 추론이므로)
- `relateFacts()`에서 새 관계 발견 시 관련 fact의 `evidence_count` 증가

**수정 파일:** `src/harness/improver.ts`

---

### 5.2 작업 1a-2: Hot Context 자동 생성

**목표:** `session.idle` 이벤트에서 `hot-context.json`을 자동 생성.

**구현 위치:** `src/harness/improver.ts` — `event` 훅 내 `session.idle` 처리 로직 끝

**생성 규칙:**

1. 활성 fact(`status: 'active'` 또는 `status` 없음) 중에서 선별
2. 선별 우선순위:
   - `must_verify: true` → 최우선 (contradictions 섹션에 배치)
   - `origin_type: 'user_explicit'` → 차순위
   - `confidence` 높은 순
   - 최근 `updated_at`/`created_at` 순
3. 총 ~500 토큰 이하로 압축 (대략 fact 5~10개)
4. `hot-context.json`에 저장

**파일 위치:** `~/.config/opencode/harness/projects/{project_key}/memory/hot-context.json`

**HotContext 데이터 형태:**

```json
{
    "project_key": "joseon",
    "generated_at": "2026-04-21T10:30:00Z",
    "session_count": 5,
    "facts": [
        {
            "id": "abc123",
            "content": "이 프로젝트는 React 19를 사용한다",
            "origin_type": "user_explicit",
            "confidence": 0.9,
            "must_verify": false
        }
    ],
    "contradictions": [
        {
            "id": "def456",
            "content": "Tailwind를 사용하지 않는다 vs 사용한다",
            "origin_type": "inferred",
            "confidence": 0.5,
            "must_verify": true
        }
    ]
}
```

**활성 조건:** `settings.hot_context_enabled === true`

**토큰 예산:** ~500 토큰 (fact당 ~50~100 토큰 가정 시 5~10개). `buildBoundedCompactionContext`와 동일한 문자 수 상한(`DIFF_MAX_CHARS`)을 활용하되, hot_context 전용 상한을 별도로 설정 (예: `HOT_CONTEXT_MAX_TOKENS_ESTIMATE = 2000` 문자).

**수정 파일:** `src/harness/improver.ts`

---

### 5.3 작업 1a-3: Hot Context 세션 시작 주입

**목표:** `experimental.session.compacting` 훅에서 `hot-context.json`을 scaffold 앞에 주입.

**구현 위치:** `src/harness/improver.ts` — `buildCompactionContext()` 함수 시작 부분

**주입 순서 (변경 후):**

```
1. [HARNESS HOT CONTEXT — previous session summary]  ← NEW
2. [HARNESS SCAFFOLD]
3. [HARNESS HARD RULES — MUST follow]
4. [HARNESS SOFT RULES — recommended]
5. [HARNESS MEMORY — past decisions (layered)]   ← boundary hint 포함 (1a-5)
```

**포맷:**

```
[HARNESS HOT CONTEXT — previous session summary]
⚠ Contradictions to verify:
- [def456] Tailwind를 사용하지 않는다 vs 사용한다 (needs verification)

Key decisions from previous sessions:
- [abc123] 이 프로젝트는 React 19를 사용한다
- [ghi789] 테스트는 vitest를 사용한다
```

**활성 조건:** `settings.hot_context_enabled === true`

**동작:**
- `hot-context.json`이 존재하지 않으면 아무것도 주입하지 않음 (graceful degradation)
- `hot-context.json`이 비어있거나 오래된 경우에도 주입 (rottenness 판단은 모델에게 위임)

**수정 파일:** `src/harness/improver.ts`

---

### 5.4 작업 1a-4: 3계층 공개 가중치 확장

**목표:** 기존 score 기반 3계층 랭킹에 `fact_type`/`confidence`/`status` 가중치를 반영.

**구현 위치:** `src/harness/improver.ts` — `buildCompactionContext()` 내 3계층 progressive disclosure 영역 (~L1656)

**현재 로직:** `semantic_fact_candidates`의 기존 순서 그대로 30%/40%/30% 비율로 L3/L2/L1 분할.

**변경:**

1. **fact_type 가중치** (origin_type 기반, 없으면 기본값):
   - `user_explicit` → ×1.5
   - `execution_observed` → ×1.3
   - `tool_result` → ×1.1
   - `inferred` → ×1.0

2. **confidence 가중치:** `confidence`가 높을수록 상위 레이어(L3)에 배치

3. **status 필터:**
   - `status: 'unreviewed'` + `confidence < 0.5` → L1에 강제 배치 (힌트만 노출)
   - `status: 'active'` → 일반 랭킹 적용
   - `status: 'deprecated'` / `'superseded'` → compacting에서 제외 (이미 archive 처리됨)

**구현 접근:**

```typescript
function rankFactsWithWeights(
    facts: MemoryFact[],
    candidates: { fact: MemoryFact; metadata_score: number; lexical_score: number }[],
): { fact: MemoryFact; weighted_score: number }[] {
    return candidates.map(c => {
        const baseScore = (c.metadata_score + c.lexical_score) / 2;
        const typeMultiplier = getFactTypeMultiplier(c.fact);
        const confidence = c.fact.confidence ?? 0.5;
        const weightedScore = baseScore * typeMultiplier * confidence;
        return { fact: c.fact, weighted_score: weightedScore };
    }).sort((a, b) => b.weighted_score - a.weighted_score);
}
```

**활성 조건:** `settings.rich_fact_metadata_enabled === true`이고 `settings.semantic_compacting_enabled === true`일 때만. 그 외에는 기존 로직 그대로.

**수정 파일:** `src/harness/improver.ts`

---

### 5.5 작업 1a-5: Boundary Hint (compacting 통합)

**목표:** compacting 시 L1/L2 fact에 "관련 기억 있음" 힌트를 포함.

**구현 위치:** `src/harness/improver.ts` — `formatFactLayer()` 함수 및 `buildCompactionContext()` 내 3계층 렌더링 영역

**동작:**

- L1 fact: `keywords` + `"... 관련 기억 있음 (자세히 보려면 검색)"` 힌트 추가
- L2 fact: 첫 문장 + 관련 fact 개수 힌트
- `origin_type: 'decision'` 또는 `'constraint'` (user_explicit, confidence ≥ 0.8) fact는 힌트 우선순위 상향
- `origin_type: 'preference'` (inferred, confidence < 0.5) fact는 과도한 힌트 방지

**포맷 예시 (L1 + boundary hint):**

```
- [abc123] keywords: react, vite — 관련 기억 3건 있음
- [def456] keywords: tailwind — ⚠ 검증 필요
```

**활성 조건:** `settings.boundary_hint_enabled === true`

**수정 파일:** `src/harness/improver.ts`

---

### 5.6 작업 1a-6: Contradiction-first Surfacing

**목표:** `consolidateFacts()`에서 충돌 감지 시 `must_verify` 자동 부여 + hot_context에 별도 섹션 배치.

**구현 위치:** `src/harness/improver.ts` — `consolidateFacts()` 함수

**현재 로직:** Jaccard 유사도 > 0.4 또는 content overlap 시 같은 그룹으로 병합.

**변경:**

1. Jaccard는 높으나 content가 상충하는 경우(반대 의미)를 감지:
   - 키워드는 겹치지만 content에 부정문/반대 패턴이 있는지 확인
   - 예: "A를 사용한다" vs "A를 사용하지 않는다"
2. 상충 그룹의 fact에 `must_verify: true` 부여
3. 병합은 수행하되, canonical fact에 `must_verify: true` 상속
4. hot_context 생성 시(1a-2) `must_verify` fact를 `contradictions` 섹션에 배치

**충돌 감지 휴리스틱:**

```typescript
function detectContradiction(contentA: string, contentB: string): boolean {
    // 부정문 패턴 감지
    const negationPatterns = [/not/i, /no\b/i, /don'?t/i, /doesn'?t/i, /하지\s*않/, /금지/, /불가/];
    const aHasNeg = negationPatterns.some(p => p.test(contentA));
    const bHasNeg = negationPatterns.some(p => p.test(contentB));
    // 한쪽만 부정이면 충돌 가능성
    return aHasNeg !== bHasNeg;
}
```

**활성 조건:** `settings.rich_fact_metadata_enabled === true`

**수정 파일:** `src/harness/improver.ts`

---

### 5.7 작업 1a-7: 안전 퓨즈 확장

**목표:** 기존 SOFT→HARD 승격 로직(`promoteRules()`)에 `is_experimental` + scope 방어 추가.

**구현 위치:** `src/harness/improver.ts` — `promoteRules()` 함수

**현재 로직:** `violation_count >= soft_to_hard_threshold`일 때 SOFT → HARD 승격. `scope: 'prompt'` 규칙은 승격 제외.

**추가 방어:**

1. **`is_experimental: true` 차단:**
   - 승격 대상 규칙과 관련 fact에 `is_experimental: true`가 있으면 승격 차단
   - 판단: 규칙의 `source_signal_id`와 연결된 fact를 확인하거나, 규칙 자체에 실험 플래그가 있는지 검사
   - 차단 시 로그 기록: `"promotion blocked: is_experimental=true"`

2. **scope 불일치 차단:**
   - 규칙의 `project_key`가 아닌 다른 프로젝트의 fact에서 파생된 규칙은 승격 차단
   - `scope: 'prompt'` 규칙은 기존대로 승격 제외 (변경 없음)

**구현 접근:**

```typescript
function isPromotionBlocked(rule: Rule, projectKey: string): boolean {
    // 1. is_experimental check
    if (rule.pattern.scope === 'prompt') return true; // 기존 로직 유지

    // 2. is_experimental fact check (rule과 관련된 fact 조회)
    const relatedFacts = findFactsRelatedToRule(rule);
    if (relatedFacts.some(f => f.is_experimental === true)) return true;

    // 3. scope mismatch check
    if (rule.project_key !== 'global' && rule.project_key !== projectKey) return true;

    return false;
}
```

**활성 조건:** 항상 활성 (설정 토글 없음, 기존 승격 로직의 강화)

**수정 파일:** `src/harness/improver.ts`

---

### 5.8 작업 1a-8: TTL + Confidence 혼합 정리

**목표:** 기존 TTL 정리(`markFactPruneCandidates()`)에 `confidence`/`status` 반영.

**구현 위치:** `src/harness/improver.ts` — `markFactPruneCandidates()` 함수

**현재 로직:** `access_count === 0` + TTL 만료 시 archive 이동.

**변경:**

| `status` | 정책 |
|----------|------|
| `'superseded'` | TTL과 무관하게 즉시 archive 이동 |
| `'deprecated'` | TTL과 무관하게 즉시 archive 이동 |
| `'active'` | 기존 TTL 로직 적용 (`access_count` + `fact_ttl_days`) |
| `'unreviewed'` | 기존 TTL 로직 적용 + `confidence < 0.3`이면 TTL 절반으로 단축 |
| status 없음 (기존 fact) | 기존 TTL 로직 그대로 (하위 호환) |

**활성 조건:** `settings.rich_fact_metadata_enabled === true`

**수정 파일:** `src/harness/improver.ts`

---

### 5.9 작업 1a-9: Fact 인터페이스 타입 정제

**목표:** Phase 0에서 추가한 선택적 필드를 Phase 1a 구현에 맞춰 타입 정제.

**구현 위치:** `src/types.ts`

**변경 내용:** 섹션 4.1에서 이미 상세히 기술함. 핵심:
- `origin_type?: string` → `origin_type?: FactOriginType` (유니온 리터럴)
- `status?: string` → `status?: FactStatus` (유니온 리터럴)
- `severity?: string` → `severity?: FactSeverity` (유니온 리터럴)
- `HotContext`, `HotContextEntry`, `MemoryMetricRecord` 인터페이스 추가

**주의:** Phase 0에서 `string`으로 정의된 필드를 유니온 리터럴로 변경하는 것은 Phase 1a 구현 중에만 수행. Phase 0에서는 `string`으로 두어 하위 호환을 먼저 확보.

**수정 파일:** `src/types.ts`

---

### 5.10 작업 1a-10: 메모리 메트릭 수집 (memory-metrics.jsonl)

**목표:** compacting 종료 시 메트릭을 `memory-metrics.jsonl`에 append.

**구현 위치:** `src/harness/improver.ts` — `event` 훅 내 `session.idle` 처리 로직 끝 + `buildCompactionContext()` 끝

**수집 지점 (Collection Points):**

| 시점 | 위치 | 수집 메트릭 |
|------|------|------------|
| `session.idle` 끝 | `event` 훅, 모든 L5+L6 처리 완료 후 | `active_fact_count`, `total_fact_count`, `relation_count`, `contradiction_count`, `facts_scanned_per_compaction`, `relations_scanned_per_lookup`, `json_fact_load_ms` |
| `buildCompactionContext()` 시작 | compacting 훅 | `compacting_build_ms` 시작 시간 기록 |
| `buildCompactionContext()` 끝 | compacting 훅 | `compacting_build_ms` 계산, `hot_context_build_ms` 계산 |
| `generateHotContext()` | 1a-2 | `hot_context_build_ms` |

**메트릭 레코드 형태 (상세):**

```jsonl
{
    "ts": "2026-04-21T10:30:00Z",
    "phase": "1a",
    "active_fact_count": 42,
    "total_fact_count": 58,
    "relation_count": 12,
    "revision_count": 3,
    "hot_context_build_ms": 15,
    "compacting_build_ms": 230,
    "facts_scanned_per_compaction": 58,
    "relations_scanned_per_lookup": 12,
    "contradiction_count": 1,
    "json_fact_load_ms": 8
}
```

**파일 위치:** `~/.config/opencode/harness/projects/{project_key}/memory/memory-metrics.jsonl`

**관리 규칙:**
- 30일 초과 데이터 자동 rotate (기존 `rotateHistoryIfNeeded` 패턴 활용)
- 파일 크기 상한: 1MB (초과 시 oldest-first 삭제)

**활성 조건:** 항상 수집 (설정 토글 없음. Phase 1a의 존재 이유가 Gate A 메트릭이므로 기본 활성화)

**수정 파일:** `src/harness/improver.ts`

---

### 5.11 작업 1a-11: Phase 1a Smoke 테스트

**목표:** Phase 1a의 모든 기능에 대한 smoke 테스트 작성.

**파일:** `src/__tests__/smoke-phase1a-file-semantics.ts` (신규)

**테스트 항목:**

| 테스트 | 검증 내용 | 관련 작업 |
|--------|----------|----------|
| `classifyOriginType` 단위 테스트 | 지시문/실행/검색/기본 분류 | 1a-1 |
| `computeConfidence` 단위 테스트 | origin_type별 confidence 매핑 | 1a-1 |
| `determineFactStatus` 단위 테스트 | 임계값 기반 active/unreviewed 분류 | 1a-1 |
| Hot Context 생성 통합 테스트 | `session.idle` 후 `hot-context.json` 파일 존재 확인 | 1a-2 |
| Hot Context 주입 통합 테스트 | compacting 시 scaffold 앞에 hot_context 나타나는지 | 1a-3 |
| 3계층 가중치 랭킹 테스트 | confidence 높은 fact가 L3에 배치되는지 | 1a-4 |
| Boundary Hint 포맷 테스트 | L1에 관련 기억 힌트 포함되는지 | 1a-5 |
| Contradiction 감지 테스트 | 상충 fact에 `must_verify: true` 부여되는지 | 1a-6 |
| Contradiction hot_context 배치 | must_verify fact가 contradictions 섹션에 있는지 | 1a-6 |
| 안전 퓨즈 — experimental 차단 | `is_experimental: true` fact 관련 규칙 승격 차단 | 1a-7 |
| 안전 퓨즈 — scope 차단 | 다른 프로젝트 규칙 승격 차단 | 1a-7 |
| TTL + status 정리 테스트 | `superseded` fact 즉시 archive, `active`는 TTL 적용 | 1a-8 |
| TTL + low confidence 단축 | `unreviewed` + `confidence < 0.3` 시 TTL 절반 | 1a-8 |
| 메트릭 수집 테스트 | `memory-metrics.jsonl`에 레코드 append 확인 | 1a-10 |
| 기본값 안전 테스트 | 모든 토글 off 시 기존 동작과 완전 동일 | 전체 |
| 하위 호환 테스트 | 새 필드 없는 기존 fact JSON이 정상 로드됨 | 1a-9 |

**테스트 작성 패턴:** 기존 `smoke-step5b-memory-relevance.ts` 패턴 참조. `HarnessImprover`를 생성하고, 임시 디렉토리에 테스트 데이터를 구성한 뒤 훅을 직접 호출.

---

## 6. 설정 / Feature Flags 요약

| 설정 | 타입 | 기본값 | 담당 작업 | Phase 1a에서 새로 추가? |
|------|------|--------|----------|----------------------|
| `hot_context_enabled` | boolean | `false` | 1a-2, 1a-3 | 아니오 (Phase 0에서 추가) |
| `rich_fact_metadata_enabled` | boolean | `false` | 1a-1, 1a-4, 1a-6, 1a-8 | 아니오 (Phase 0에서 추가) |
| `confidence_threshold_active` | number | `0.7` | 1a-1, 1a-8 | 아니오 (Phase 0에서 추가) |
| `boundary_hint_enabled` | boolean | `false` | 1a-5 | 아니오 (Phase 0에서 추가) |

**Feature Flag 동작 원칙:**

1. **default-off:** 모든 Phase 1a 설정은 `false`가 기본값
2. **독립 토글:** 각 설정은 독립적으로 활성화 가능
3. **의존성:** `hot_context_enabled`가 `rich_fact_metadata_enabled` 없이도 동작 (metadata 없는 기존 fact로 hot_context 생성)
4. **1a-7, 1a-10은 설정 없이 항상 활성:** 안전 퓨즈 확장과 메트릭 수집은 토글 없이 항상 동작

---

## 7. 데이터 형태 변경

### 7.1 `MemoryFact` JSON 파일 (기존 → Phase 1a)

**Before (현재):**
```json
{
    "id": "abc123",
    "project_key": "joseon",
    "keywords": ["react", "vite"],
    "content": "이 프로젝트는 React 19 + Vite를 사용한다",
    "source_session": "session-2026-04-21.jsonl",
    "created_at": "2026-04-21T10:00:00Z",
    "last_accessed_at": 1745232000000,
    "access_count": 3
}
```

**After (Phase 1a, `rich_fact_metadata_enabled=true`):**
```json
{
    "id": "abc123",
    "project_key": "joseon",
    "keywords": ["react", "vite"],
    "content": "이 프로젝트는 React 19 + Vite를 사용한다",
    "source_session": "session-2026-04-21.jsonl",
    "created_at": "2026-04-21T10:00:00Z",
    "updated_at": "2026-04-21T12:00:00Z",
    "last_accessed_at": 1745232000000,
    "access_count": 3,
    "origin_type": "user_explicit",
    "confidence": 0.9,
    "status": "active",
    "scope": "joseon",
    "evidence_count": 2,
    "must_verify": false,
    "is_experimental": false,
    "severity": "high",
    "agent_role": null
}
```

**하위 호환:** 새 필드가 없는 기존 JSON 파일은 정상 로드됨. `origin_type`이 없으면 `'inferred'`, `confidence`가 없으면 `0.5`, `status`가 없으면 `'unreviewed'`로 간주.

### 7.2 신규 파일: `hot-context.json`

경로: `~/.config/opencode/harness/projects/{project_key}/memory/hot-context.json`

형태는 섹션 5.2에 명시된 `HotContext` 인터페이스 참조.

### 7.3 신규 파일: `memory-metrics.jsonl`

경로: `~/.config/opencode/harness/projects/{project_key}/memory/memory-metrics.jsonl`

형태는 섹션 5.10에 명시된 `MemoryMetricRecord` 참조. JSON Lines (append-only).

### 7.4 변경 없는 파일

- `memory/facts/{id}.json` — 기존 fact 파일은 그대로. 새 필드는 점진적으로 채워짐
- `memory/relations.jsonl` — `relateFacts()` 로직 변경 없음. 최소한 유지
- `memory/archive/` — 기존과 동일한 역할. `status: 'superseded'`/`'deprecated'` fact가 추가로 이동
- `rules/soft/`, `rules/hard/` — 구조 변경 없음. 1a-7은 승격 로직만 변경

---

## 8. `memory-metrics.jsonl` 수집 지점 상세

### 8.1 `session.idle` 훅 (event handler)

**위치:** `src/harness/improver.ts` ~L1691, 모든 L5+L6 처리 완료 직후

**수집 로직:**

```typescript
// event 훅 내 session.idle 처리 끝
const metricsStartTime = Date.now();

// ... (기존 L5+L6 처리 전체) ...

// 메트릭 수집 (1a-10)
try {
    const factsDir = join(HARNESS_DIR, 'memory/facts');
    const archiveDir = join(HARNESS_DIR, 'memory/archive');
    const relationsPath = join(HARNESS_DIR, 'memory/relations.jsonl');

    const activeFacts = existsSync(factsDir) ? loadJsonFiles<MemoryFact>(factsDir) : [];
    const totalFacts = activeFacts.length + (existsSync(archiveDir) ? readdirSync(archiveDir).filter(f => f.endsWith('.json')).length : 0);
    const relations = loadJsonlRecords<FactRelation>(relationsPath);

    const metrics: MemoryMetricRecord = {
        ts: new Date().toISOString(),
        phase: '1a',
        active_fact_count: activeFacts.length,
        total_fact_count: totalFacts,
        relation_count: relations.length,
        revision_count: 0,  // Phase 1a에서는 updated_at 기준으로만 추적
        hot_context_build_ms: 0,  // hot_context 생성 시 측정하여 전달
        compacting_build_ms: 0,   // compacting 시 측정하여 전달
        contradiction_count: activeFacts.filter(f => f.must_verify === true).length,
        facts_scanned_per_compaction: activeFacts.length,
        relations_scanned_per_lookup: relations.length,
        json_fact_load_ms: Date.now() - metricsStartTime,
    };

    const metricsPath = join(HARNESS_DIR, 'projects', projectKey, 'memory', 'memory-metrics.jsonl');
    mkdirSync(join(HARNESS_DIR, 'projects', projectKey, 'memory'), { recursive: true });
    appendRecord(metricsPath, metrics);
} catch (err) {
    logger.warn('improver', 'memory metrics collection failed', { error: err });
}
```

### 8.2 `buildCompactionContext()` 훅

**위치:** `src/harness/improver.ts` ~L1598

**수집:** `compacting_build_ms`를 함수 시작-끝 시간차로 측정. 측정값은 `session.idle`에서 수집하는 메트릭에 전달할 수 없으므로(다른 훅), 별도 메트릭 레코드로 기록하거나 인스턴스 변수로 공유.

**권장:** `compacting_build_ms`는 compacting 훅에서 별도 메트릭 레코드로 기록. `session.idle`의 메트릭에는 `compacting_build_ms: 0`으로 기록 (또는 마지막 compacting 측정값을 파일에서 읽어옴).

---

## 9. 검증 / 테스트 계획

### 9.1 Phase 1a 검증 체크리스트

| 항목 | 검증 방법 | 합격 기준 |
|------|----------|----------|
| 기존 테스트 회귀 | `npx vitest run` 전체 실행 | 580+ 기존 테스트 + Phase 1a 신규 테스트 전부 통과 |
| 하위 호환 | 새 필드 없는 기존 fact JSON 로드 | 정상 로드, `origin_type='inferred'`, `confidence=0.5`로 간주 |
| Hot context 주입 | compacting 후 output.context 검사 | scaffold 앞에 `[HARNESS HOT CONTEXT]` 섹션 존재 |
| Promotion control | fact 생성 후 파일 검사 | `origin_type`, `confidence`, `status` 필드가 규칙에 맞게 설정됨 |
| 안전 퓨즈 | `is_experimental: true` fact 관련 규칙 승격 시도 | 승격 차단됨, 로그에 `"promotion blocked"` 기록 |
| Contradiction | 상충 fact 쌍 생성 후 consolidate 실행 | `must_verify: true` 부여, hot_context contradictions 섹션에 배치 |
| Boundary hint | boundary_hint_enabled=true 후 compacting 실행 | L1 fact에 관련 기억 힌트 포함 |
| TTL+status | `status: 'superseded'` fact 생성 | TTL과 무관하게 archive 이동 |
| 기본값 안전 | 모든 Phase 1a 토클 off 상태에서 실행 | 기존 동작과 완전 동일 (출력 diff 없음) |
| 메트릭 | session.idle 후 파일 검사 | `memory-metrics.jsonl`에 유효한 JSON Lines 레코드 존재 |
| relations 최소성 | relateFacts 실행 후 확인 | `relations.jsonl` 과도 증가 없음, MAX_NEW_RELATIONS(200) 한도 유지 |

### 9.2 테스트 파일

- `src/__tests__/smoke-phase1a-file-semantics.ts` — 신규 smoke 테스트 (16개 테스트 항목, 섹션 5.11 참조)
- 기존 테스트 파일은 수정하지 않음 (회귀 확인만 수행)

### 9.3 수동 검증 시나리오

1. **Cold start 복원:** 세션 A에서 결정을 내리고 → 세션 B 시작 시 hot_context 없이 도구 호출 1회 이상 필요 → Phase 1a 활성화 후 세션 B 시작 시 hot_context로 0회 도구 호출로 동일 결정 인지
2. **Contradiction 시나리오:** "A 라이브러리 사용" fact와 "A 라이브러리 금지" fact가 동시에 존재할 때 hot_context의 contradictions 섹션에 표시되는지 확인
3. **Experimental 차단:** `is_experimental: true` fact에서 파생된 규칙이 HARD로 승격되지 않는지 확인

---

## 10. 롤아웃 전략

### 10.1 배포 순서

1. **코드 머지:** Phase 1a 전체를 한 브랜치에서 구현
2. **회귀 테스트:** 기존 580+ 테스트 전부 통과 확인
3. **신규 테스트:** Phase 1a smoke 테스트 전부 통과
4. **코드 리뷰:** 마스터 플랜과 Phase 1a 문서 기준으로 리뷰
5. **머지 후 default-off 운영:** 모든 Phase 1a 설정이 `false`이므로 기존 동작에 영향 없음
6. **선택적 활성화:** 하나씩 토글을 활성화하며 관찰

### 10.2 활성화 순서 (권장)

```
1. 메트릭 수집 (1a-10) — 항상 활성, 설정 불필요
2. 안전 퓨즈 (1a-7) — 항상 활성, 설정 불필요
3. rich_fact_metadata_enabled=true → 1a-1, 1a-4, 1a-6, 1a-8 활성화
4. hot_context_enabled=true → 1a-2, 1a-3 활성화
5. boundary_hint_enabled=true → 1a-5 활성화
6. confidence_threshold_active 튜닝 — 메트릭 데이터로 임계값 조정
```

### 10.3 Gate A 평가

- **시작:** Phase 1a 토글 전체 활성화 후 메트릭 축적 시작
- **주기:** 주 1회 `memory-metrics.jsonl` 리뷰
- **판단:** Gate A 조건 2개 이상 충족 시 Phase 1b 착수 논의 (마스터 플랜 섹션 7 참조)

---

## 11. 롤백 노트

### 11.1 토글 기반 롤백

모든 Phase 1a 기능은 설정 토글로 즉시 비활성화 가능:

```jsonc
// .opencode/harness.jsonc
{
    "harness": {
        "hot_context_enabled": false,
        "rich_fact_metadata_enabled": false,
        "boundary_hint_enabled": false
    }
}
```

토글 off 시 기존 동작과 완전히 동일해야 함. 이것이 검증 체크리스트의 "기본값 안전" 항목.

### 11.2 데이터 롤백

- `hot-context.json`: 삭제하면 hot_context 주입이 비활성화됨. 안전한 삭제 가능.
- `memory-metrics.jsonl`: 삭제해도 기능에 영향 없음. 로그 파일이므로.
- `MemoryFact` JSON의 새 필드: 무시됨. 기존 코드는 새 필드를 읽지 않음.
- `relations.jsonl`: 변경 없으므로 롤백 불필요.

### 11.3 코드 롤백

Phase 1a 전체를 revert해도 기존 데이터 손상 없음. 새 필드가 포함된 fact 파일은 기존 코드에서 정상 로드됨 (추가 필드 무시).

---

## 12. 리스크

| 리스크 | 확률 | 영향 | 완화 전략 |
|--------|------|------|----------|
| Fact 인터페이스 확장으로 기존 fact 파일 호환성 깨짐 | 낮음 | HIGH | 모든 새 필드 선택적. 기본값 처리 로직 철저. smoke 테스트에서 하위 호환 검증 |
| Hot context 주입으로 compacting 토큰 예산 초과 | 중간 | MEDIUM | `~500 토큰` 상한. `buildBoundedCompactionContext`로 총량 제어. 초과 시 hot_context를 truncate |
| Promotion control 메타데이터 프록시가 실제 품질과 불일치 | 중간 | MEDIUM | Phase 1a는 default-off + shadow 로깅. `memory-metrics.jsonl` 데이터로 임계값 튜닝 |
| `is_experimental` 감지가 거짓 음성(실험인데 감지 못함) | 낮음 | LOW | 키워드 매칭 + compacting 패턴으로 보완. 100% 완벽 불필요. 데이터 축적 후 개선 |
| `consolidateFacts` 충돌 감지 휴리스틱이 과도하게 must_verify 부여 | 중간 | MEDIUM | 부정문 패턴 매칭을 보수적으로 적용. threshold 조정 가능. 메트릭으로 `contradiction_count` 모니터링 |
| `memory-metrics.jsonl` 파일 과도 성장 | 낮음 | LOW | 30일 rotate + 1MB 상한. 기존 `rotateHistoryIfNeeded` 패턴 활용 |
| relations.jsonl이 Phase 1a에서 과도하게 증가 | 낮음 | MEDIUM | Phase 1a에서 `relateFacts()` 로직 변경 없음. 기존 MAX_NEW_RELATIONS(200) 한도 유지. 과도 증가 시 Phase 1b에서 SQLite로 해결 |
| confidence 임계값(0.7)이 프로젝트별로 부적합 | 중간 | LOW | `confidence_threshold_active` 설정으로 조정 가능. Gate A 메트릭으로 튜닝 |

---

## 13. 종료 기준 (Exit Criteria)

Phase 1a가 **완료**되었다고 판단하기 위한 조건:

- [x] 작업 1a-1~1a-11 구현 완료
- [x] `src/__tests__/smoke-phase1a-file-semantics.ts` 테스트 전부 통과
- [x] 기존 580+ 테스트 회귀 없음
- [x] 모든 Phase 1a 토글이 off일 때 기존 동작과 완전 동일 확인
- [x] `hot_context_enabled=true` 시 hot_context 주입 동작 확인
- [x] `memory-metrics.jsonl`에 메트릭 정상 기록 확인
- [x] 코드 리뷰 통과 (마스터 플랜 + 본 문서 기준)
- [x] `src/types.ts` 타입 정제 완료 (유니온 리터럴)

Phase 1a가 **완료된 후 Gate A로 전환:**
- 메트릭 축적 시작 (Phase 1a 토글 활성화 상태로 운영)
- 주간 `memory-metrics.jsonl` 리뷰
- Gate A 조건 충족 시 Phase 1b 착수 논의

---

## 14. Gate A / Phase 1b 연기 항목 명시

다음 항목은 Phase 1a에서 **명시적으로 구현하지 않으며**, Gate A 이후에 검토한다:

| 항목 | 연기 사유 | Phase 1b에서의 처리 |
|------|----------|-------------------|
| SQLite 최소 KV 스토어 | 파일 기반 한계를 먼저 메트릭으로 확인 | Gate A에서 `facts_scanned_per_compaction` > 80 등 조건 충족 시 도입 |
| `relations.jsonl` → SQLite 이관 | JSONL 선형 스캔의 한계 측정 필요 | Gate A에서 `relations_scanned_per_lookup` > 30 시 이관 |
| `revisions` 전체 체인 추적 | `updated_at` 수준으로 충분 | SQLite 도입 시 `revisions` 테이블로 확장 |
| 복잡한 관계 유형 (causal, temporal 등) | 현재 `same_topic`/`shared_keywords`로 충분 | fact 수 > 100 + 검색 누락 사례 누적 시 검토 |
| `hot_context` 세션 중 갱신 (MCP 도구) | Plugin API 도구 등록 경로 불확실 | Phase 2에서 MCP 또는 파일 감시 패턴으로 검토 |
| FTS5 하이브리드 검색 | 키워드 검색으로 충분 | Phase 2에서 검색 누락 사례 3건 이상 시 검토 |
| 벡터 임베딩 / 의미 검색 | 외부 의존성 | Phase 3 |
| LLM 기반 fact 추출 | Plugin 훅에서 LLM 직접 호출 불가 | Phase 3 |

---

## 부록: 작업별 파일 변경 요약

| 파일 | 변경 유형 | 관련 작업 | 변경 규모 (예상) |
|------|----------|----------|----------------|
| `src/types.ts` | 수정 (타입 정제 + 인터페이스 추가) | 1a-9 | ~40줄 추가 |
| `src/config/schema.ts` | 변경 없음 (Phase 0에서 완료) | — | 0줄 |
| `src/harness/improver.ts` | 수정 (핵심 변경 대상) | 1a-1~1a-8, 1a-10 | ~300줄 추가/수정 |
| `src/harness/observer.ts` | 수정 최소화 또는 변경 없음 | 1a-1 | ~0~10줄 |
| `src/__tests__/smoke-phase1a-file-semantics.ts` | 신규 | 1a-11 | ~400줄 |
| `src/harness/canary.ts` | 변경 없음 | — | 0줄 |
| `src/harness/enforcer.ts` | 변경 없음 | — | 0줄 |
| `src/orchestrator/*` | 변경 없음 | — | 0줄 |
| `src/shared/*` | 변경 없음 | — | 0줄 |
| `src/hooks/*` | 변경 없음 | — | 0줄 |
| `src/agents/*` | 변경 없음 | — | 0줄 |
