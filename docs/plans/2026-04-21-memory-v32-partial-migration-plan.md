# Memory v3.2 부분 마이그레이션 마스터 플랜

> 날짜: 2026-04-21
> 상태: Phase 0 ✅ 완료 / Phase 1a ✅ 완료 / Gate A 모니터링 진행 중
> 범위: `compiled-memory-architecture-v3.2-final.md`의 전면 교체가 아닌 선택적 흡수
> 영향 모듈: `src/harness/improver.ts`, `src/harness/observer.ts`, `src/types.ts`, `src/config/schema.ts`
> 참고: 이 문서는 마스터 플랜. 각 Phase 세부 설계는 별도 Phase 문서로 분리한다.

---

## 1. 목표 (Goal)

v3.2 메모리 아키텍처에서 **현재 하네스 폐루프를 보존하면서 의미적으로 타당한 부분만 점진적으로 흡수**한다.

구체적으로:

- **Phase 1a에서 v3.2의 패턴과 의미론을 현재 파일 기반 시스템에 녹인다.** SQLite/벡터/LLM 추출은 이후 Phase로 연기. relations/revision은 최소한으로 유지하고 순수 JSON에서 과도하게 구축하지 않는다.
- **Gate A를 메모리 메트릭으로 명시적 측정한다.** 직관이 아닌 `memory-metrics.jsonl` 데이터로 Phase 1a→1b 전환 여부를 결정한다.
- **Phase 1b에서 최소 SQLite를 도입한다.** relations/revisions 등 JSON으로 다루기 부담스러운 구조를 SQLite로 이관.
- **Fact 메타데이터를 풍부하게 만든다.** `origin_type`, `confidence`, `status`, `scope` 등 v3.2의 패턴을 현재 JSON 파일에 반영.
- **Hot Context 캐시를 파일 기반으로 구현한다.** 세션 시작 시 0회 도구 호출로 이전 컨텍스트를 복원.
- **Boundary Hint를 compacting 훅에 녹인다.** 새로운 독립 모듈이 아닌 기존 compacting 파이프라인의 확장.
- **Recall Budget을 구현한다.** 세션 중간 회수 결과의 누적을 제한.

---

## 2. 비목표 (Non-Goals)

| 항목 | 이유 |
|------|------|
| Phase 1a에서 relations/revisions 과도 구축 | 순수 JSON에서 복잡한 관계/수정 이력을 관리하는 것은 쿼리 불가 + 유지비만 증가. Gate A 이후 SQLite로 이관 |
| 벡터 임베딩 (all-MiniLM-L6-v2) | 외부 의존성 + 로컬 모델 실행 복잡도. Phase 3에서 검토 |
| LLM 기반 fact 추출 | 플러그인 훅에서 LLM 직접 호출 불가 (`docs/roadmap.md` 5f 탐색 결과 참조). Phase 3에서 서브에이전트 위임 패턴으로 검토 |
| Wiki 컴파일 레이어 | fact 수가 충분히 축적되지 않음. 오버엔지니어링 |
| AGENTS.md 자동 삽입 | 현재 compacting 주입으로 충분. 별도 승격 경로 중복 |
| Cross-project 자동 승격 | `roadmap.md` #7에서 이미 "guarded-off"로 판정 |
| `update_hot_context` MCP 도구 | OpenCode Plugin API에서 도구 등록 경로 불확실. Phase 1a에서는 compacting 훅 내 자동 갱신으로 대체 |

---

## 3. 지침 결정 (Guiding Decisions)

### 3.1 파일 = 진실 원칙 유지

v3.2는 SQLite를 기본 저장소로 설계했으나, 현재 프로젝트의 핵심 원칙은 **파일 시스템만으로 상태 관리**다. 마이그레이션 전 과정에서 이 원칙을 유지한다. Phase 1b에서 SQLite를 도입하더라도 JSON 파일이 진실의 원천이며 SQLite는 인덱스/캐시 역할만 수행한다.

현재 런타임 데이터 구조:
```
~/.config/opencode/harness/
├── memory/
│   ├── facts/{id}.json         # fact JSON 파일 (project_key 포함)
│   ├── archive/{id}.json       # TTL/consolidate archive
│   └── relations.jsonl         # fact 관계 (relate 단계) — Phase 1a에서는 최소한 유지
└── projects/{project_key}/
    └── memory/
        ├── hot-context.json    # ← Phase 0에서 추가
        └── memory-metrics.jsonl  # ← Phase 1a에서 추가 (메모리 메트릭 로그)
```

### 3.2 하네스 폐루프 보존

Observer → Enforcer → Improver → Canary → Orchestrator 파이프라인은 변경하지 않는다. 마이그레이션은 이 파이프라인 **내부의 데이터 풍부도를 높이는 방향**으로만 진행한다.

보존할 핵심 경로:
- `signalToRule()` 결정적 로직
- SOFT → HARD 자동 승격 (`violation_count ≥ 2`)
- `scope: 'prompt'` 규칙의 승격 제외
- 30일 효과 측정 (`evaluateRuleEffectiveness()`)
- `consolidateFacts()` / `relateFacts()`
- 3계층 점진적 공개 (L1/L2/L3)
- Fact TTL + 접근 추적

### 3.3 점진적 도입, 기본값은 끈다

`roadmap.md`의 Common Principles를 그대로 적용:

1. 새 기능은 default-off
2. 먼저 그림자 모드로 기록만
3. 가드 통과 후 본 경로 반영
4. 파일이 진실, 이력은 증거

### 3.4 v3.2 ADR 중 수용/보류/기각

| v3.2 ADR | 판정 | 근거 |
|----------|------|------|
| #1 hot_context (fact store 내부 캐시) | **수용** — 파일 기반으로 변형 | cold-start 해결 가치 명확 |
| #2 fact store + wiki 이중 표현 | **보류** | fact 수 부족. wiki 없이 hot_context로 충분 |
| #3 lint-driven selective recompile | **보류** | wiki 없이 의미 없음 |
| #4 규칙을 fact(type=constraint)로 통합 | **기각** | 현재 규칙 시스템(`rules/soft/`, `rules/hard/`)이 이미 안정적으로 동작. 통합은 위험 > 이익 |
| #5 충돌 처리 (hot_context 우선 노출) | **수용** | compacting 시 contradiction flag 반영 |
| #6 임베딩 모델 (all-MiniLM-L6-v2) | **Phase 3 보류** | 외부 의존성 |
| #7 promotion control (extraction 내장) | **부분 수용** | LLM 없이 메타데이터 기반으로 구현 |
| #8 안전 퓨즈 4개 | **수용** — 기존 승격 로직에 추가 | `is_experimental` 감지 + scope 검증 강화 |
| #9 Agent-driven recall + Boundary Hint | **수용** — compacting 훅에 녹임 | 독립 모듈 대신 기존 파이프라인 확장 |
| #10 hot_context 세션 중 갱신 | **Phase 2 보류** | MCP 도구 경로 불확실. Phase 1a는 세션 종료 시 자동 갱신만 |
| #11 Boundary Hint 트리거 (이벤트 기반) | **수용** — compacting 시 relevance check로 대체 | 별도 이벤트 감지 불필요 |

### 3.5 메모리 메트릭 기반 의사결정

Phase 전환을 직관이 아닌 **객관적 메트릭**으로 판단한다. Phase 1a부터 `memory-metrics.jsonl`에 메트릭을 기록하고, Gate A는 이 데이터로 측정한다.

**전환기 임시 메트릭 (Phase 1a에서만 수집, 1b 이후 제거 가능):**
- `facts_scanned_per_compaction` — compaction당 스캔한 fact 수 (JSON 선형 스캔 비용 측정)
- `relations_scanned_per_lookup` — 관계 조회당 스캔 수 (relations.jsonl 한계 측정)
- `json_fact_load_ms` — JSON에서 fact 일괄 로드 시간 (SQLite 도입 필요성의 근거)

**지속적 운영 메트릭 (Phase 1a 이후 계속 유지):**
- `active_fact_count` — 현재 활성 fact 수
- `total_fact_count` — 전체 fact 수 (archive 포함)
- `relation_count` — 관계 수
- `revision_count` — fact 수정 이력 수
- `hot_context_build_ms` — hot context 빌드 시간
- `compacting_build_ms` — compacting 빌드 시간
- `contradiction_count` — 감지된 충돌 수 (선택적)

메트릭은 `memory-metrics.jsonl`에 JSON Lines 형식으로 append-only 기록한다:
```jsonl
{"ts":"2026-04-21T10:30:00Z","phase":"1a","active_fact_count":42,"total_fact_count":58,"relation_count":12,"revision_count":3,"hot_context_build_ms":15,"compacting_build_ms":230,"facts_scanned_per_compaction":58,"relations_scanned_per_lookup":12,"contradiction_count":1}
```

---

## 4. 교체 vs 유지 매트릭스

### 교체 (Replace)

| 현재 | → | v3.2 흡수 결과 | 파일 힌트 |
|------|---|---------------|----------|
| Fact JSON (id, content, keywords, score, access_count, last_accessed_at) | → | Fact JSON + `origin_type`, `confidence`, `status`, `scope`, `evidence_count`, `source_session`, `must_verify` | `src/types.ts` (`Fact` 인터페이스 확장) |
| TTL-only fact 정리 | → | TTL + confidence 기반 정리. `status: 'deprecated'` / `'superseded'` 추가 | `src/harness/improver.ts` (`cleanupExpiredFacts` 확장) |
| 3계층 점진적 공개 (score 기반) | → | score + confidence + fact_type 가중치 혼합 | `src/harness/improver.ts` (`rankFactsForCompacting` 확장) |
| 세션 시작 시 hot context 없음 | → | `hot-context.json` 자동 주입 | `src/harness/improver.ts` (compacting 훅에서 읽기) |

### 유지 (Keep)

| 현재 | 유지 이유 |
|------|----------|
| `rules/soft/{id}.json` + `rules/hard/{id}.json` | v3.2의 `facts(type=constraint)` 통합은 기존 규칙 시스템을 깨는 위험이 큼 |
| `signalToRule()` 결정적 로직 | LLM 없이도 충분히 동작. canary로 보완 중 |
| `history.jsonl` 이벤트 로그 | Archive Layer 역할 이미 수행 |
| `memory/archive/` 세션 JSONL | v3.2 Archive Layer와 동일 |
| `memory/index/` 키워드 인덱스 | 파일 기반 검색으로 충분 |
| `memory/relations.jsonl` | Phase 1a에서는 최소한 유지. Phase 1b에서 SQLite로 이관 검토 |
| Observer 낭비 탐지기 3종 | Token Optimization에서 이미 안정화 |
| Canary evaluation | 5f에서 이미 메타데이터 기반으로 구현 |

---

## 5. 단계별 로드맵

### Phase 0: 기반 작업 (Foundation)

**목표:** v3.2 흡수를 위한 타입 및 설정 기반 마련. 동작 변경 없음.

**예상 기간:** 0.5일

| 작업 | 파일 | 내용 |
|------|------|------|
| 0-1 | `src/types.ts` | `Fact` 인터페이스에 선택적 필드 추가: `origin_type?`, `confidence?`, `status?`, `scope?`, `evidence_count?`, `source_session?`, `must_verify?`, `is_experimental?`, `severity?`, `agent_role?` |
| 0-2 | `src/config/schema.ts` | `HarnessSettings`에 Phase 1a 설정 추가: `hot_context_enabled` (default: false), `rich_fact_metadata_enabled` (default: false), `confidence_threshold_active` (default: 0.7), `boundary_hint_enabled` (default: false) |
| 0-3 | 테스트 | 기존 테스트 전부 통과 확인 (580/580). 새 필드가 선택적이므로 기존 동작 영향 없음 |
| 0-4 | `src/harness/improver.ts` | `hot-context.json` 읽기/쓰기 헬퍼 추가 (아직 호출 없음) |

**검증:**
- [x] 기존 580개 테스트 전부 통과
- [x] `Fact`에 새 필드 추가 후에도 기존 fact 파일이 정상 로드됨 (하위 호환)
- [x] 새 설정이 default-off 상태에서 기존 동작과 완전히 동일

---

### Phase 1a: 파일 기반 의미론 업그레이드 ✅ 완료

**목표:** v3.2의 패턴을 파일 기반으로 흡수. SQLite 없이, LLM 없이. relations/revision은 최소한으로 유지하고 순수 JSON에서 과도하게 구축하지 않는다.

**예상 기간:** 2~3일

| 작업 | 파일 | 내용 |
|------|------|------|
| **1a-1** | `src/harness/improver.ts` | **Promotion Control (메타데이터 기반).** fact 추출/생성 시 `origin_type`, `confidence`, `status` 자동 분류. LLM 없이 메타데이터 프록시 사용: <br>• `user_explicit` → 사용자 메시지에서 지시문 패턴 매칭 (confidence 0.9) <br>• `execution_observed` → tool 실행 결과에서 확인 (confidence 0.85) <br>• `tool_result` → 검색/읽기 결과에서 추출 (confidence 0.8) <br>• `inferred` → 기본값, consolidate/relate에서 파생 (confidence 0.5) <br>• `confidence ≥ 0.7` → `status: 'active'`, `< 0.7` → `status: 'unreviewed'` |
| **1a-2** | `src/harness/improver.ts` | **Hot Context 자동 생성.** 세션 종료(`session.idle`) 시: <br>• 현재 활성 task 관련 fact를 우선순위로 선별 (5~10개) <br>• 최근 변경 fact, 미해결 contradiction, 활성 constraint 포함 <br>• `~500 토큰` 이하로 압축 <br>• `memory/hot-context.json`에 저장 |
| **1a-3** | `src/harness/improver.ts` | **Hot Context 세션 시작 주입.** `experimental.session.compacting` 훅에서: <br>• `hot-context.json` 존재 시 scaffold 앞에 주입 <br>• 기존 scaffold + HARD 규칙 + SOFT 규칙 + hot_context 순서 |
| **1a-4** | `src/harness/improver.ts` | **3계층 공개 가중치 확장.** 기존 score 기반에 v3.2 패턴 반영: <br>• `fact_type` 가중치: `decision` > `constraint` > `pattern` > `preference` <br>• `confidence` 가중치: 높을수록 우선 <br>• `status` 필터: `unreviewed` + `confidence < 0.5` → L1 강제 (힌트만) |
| **1a-5** | `src/harness/improver.ts` | **Boundary Hint (compacting 통합).** compacting 시: <br>• L1/L2 fact에 "관련 기억 있음" 힌트 포함 <br>• decision/constraint fact는 높은 우선순위로 힌트 표시 <br>• preference/low-confidence는 과도한 힌트 방지 |
| **1a-6** | `src/harness/improver.ts` | **Contradiction-first Surfacing.** `consolidateFacts()`에서 충돌 감지 시: <br>• 충돌 fact에 `must_verify: true` 자동 부여 <br>• hot_context 생성 시 `must_verify` fact를 별도 섹션에 배치 |
| **1a-7** | `src/harness/improver.ts` | **안전 퓨즈 확장.** 기존 SOFT→HARD 승격 로직에 추가: <br>• `is_experimental: true` fact는 승격 차단 <br>• scope 불일치 시 승격 차단 (project A 위반을 project B에서 승격 금지) <br>• 이미 `signalToRule()`에 scope 검증이 있으나, fact 레벨에서도 방어 |
| **1a-8** | `src/harness/improver.ts` | **TTL + Confidence 혼합 정리.** 기존 TTL 정리에 confidence/status 반영: <br>• `status: 'superseded'` fact는 TTL과 무관하게 archive 이동 <br>• `status: 'deprecated'` fact는 즉시 archive 이동 <br>• 기존 TTL 로직은 `status: 'active'`/`'unreviewed'`에만 적용 |
| **1a-9** | `src/types.ts` | **Fact 인터페이스 확정.** Phase 0에서 추가한 선택적 필드를 실제 사용에 맞게 타입 정제 |
| **1a-10** | `src/harness/improver.ts` | **메모리 메트릭 수집 (memory-metrics.jsonl).** compacting 세션 종료 시 메트릭을 append: `active_fact_count`, `total_fact_count`, `relation_count`, `revision_count`, `hot_context_build_ms`, `compacting_build_ms`, `facts_scanned_per_compaction`, `relations_scanned_per_lookup`, `contradiction_count` |
| **1a-11** | 테스트 | Phase 1a smoke 테스트 신규 작성 |

**relations/revision 제약 (Phase 1a):**
- `relations.jsonl`은 기존 `relateFacts()`에서 생성하는 단순 관계만 유지
- 새로운 관계 유형이나 복잡한 revision 체인은 Phase 1a에서 추가하지 않음
- 관계 쿼리 성능이 저하되면 Gate A에서 SQLite 도입으로 해결
- revision 이력은 fact의 `updated_at` 타임스탬프 수준에서만 추적

**검증:**
- [x] 세션 시작 시 hot_context가 주입되어 이전 결정을 도구 호출 0회로 인지
- [x] `origin_type`별 confidence가 적절히 분류됨
- [x] `must_verify` 충돌 fact가 hot_context에 별도 섹션으로 표시됨
- [x] `is_experimental: true` fact가 승격 차단됨
- [x] 기존 580개 테스트 + Phase 1a 신규 테스트 전부 통과
- [x] `hot_context_enabled=false` 시 기존 동작과 완전히 동일
- [x] `memory-metrics.jsonl`에 메트릭이 정상적으로 기록됨

---

### Gate A: Phase 1a → Phase 1b 전환 게이트

**목표:** 메모리 메트릭 데이터로 Phase 1b (최소 SQLite) 도입 필요성을 객관적으로 판단.

**Gate A 통과 조건 (다음 중 2개 이상 충족):**

| 조건 | 측정 방법 | 임계값 |
|------|----------|--------|
| fact 선형 스캔 비용 증가 | `memory-metrics.jsonl`에서 `facts_scanned_per_compaction` 추이 | 최근 5회 compaction 평균 > 80 |
| relations 조회 비용 증가 | `memory-metrics.jsonl`에서 `relations_scanned_per_lookup` 추이 | 최근 5회 평균 > 30 |
| hot context 빌드 지연 | `memory-metrics.jsonl`에서 `hot_context_build_ms` 추이 | 최근 5회 평균 > 500ms |
| compacting 빌드 지연 | `memory-metrics.jsonl`에서 `compacting_build_ms` 추이 | 최근 5회 평균 > 2000ms |
| fact 볼륨 증가 | `memory-metrics.jsonl`에서 `total_fact_count` 추이 | > 100개 |
| 직접 확인 한계 사례 | 로그/문서 | 키워드 검색 누락 사례 3건 이상 문서화 |

**Gate A 미충족 시:** Phase 1a 파일 기반으로 계속 운영. SQLite 도입 불필요. 메트릭 모니터링 계속.

**Gate A 운영 가이드:**
- 메트릭은 매 compaction 종료 시 자동 기록
- Gate A 평가는 주 1회 이상 `memory-metrics.jsonl` 리뷰로 수행
- 임계값은 초기 운영 데이터로 튜닝 가능. 단, 하향 조정은 신중하게 (조기 SQLite 도입 방지)

---

### Phase 1b: 최소 SQLite 도입 (선택적)

**목표:** Gate A에서 확인된 파일 기반 한계를 최소 SQLite로 해결. JSON 파일은 여전히 진실의 원천.

**예상 기간:** 1~2일 (선택적, Gate A 통과 시에만 착수)

| 작업 | 파일 | 내용 |
|------|------|------|
| **1b-1** | `src/shared/kv-store.ts` (신규) | SQLite 기반 경량 KV 스토어. `better-sqlite3` 또는 `bun:sqlite` 사용. JSON 파일과 병행 운영 (shadow 모드) |
| **1b-2** | `src/harness/improver.ts` | fact 쓰기 시 SQLite에 병행 저장. 기존 JSON 파일은 그대로 유지 |
| **1b-3** | `src/harness/improver.ts` | `relations.jsonl` 데이터를 SQLite로 이관. 기존 JSONL은 백업 보존 |
| **1b-4** | `src/config/schema.ts` | `sqlite_enabled` 설정 추가 (default: false) |
| **1b-5** | `src/harness/improver.ts` | **메트릭 정리.** 전환기 임시 메트릭(`facts_scanned_per_compaction`, `relations_scanned_per_lookup`, `json_fact_load_ms`)은 측정 대상이 SQLite로 이관되었으므로 수집 중단. 지속적 운영 메트릭은 계속 유지 |
| **1b-6** | 테스트 | Phase 1b smoke 테스트 |

**검증:**
- [ ] SQLite와 JSON 파일 간 데이터 일관성
- [ ] 기존 JSON 파일 경로가 완전히 보존됨 (파일 = 진실)
- [ ] `sqlite_enabled=false` 시 기존 파일 기반 동작과 완전히 동일
- [ ] 임시 메트릭 수집이 중단되고 지속적 메트릭은 계속 기록됨

---

### Phase 2: sqlite-vec / 검색 정교화 (선택적)

**목표:** Phase 1b의 SQLite 위에 고급 검색 기능을 구축. FTS5 + 의미 검색으로 recall 품질 향상.

**예상 기간:** 2~3일 (선택적, 활성 조건 충족 시에만 착수)

**활성 조건 (Rollout Gate):**
- Phase 1b가 최소 2주간 안정 운영됨
- 키워드 기반 검색으로 누락 사례가 반복됨 (3건 이상 문서화)
- `memory-metrics.jsonl`에서 검색 관련 지표의 개선 필요성이 확인됨

| 작업 | 파일 | 내용 |
|------|------|------|
| 2-1 | `src/harness/improver.ts` | `search_facts` 로직 개선: 키워드 인덱스 + SQLite FTS5 하이브리드 |
| 2-2 | `src/harness/improver.ts` | `update_hot_context` 세션 중 갱신 (MCP 도구 경로 또는 파일 감시 패턴) |
| 2-3 | `src/shared/sqlite-vec.ts` (신규, 선택적) | sqlite-vec 확장으로 벡터 유사도 검색 (임베딩은 Phase 3에서 도입, Phase 2에서는 키워드 벡터로 실험 가능) |
| 2-4 | 테스트 | Phase 2 smoke 테스트 |

**검증:**
- [ ] FTS5 하이브리드 검색이 기존 키워드 검색 대비 recall 개선
- [ ] 기존 JSON 파일 경로가 완전히 보존됨 (파일 = 진실)
- [ ] `sqlite_enabled=false` 시 기존 파일 기반 동작과 완전히 동일

---

### Phase 3: LLM 추출 + 임베딩 (선택적)

**목표:** LLM 기반 fact 추출과 의미 검색을 도입. Phase 2의 검색 인프라 위에 구축.

**예상 기간:** 3~4일 (선택적, 활성 조건 충족 시에만 착수)

**활성 조건 (Rollout Gate):**
- Phase 2가 최소 4주간 안정 운영됨
- 메타데이터 기반 fact 분류의 한계가 데이터로 확인됨
- LLM 호출 경로(서브에이전트 위임 또는 외부 API)가 안정화됨
- 임베딩 모델의 로컬 실행이 타겟 환경에서 검증됨

| 작업 | 파일 | 내용 |
|------|------|------|
| 3-1 | `src/harness/improver.ts` | LLM 기반 fact 추출 (서브에이전트 위임 패턴 — `docs/roadmap.md` 5f 대안 D 참조) |
| 3-2 | `src/shared/embeddings.ts` (신규) | 로컬 임베딩 생성. `all-MiniLM-L6-v2` (ONNX Runtime) 또는 경량 대안 |
| 3-3 | `src/harness/improver.ts` | 의미 기반 검색 (벡터 유사도 + 키워드 하이브리드) |
| 3-4 | `src/harness/improver.ts` | LLM 기반 fact 품질 평가 (origin_type 자동 분류 정확도 향상) |
| 3-5 | 테스트 | Phase 3 smoke 테스트 |

**검증:**
- [ ] LLM 추출 fact와 메타데이터 추출 fact의 품질 비교 데이터 축적
- [ ] 임베딩 기반 검색이 키워드 기반 대비 누락률 개선
- [ ] `llm_extraction_enabled=false` 시 기존 동작과 완전히 동일

---

## 6. Phase별 검증 체크리스트

### Phase 0 검증

| 항목 | 방법 |
|------|------|
| 기존 테스트 회귀 | `npx vitest run` + smoke 테스트 전체 실행 |
| 하위 호환 | 기존 fact JSON (새 필드 없음)이 정상 로드되는지 확인 |
| 설정 독립성 | 새 설정이 없는 기존 `.opencode/harness.jsonc`에서 동작 동일한지 확인 |

### Phase 1a 검증

| 항목 | 방법 |
|------|------|
| Hot context 주입 | 세션 시작 후 첫 compacting에서 hot_context가 scaffold 앞에 나타나는지 확인 |
| Promotion control | fact 생성 시 confidence/status가 의도대로 분류되는지 smoke 테스트 |
| 안전 퓨즈 | `is_experimental: true` fact가 HARD 승격되지 않는지 테스트 |
| Contradiction 표면화 | 충돌 fact가 hot_context에 `must_verify` 섹션으로 나타나는지 확인 |
| 기본값 안전 | 모든 Phase 1a 토글이 off일 때 기존 동작과 완전 동일한지 확인 |
| 토큰 효율 | hot_context 주입 후 첫 턴 도구 호출 수가 이전 대비 감소하는지 측정 |
| 메트릭 수집 | `memory-metrics.jsonl`에 메트릭이 정상적으로 append되는지 확인 |
| relations 최소성 | `relations.jsonl`이 과도하게 증가하지 않는지 확인 |

### Phase 1b 검증

| 항목 | 방법 |
|------|------|
| 데이터 일관성 | SQLite와 JSON 파일의 fact 수/내용이 일치하는지 자동 테스트 |
| 롤백 | `sqlite_enabled=false` 시 SQLite 없이도 모든 기능이 동작하는지 확인 |
| 메트릭 정리 | 임시 메트릭 수집이 중단되고 지속적 메트릭만 기록되는지 확인 |

### Phase 2 검증

| 항목 | 방법 |
|------|------|
| 검색 품질 | 기존 키워드 검색 vs FTS5 하이브리드의 recall@10 비교 |
| 롤백 | `sqlite_enabled=false` 시 SQLite 없이도 모든 기능이 동작하는지 확인 |
| 메트릭 활용 | `memory-metrics.jsonl` 데이터로 검색 개선 효과가 측정 가능한지 확인 |

### Phase 3 검증

| 항목 | 방법 |
|------|------|
| LLM 추출 품질 | 메타데이터 추출 vs LLM 추출의 fact 정확도 비교 (shadow 로그) |
| 임베딩 검색 | 키워드 전용 vs 하이브리드 검색의 누락률 비교 |
| 비용 추적 | LLM 호출당 토큰 소모와 fact 품질의 ROI 측정 |

---

## 7. 롤아웃 게이트 (Rollout Gates)

### Phase 0 → Phase 1a 진입 조건

- [x] Phase 0 기반 작업 완료
- [x] 기존 580개 테스트 전부 통과
- [x] Phase 0 코드 리뷰 완료

### Phase 1a → Phase 1b 진입 조건 (Gate A) — 모니터링 진행 중

- [ ] Gate A 메트릭 조건 2개 이상 충족 (`memory-metrics.jsonl` 데이터 기반)
- [ ] Phase 1a가 최소 2주간 안정 운영됨
- [ ] Phase 1a 토글이 프로덕션에서 활성화된 상태로 안정 동작
- [ ] 파일 기반 한계가 메트릭으로 객관적으로 확인됨

### Phase 1b → Phase 2 진입 조건

- [ ] Phase 1b가 최소 2주간 안정 운영됨
- [ ] 키워드 기반 검색의 한계 사례가 3건 이상 문서화됨
- [ ] `memory-metrics.jsonl`에서 검색 품질 지표의 개선 필요성이 확인됨

### Phase 2 → Phase 3 진입 조건

- [ ] Phase 2가 최소 4주간 안정 운영됨
- [ ] 메타데이터 기반 fact 분류의 한계 사례가 5건 이상 문서화됨
- [ ] LLM 호출 경로(서브에이전트 위임 또는 외부 API)의 안정성이 확보됨
- [ ] 임베딩 모델의 로컬 실행이 타겟 환경에서 검증됨

---

## 8. 리스크

| 리스크 | 영향 | 완화 |
|--------|------|------|
| Fact 인터페이스 확장으로 기존 fact 파일 호환성 깨짐 | HIGH | 모든 새 필드를 선택적(`?`)으로 정의. 기본값 명시 |
| Hot context 주입으로 compacting 토큰 예산 초과 | MEDIUM | hot_context를 `~500 토큰`으로 제한. 기존 3계층 공개와 통합 관리 |
| Promotion control 메타데이터 프록시가 실제 품질과 불일치 | MEDIUM | Phase 1a는 default-off + shadow 로깅. 데이터 축적 후 임계값 튜닝 |
| `is_experimental` 감지가 거짓 음성(실험인데 감지 못함) | LOW | 키워드 매칭 + compacting 시 사용자 발화 패턴으로 보완. 100% 완벽 불필요 |
| Phase 1a에서 relations를 과도하게 구축하려는 유혹 | MEDIUM | Phase 1a 제약 명시: relations는 최소한. 쿼리 병목은 Phase 1b SQLite로 해결 |
| Phase 1b SQLite가 파일 = 진실 원칙을 약화 | MEDIUM | JSON 파일을 계속 source of truth로 유지. SQLite는 인덱스/캐시 역할만 |
| Gate A 임계값이 너무 낮아 조기 SQLite 도입 | LOW | 초기 임계값은 보수적으로 설정. 주간 메트릭 리뷰로 튜닝 |
| `memory-metrics.jsonl` 파일 과도 성장 | LOW | 30일 초과 데이터는 자동 rotate. 파일 크기 상한 설정 |
| Phase 3 임베딩 모델이 타겟 환경에서 실행 불가 | HIGH | ONNX Runtime 경량 대안 검토. 불가 시 Phase 3 무기한 연기 가능 |

---

## 9. 권장 실행 순서

```
Phase 0 (0.5일)
  └── 타입 확장 + 설정 추가 + 테스트 회귀 확인
       │
       ▼ 롤아웃 게이트: 기존 테스트 전부 통과 + 코드 리뷰
Phase 1a (2~3일)
  └── 1a-1 Promotion Control (메타데이터 기반)
  └── 1a-2~1a-3 Hot Context (생성 + 주입)
  └── 1a-4 3계층 가중치 확장
  └── 1a-5 Boundary Hint (compacting 통합)
  └── 1a-6 Contradiction Surfacing
  └── 1a-7 안전 퓨즈 확장
  └── 1a-8 TTL + Confidence 혼합 정리
  └── 1a-9 타입 정제
  └── 1a-10 메모리 메트릭 수집 (memory-metrics.jsonl)
  └── 1a-11 테스트
       │
       ▼ Gate A: memory-metrics.jsonl 데이터로 객관 측정
       │   (조건 2개 이상 충족 시 Phase 1b 착수, 미충족 시 1a 계속 운영)
Phase 1b (1~2일, 선택적)
  └── 1b-1 최소 SQLite KV 스토어
  └── 1b-2 fact 병행 쓰기 (JSON + SQLite)
  └── 1b-3 relations JSONL → SQLite 이관
  └── 1b-4 sqlite_enabled 설정 추가
  └── 1b-5 임시 메트릭 정리 (지속적 메트릭은 유지)
  └── 1b-6 테스트
       │
       ▼ 롤아웃 게이트: 2주 안정 운영 + 검색 한계 문서화
Phase 2 (2~3일, 선택적)
  └── FTS5 하이브리드 검색
  └── Hot context 세션 중 갱신
  └── sqlite-vec 실험 (선택적)
       │
       ▼ 롤아웃 게이트: 4주 안정 운영 + 메타데이터 한계 문서화 + LLM 경로 안정화
Phase 3 (3~4일, 선택적)
  └── LLM 추출 + 임베딩
```

**실행 원칙:**

1. Phase 0은 반드시 먼저. 타입 기반이어야 Phase 1a를 안전하게 진행.
2. Phase 1a 내 작업 순서는 1a-1 → 1a-2~1a-3 → 1a-4~1a-5 → 1a-6~1a-8 → 1a-9~1a-11 권장.
   - Promotion Control이 나머지의 전제조건.
   - Hot Context는 Phase 1a의 핵심 가치.
   - 메트릭 수집(1a-10)은 초기 작업과 병렬 가능.
   - 나머지는 독립적이므로 병렬 진행 가능.
3. Gate A는 직관이 아닌 `memory-metrics.jsonl` 데이터로 판단. 주간 메트릭 리뷰 필수.
4. Phase 1b는 Gate A 통과 시에만 착수. 통과하지 않으면 Phase 1a로 계속 운영.
5. Phase 2~3은 이전 Phase의 데이터로 필요성이 확인되면 착수. 영구 보류도 가능.

---

## 10. 파일 변경 예상 범위

### Phase 0~1a (확정)

| 파일 | 변경 유형 | 내용 |
|------|----------|------|
| `src/types.ts` | 수정 | `Fact` 인터페이스 확장 (선택적 필드 10개), `HotContext` 인터페이스 추가 |
| `src/config/schema.ts` | 수정 | Phase 1a 설정 4개 추가 |
| `src/harness/improver.ts` | 수정 | 핵심 변경 대상. promotion control, hot context, boundary hint, contradiction, 안전 퓨즈, TTL+confidence, 메트릭 수집 |
| `src/harness/observer.ts` | 최소 수정 | fact 생성 시 `origin_type` 프록시 분류 로직 추가 (선택적) |
| `src/__tests__/smoke-phase1a-*.ts` | 신규 | Phase 1a smoke 테스트 |

### Phase 1b (선택적)

| 파일 | 변경 유형 | 내용 |
|------|----------|------|
| `src/shared/kv-store.ts` | 신규 | SQLite 래퍼 |
| `src/harness/improver.ts` | 수정 | SQLite 병행 쓰기, relations 이관, 임시 메트릭 정리 |
| `src/config/schema.ts` | 수정 | `sqlite_enabled` 설정 추가 |
| `src/__tests__/smoke-phase1b-*.ts` | 신규 | Phase 1b smoke 테스트 |

### Phase 2 (선택적)

| 파일 | 변경 유형 | 내용 |
|------|----------|------|
| `src/harness/improver.ts` | 수정 | FTS5 하이브리드 검색, hot context 세션 중 갱신 |
| `src/shared/sqlite-vec.ts` | 신규 (선택적) | sqlite-vec 벡터 검색 |
| `src/__tests__/smoke-phase2-*.ts` | 신규 | Phase 2 smoke 테스트 |

### Phase 3 (선택적)

| 파일 | 변경 유형 | 내용 |
|------|----------|------|
| `src/shared/embeddings.ts` | 신규 | 임베딩 생성 |
| `src/harness/improver.ts` | 수정 | LLM 추출, 의미 검색 |
| `src/__tests__/smoke-phase3-*.ts` | 신규 | Phase 3 smoke 테스트 |

### 수정하지 않을 파일

- `src/harness/enforcer.ts` — 규칙 차단 로직 변경 없음
- `src/harness/canary.ts` — canary 평가 로직 변경 없음
- `src/orchestrator/orchestrator.ts` — 라우팅 로직 변경 없음
- `src/orchestrator/qa-tracker.ts` — QA 추적 로직 변경 없음
- `src/shared/utils.ts` — 공통 유틸리티 변경 없음
- `src/shared/constants.ts` — 상수 변경 없음
- `src/hooks/*` — 7개 훅 변경 없음
- `src/agents/*` — 에이전트 정의 변경 없음
- `src/config/loader.ts` — 설정 로더 변경 없음

---

## 부록 A: v3.2 핵심 개념과 현재 시스템의 대응표

| v3.2 개념 | 현재 구현 | Phase | 매핑 |
|-----------|----------|-------|------|
| Archive Layer | `memory/archive/` + `history.jsonl` | — | 동일 |
| Fact Store (SQLite) | `memory/facts/{id}.json` | — | 파일 기반 유지 (Phase 1b에서 SQLite 병행) |
| Hot Context | 없음 | Phase 1a | `memory/hot-context.json` |
| Promotion Control | 없음 (모든 fact 동등) | Phase 1a | 메타데이터 프록시 분류 |
| Boundary Hint | 3계층 점진적 공개 (L1/L2/L3) | Phase 1a | 기존 L1에 힌트 추가 |
| Recall Budget | 없음 | Phase 1a+ | compacting 시 주입량 제한으로 간접 구현 |
| Contradiction Surfacing | `consolidateFacts`에서 Jaccard 유사도로 중복 감지 | Phase 1a | 충돌 감지 + `must_verify` 추가 |
| Safety Fuse | SOFT→HARD 승격 (`violation_count ≥ 2`) | Phase 1a | `is_experimental` + scope 방어 추가 |
| Memory Metrics | 없음 | Phase 1a | `memory-metrics.jsonl` (Gate A 측정 기반) |
| Minimal SQLite | 없음 | Phase 1b | `src/shared/kv-store.ts` (Gate A 통과 시) |
| Wiki Layer | 없음 | 보류 | fact 수 부족 |
| Mid-session Update | 없음 | Phase 2 | MCP 또는 파일 감시 패턴 |
| LLM Extraction | 없음 | Phase 3 | 서브에이전트 위임 패턴 |
| Embeddings | 없음 | Phase 3 | ONNX Runtime 로컬 실행 |

---

## 부록 B: memory-metrics.jsonl 명세

**파일 위치:** `~/.config/opencode/harness/projects/{project_key}/memory/memory-metrics.jsonl`

**형식:** JSON Lines (append-only)

**레코드 스키마:**

| 필드 | 타입 | 설명 | 지속성 |
|------|------|------|--------|
| `ts` | string (ISO 8601) | 기록 시각 | — |
| `phase` | string | 현재 Phase (`"1a"`, `"1b"`, `"2"`, `"3"`) | — |
| `active_fact_count` | number | 활성 fact 수 | 지속적 |
| `total_fact_count` | number | 전체 fact 수 (archive 포함) | 지속적 |
| `relation_count` | number | 관계 수 | 지속적 |
| `revision_count` | number | fact 수정 이력 수 | 지속적 |
| `hot_context_build_ms` | number | hot context 빌드 시간 (ms) | 지속적 |
| `compacting_build_ms` | number | compacting 빌드 시간 (ms) | 지속적 |
| `contradiction_count` | number | 감지된 충돌 수 | 지속적 (선택적) |
| `facts_scanned_per_compaction` | number | compaction당 스캔 fact 수 | **임시** (Phase 1a만) |
| `relations_scanned_per_lookup` | number | 관계 조회당 스캔 수 | **임시** (Phase 1a만) |
| `json_fact_load_ms` | number | JSON fact 로드 시간 (ms) | **임시** (Phase 1a만) |

**수명 주기:**
- Phase 1a: 전체 메트릭 수집 (임시 + 지속적)
- Phase 1b: 임시 메트릭 수집 중단, 지속적 메트릭만 유지
- Phase 2+: 지속적 메트릭만 기록. Phase별 추가 메트릭은 필요 시 정의

**관리 규칙:**
- 30일 초과 데이터는 자동 rotate (설정 가능)
- 파일 크기 상한: 1MB (초과 시 oldest-first 삭제)
- Gate A 평가 시 최근 5개 레코드의 이동 평균 사용
