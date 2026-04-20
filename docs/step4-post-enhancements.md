# Step 4 이후 고도화 전략

이 문서는 `AGENTS.md`에 적힌 Step 4 이후 고도화 항목 8개를 자세히 정리한 문서다.  
목적은 단순하다. **지금 당장 본 경로를 바꾸지 말고, 먼저 데이터와 그림자 비교를 쌓자.**

Step 5a는 foundation, Step 5b는 reduced-safe shadow slice, Step 5c는 rule lifecycle 후보 경로, Step 5d는 release ops (auto-update-checker), Step 5e는 mistake pattern candidate grouping, Step 5f는 metadata-based phase/signal canary evaluation까지 완료. phase/signal 그림자 로그, diff 실수 요약 그림자 로그, ack written/accepted 로그, prune candidate 로그, cross-project candidate 로그, canary mismatch 로그와 default-off/guarded-off 경로를 구현했고 smoke/build로 확인했다.
4~7번은 여기서 바로 본 경로로 가지 않고, 아래 승격 기준을 만족할 때만 shadow → guarded → default-on/mainline 순서로 검토한다.

## 공통 원칙

### 1) 기본값은 끈다

새 기능은 기본 비활성(`default-off`)으로 둔다. 설정이 없으면 기존 결정적 경로가 그대로 동작해야 한다.

### 2) 먼저 그림자 모드

새 판정 로직은 먼저 **기록만** 한다.

- 기존 결과는 유지
- 후보 결과만 별도 저장
- 오답, 비용, 토큰 사용량 비교

### 3) 가드 통과 후 반영

삭제, 승격, ack 변경처럼 되돌리기 어려운 동작은 바로 쓰지 않는다.

- 샘플 수
- 일치율
- 오탐률
- 롤백 가능성

이 조건이 충분해야만 본 경로로 들어간다.

### 4) 파일이 진실, 이력은 증거

이 프로젝트는 파일 시스템 기반이다. 그래서 새 기능도 다음 원칙을 따른다.

- 현재 상태: 얇은 JSON/JSONL
- 판단 근거: append-only 로그
- 실험 결과: overwrite보다 append 우선

## 한눈에 보는 상태

| 항목                            | 현재 상태                          | 권장 모드          |
| ------------------------------- | ---------------------------------- | ------------------ |
| 1. 크로스세션 기억 상위 4단계   | Extract shadow만 존재, 나머지는 미구현 | shadow             |
| 2. 규칙 자동 삭제 (Pruning)     | candidate-first pruning + append-only candidate log | guarded-off        |
| 3. 의미 기반 compacting 필터    | 필터 없음                          | default-off shadow |
| 4. LLM 기반 Phase / signal 판정 | 결정적 baseline + phase/signal 그림자 로그 + metadata-based canary evaluation (Step 5f) | shadow + canary |
| 5. diff 기반 실수 패턴 학습     | fix 흐름 + mistake_summary 그림자 로그 + candidate grouping (Step 5e) | guarded-shadow     |
| 6. Ack 조건 강화                | written/accepted ack 로그 + default-off guard | guarded            |
| 7. Cross-Project 자동 승격      | exact-match candidate aggregation + 수동 `global` 가능 | guarded-off        |
| 8. auto-update-checker          | 완료 — warn-only 세션 시작 체크 + 전역 24h 쿨다운 상태 파일 | default-off        |

> Step 5a foundation은 구현/검증 완료. Step 5f canary는 default-off로 구현/검증 완료. 다만 4~6번은 모두 그림자/guarded 상태이며 본 경로 롤아웃은 아직 아니다.

## 권장 순서

1. **5 → 4**: 신호 품질과 판정 품질부터 개선
2. **6 → 3**: ack와 compacting으로 품질 방어선 정리
3. **2 → 1**: 데이터가 쌓인 뒤 pruning과 상위 memory 단계 승격
4. **7**: 다중 프로젝트 데이터가 있을 때만 검토
5. **8**: npm 배포 후 운영 보조로 추가

---

## 1. 크로스세션 기억 상위 4단계

### 현재 상태

`Sync / Index / Search`가 본 경로다. reduced-safe 5b로 `Extract` 후보 shadow 로그만 추가되었고, `Consolidate / Relate / Recall`은 아직 없다.

### 의도

상위 4단계는 단순 저장소를 지식층으로 올리는 역할이다.

- **Extract**: 세션에서 결정, 선호, 제약을 더 정교하게 뽑기
- **Consolidate**: 중복/충돌/진화 정리
- **Relate**: fact 사이 관계 연결
- **Recall**: 필요한 순간에 맞는 회수 경로 제공

### 논리

하위 3단계는 "기록과 재사용"이다. 상위 4단계는 그 위에 "해석과 연결"을 얹는다.  
데이터가 적을 때 이걸 먼저 만들면 빈 그래프만 예쁘게 꾸미는 꼴이 된다.

### 이유

데이터가 쌓일수록 의미가 생긴다. 하네스가 아직 작은 상태에서는 규칙과 phase가 더 중요한 신호다.

### 리스크

- LLM 추출 품질이 낮으면 사실이 아니라 요약 환각만 쌓인다.
- Consolidate가 과하면 예전 결정을 지워버릴 수 있다.
- Recall이 넓으면 compacting이 무거워진다.

### 활성 조건

- `memory/facts/`가 충분히 축적됨
- 같은 선택/제약이 여러 세션에서 반복됨
- Search 결과만으로 맥락 복원이 부족함

### 승격 체크리스트

- shadow 로그만으로도 추출 후보와 실제 맥락이 구분되는 사례가 충분히 쌓였는지 본다.
- 사람 검토로 mismatch 묶음을 확인했을 때, 어떤 부분이 추출 오류인지 재현 가능해야 한다.
- 먼저 opt-in 세션에서 `Extract`만 다루고, `Consolidate / Relate / Recall`은 계속 비활성으로 둔다.
- canary에서 baseline 대비 회수 품질이 떨어지면 즉시 shadow로 되돌릴 수 있어야 한다.
- 실제 본 경로 반영은 pass/fail가 아니라, 반복 검토 후에도 오판이 줄어드는 것이 확인된 뒤에만 한다.

### reduced-safe 5b 메모

- 현재 구현은 현재 프로젝트로 범위가 명확한 session JSONL에 한해 `memory-upper-shadow.jsonl`에 **Extract 후보만** append-only로 기록한다.
- 이 shadow 파일은 Search source of truth가 아니며, baseline facts/search를 대체하지 않는다.
- full 5b 승격은 아래가 준비되기 전까지 금지한다.

#### full 5b 승격 체크리스트

- `memory-upper-shadow.jsonl`에서 Extract mismatch 사례가 여러 세션에 걸쳐 누적돼야 한다.
- Extract shadow와 실제 compacting/검색 맥락 사이의 연결을 사람 리뷰로 설명할 수 있어야 한다.
- `Consolidate / Relate / Recall`은 각각 shadow-only 실험 계획과 롤백 경로가 먼저 있어야 한다.
- baseline Search 품질을 떨어뜨리지 않는다는 비교 근거가 있어야 한다.

### 튜닝 가이드

- Extract만 먼저 shadow로 돌린다.
- Consolidate는 삭제보다 충돌 표시부터 시작한다.
- Relate는 관계 타입을 최소화한다.
- Recall은 top-N 제한이 필요하다.

### 다음 방향

사실 추출은 LLM, 관계 연결은 규칙+LLM 혼합, 회수는 deterministic ranking으로 분리하는 편이 좋다.

### 아직 비활성

- 상위 4단계의 본 경로 판정
- 전체 세션 대상 자동 승격
- 실패 사례를 근거 없이 즉시 덮어쓰기

---

## 2. 규칙 자동 삭제 (Pruning)

### 현재 상태

현재는 규칙 생성, 승격, 효과 측정은 있지만 자동 삭제는 없다.  
Step 5c에서 `prune_candidate`와 `rule-prune-candidates.jsonl`이 추가되었고, 실제 삭제는 여전히 guarded-off다. 즉, **측정과 후보 기록은 자동, 삭제는 수동**이다.

### 의도

효과 없는 규칙을 줄여 규칙 저장소의 노이즈와 유지비를 낮춘다.

### 논리

`violation_count`, `effectiveness.status`, `last_violation_at` 같은 메타데이터를 보고 거의 쓰이지 않거나 문제를 만드는 규칙을 정리한다.

### 이유

규칙 수가 늘수록 compacting, load time, 판단 복잡도가 같이 늘어난다.

### 리스크

- 좋은 규칙을 너무 빨리 지울 수 있다.
- 드문 but 중요한 규칙이 희생될 수 있다.
- prompt scope 규칙은 일반 규칙처럼 자르면 안 된다.

### 활성 조건

- 규칙 수가 수십 개 이상으로 증가
- 30일 이상 관측된 규칙이 충분히 생김
- 효과 없는 규칙이 탐색을 더럽히는 것이 확인됨

### 승격 체크리스트

- 먼저 `prune_candidate`만 만들고, 자동 삭제는 끈 채로 후보 적중률을 본다.
- 삭제 후보는 사람 검토를 거쳐야 하며, `scope: 'prompt'`는 별도 경로로 다룬다.
- canary는 일부 프로젝트/규칙군에서만 열고, 삭제 대신 보류 상태를 먼저 적용한다.
- 삭제 후 문제가 생기면 후보 플래그만 끄고 즉시 복구 가능한 상태여야 한다.
- 본 경로 삭제는 후보 검토가 반복적으로 안정적일 때만 허용한다.

### 튜닝 가이드

- 처음에는 `prune_candidate` 표시만 남긴다.
- `scope: 'prompt'`는 별도 취급한다.
- 삭제 전에 shadow에서 "지울 뻔한 유효 규칙"을 측정한다.
- 후보 로그는 `projects/{key}/rule-prune-candidates.jsonl`에 append-only로 남긴다.

### 다음 방향

자동 삭제가 안정되면, 규칙 수명 주기를 `created → candidate → pruned`로 명시할 수 있다.

### 아직 비활성

- 자동 대량 삭제
- prompt scope 규칙의 일반 규칙과 동일 처리
- 검토 없이 즉시 prune

---

## 3. 의미 기반 compacting 필터

### 현재 상태

compacting은 하네스 컨텍스트를 주입한다. reduced-safe 5b로 `compacting-relevance-shadow.jsonl`에 relevance shadow를 남기고, `semantic_compacting_enabled` opt-in에서만 metadata-first 정렬을 적용할 수 있다. 기본값은 여전히 꺼져 있다.

### 의도

세션 컨텍스트에 지금 필요한 것만 넣는다.

### 논리

compacting은 토큰이 줄어드는 순간에 동작한다. 이 시점에 관련성 필터가 없으면 오래된 규칙과 현재 작업의 규칙이 섞인다.

### 이유

토큰 압박이 심할수록 무관한 규칙은 품질을 떨어뜨린다.

### 리스크

- false negative: 중요한 규칙을 빼먹을 수 있다.
- false positive: 넓은 키워드로 엉뚱한 규칙이 들어갈 수 있다.
- 필터가 강하면 억제력이 약해진다.

### 활성 조건

- compacting context가 실제로 길어짐
- 규칙 수가 많아 상시 주입이 비싸짐
- 특정 작업군에서 규칙 노이즈가 반복됨

### 승격 체크리스트

- 먼저 메타데이터 기반 필터만 opt-in으로 켜서 누락/과잉 포함을 기록한다.
- 관련성 점수는 사람이 읽을 수 있는 이유가 붙어야 하며, 무작위 필터링처럼 보이면 안 된다.
- canary에서는 필터 결과를 실제 주입과 병렬 기록하고, baseline 대비 누락 사례를 확인한다.
- 롤백은 필터 비활성만으로 가능해야 하고, 기존 compacting 동작은 그대로 살아 있어야 한다.
- 본 경로 반영은 필터가 현재 작업과 최근 실패를 안정적으로 가려낼 때만 한다.

### reduced-safe 5b 메모

- 현재 구현은 project match, scope, recent activity, recent violation 같은 **기존 메타데이터**를 우선 사용한다.
- soft rule 쪽은 metadata-first 정렬이고, fact 쪽은 기존 lexical match 후보 집합 안에서 metadata-first 정렬을 적용한다.
- LLM/embedding ranking은 아직 넣지 않았다.
- 기본값(`semantic_compacting_enabled=false`)에서는 compacting 선택 결과를 바꾸지 않고 shadow 로그만 남긴다.

### 튜닝 가이드

- 시작은 메타데이터 기반 필터다: `project_key`, `scope`, 최근 위반, 최근 사용.
- 그다음 세션 파일/키워드 기반 관련성 점수를 넣는다.
- 마지막에만 LLM 또는 embedding 기반 ranking을 검토한다.

### 다음 방향

compacting은 결국 "현재 작업 + 최근 실패 + 강한 금지"만 남기는 방향으로 간다.

### 아직 비활성

- 의미 기반 자동 주입의 기본화
- LLM/embedding 기반 상시 랭킹
- 필터 오류를 자동으로 학습해 즉시 주입 정책에 반영

---

## 4. LLM 기반 Phase 구조 / signal 판정

### 현재 상태

phase/signal은 `phase-manager.ts`의 결정적 로직이 계속 관리한다. Step 5a로 `phase-signal-shadow.jsonl`에 그림자 로그를 추가했고, Step 5f로 metadata-based canary evaluation을 구현했다. canary는 `canary_enabled`(기본값 false)가 켜진 경우에만 저신뢰도 프록시 상황에서 메타데이터 기반 평가를 수행하고, deterministic과 불일치하면 `canary-mismatches.jsonl`에 기록한다. 실제 phase/signal 판정 경로는 그대로다.

### 의도

- **Phase 판단**: 지금 작업이 frontend/backend/tester/reviewer 중 어디에 해당하는지 더 잘 분류
- **Signal 판단**: 어떤 이벤트가 진짜 학습 신호인지, 잡음인지 더 잘 구분

### 논리

LLM은 결정권자가 아니라 판정자다.

- 현재 deterministic 경로가 baseline
- LLM은 shadow label 생성
- 둘이 어긋나는 구간만 따로 분석

### 이유

비결정적인 분류를 바로 운영 경로에 넣으면 phase state와 signal quality가 같이 흔들린다.

### 리스크

- 같은 입력에 다른 답을 줄 수 있다.
- phase가 흔들리면 서브에이전트 라우팅이 흔들린다.
- signal 오분류는 학습 전체를 망칠 수 있다.

### 활성 조건

- deterministic 판정의 오분류가 반복됨
- 충분한 로그가 축적됨
- shadow 결과와 실제 성공률을 비교할 수 있음

### 승격 체크리스트

- `phase-signal-shadow.jsonl`에서 결정적 baseline과 비교 가능한 mismatch 묶음이 충분히 쌓여야 한다.
- 사람 리뷰로 phase 오분류와 signal 오분류를 분리해서 설명할 수 있어야 한다.
- canary는 `phase_hint / signal_relevance / confidence` 같은 보조값만 내보내고, 실제 phase 파일 쓰기는 하지 않는다.
- opt-in 세션에서만 후보 라벨을 보여 주고, 라우팅 결과는 여전히 결정적 경로가 최종 결정해야 한다.
- 롤백은 shadow 기록은 유지한 채 LLM 판정을 끄는 것만으로 끝나야 한다.
- 본 경로 반영은 반복 검토 후에도 deterministic 대비 품질이 나쁘지 않다는 것이 확인될 때만 한다.

### 튜닝 가이드

- 먼저 `phase_hint`, `signal_relevance`, `confidence`만 출력한다.
- 실제 phase 파일 쓰기는 하지 않는다.
- low-confidence 케이스만 LLM에 넘기는 하이브리드 구조가 안전하다.

### 다음 방향

초기에는 phase만, 그다음 signal만, 마지막에 둘의 결합 판단을 넣는 순서가 좋다.

### 아직 비활성

- LLM이 phase 파일을 직접 쓰는 경로
- signal 판정으로 서브에이전트 라우팅을 대체하는 경로
- confidence가 낮은 케이스를 자동으로 본 판정으로 승격하는 경로

### Step 5f 탐색 결과 — Phase-Signal Canary 설계

> 탐색 일시: 2026-04-20. 코드 조사 기반으로 판정 근거를 정리.  
> 이 섹션은 propose/apply 단계에서 설계 참고 자료로 사용.

#### 조사 결과

**Deterministic baseline** (현재 동작):

| 판정 | 로직 | 위치 |
|------|------|------|
| Phase 전환 | `transitionPhase()` — agent가 명시적 호출. same-phase no-op, 2.5 gate, 역방향 차단 | `phase-manager.ts:89-143` |
| Phase 리셋 | `resetPhase()` — Phase 5 완료 후 초기화. 리셋은 shadow에 기록 안 됨 | `phase-manager.ts:149-154` |
| error_repeat | 에러 메시지 정규화 키 카운트 ≥ 3 | `observer.ts:178-211` |
| user_feedback | 11개 한국어 키워드 하드코딩 매칭 | `observer.ts:220-246` |
| fix_commit | `git log --since=` + COMMIT_START 파싱 | `improver.ts:1037-1098` |

**Shadow 로깅** (Step 5a에서 구현):

- 모든 deterministic 판정이 `phase-signal-shadow.jsonl`에 append됨
- `ShadowDecisionRecord` 스키마에 `shadow.phase_hint`, `shadow.signal_relevance`, `shadow.confidence` 필드 **정의됨**
- 하지만 **항상 stub**: `status: 'unavailable'`, `confidence: 0`, `reason: 'llm_unavailable'`
- 읽는 코드, 비교 코드, canary 코드 = **제로**

**기존 canary 유사 패턴** (compacting):

- `planCompactionSelections()`가 baseline vs applied 비교 — 5f의 선배 패턴
- `appendCompactionShadowRecord()`가 `shadow_candidates`에 scored metadata 기록
- 이 패턴을 그대로 phase/signal에 적용 가능

#### 설계 결정: B + ② + 표준

3가지 설계 질문에 대한 옵션과 선택:

**Q1: Canary 트리거 시점**

| 옵션 | 설명 | 판단 |
|------|------|------|
| A: 전수 | 모든 판정마다 LLM 호출 | ❌ 자명한 판정에 토큰 낭비. Phase 1→2의 95%는 "맞음" |
| **B: 저신뢰도만** | deterministic 경계 상황만 선별 | ✅ 채택 — 가치 있는 곳에만 토큰 사용 |
| C: 샘플링 | N번에 1번 무작위 | ❌ 중요 edge case 놓침 |

저신뢰도 프록시 (deterministic이 이미 알려주는 경계 상황):

```
Phase 쪽:
  - Phase 2.5 gate BLOCKED → agent가 Phase 3 원했는데 막힘
  - Phase 역행 (3→2, 4→2) → 정방향이 보통인데 예외적

Signal 쪽:
  - user_feedback 발생 → 한국어 키워드 매칭은 근본적으로 noisy
  - error_repeat 직전 (count=2) → 사전 경보 역할 가능
```

**Q2: Canary 출력 처리**

| 옵션 | 설명 | 판단 |
|------|------|------|
| ① 로그만 | mismatch 기록. 아무도 자동 안 읽음 | ❌ 아무도 안 읽으면 의미 없음 |
| **② 로그 + 집계 리포트** | mismatch + 통계 (mismatch율, 패턴별 분포) | ✅ 채택 — 승격 여부를 데이터로 결정 |
| ③ 로그 + orchestrator 주입 | 실시간 자가교정 | ❌ premature. shadow가 deterministic에 간섭하는 경계 모호 |

집계 리포트 출력 예시:

```
canary-mismatches.jsonl 분석:
  총 47건 canary 평가
  mismatch 12건 (25.5%)
  ├── phase_blocked: 8건 중 5건 mismatch → "gate가 너무 엄격할 수 있음"
  ├── user_feedback: 15건 중 4건 mismatch → "키워드 noise 확인"
  └── error_pre_alert: 24건 중 3건 mismatch → "임계값 3이 적절"
  → 승격 후보: user_feedback relevance 보정
  → 승격 보류: phase gate (mismatch 높지만 gate 완화 위험 큼)
```

**Q3: LLM 컨텍스트 크기**

| 옵션 | 설명 | 판단 |
|------|------|------|
| 최소 | 판정 자체만 | ❌ 맥락 없어 LLM이 추측만 |
| **표준** | 판정 + 최근 10개 shadow 레코드 | ✅ 채택 — 맥락 충분, 토큰 합리적 |
| 풀 | 판정 + 전체 히스토리 + 프로젝트 상태 | ❌ 비용 폭발 |

비용 추정: 레코드당 ~200토큰 × 10 + 프롬프트 = **~3,000토큰/call**. 하루 20건 평가 시 60K 토큰.

#### 워크플로우

```
                Deterministic 판정
                      │
                ┌─────▼─────┐
                │ 프록시 체크 │  ← 저신뢰도?
                └─────┬─────┘
                 No   │   Yes
            (skip)    │    └───────┐
                      │            │
                ┌─────▼─────┐  ┌───▼───────────┐
                │ 그냥 기록  │  │ LLM canary 호출│
                │ (기존처럼) │  │ ctx=최근10레코드│
                └───────────┘  └───┬───────────┘
                                   │
                          ┌────────▼────────┐
                          │ shadow block    │
                          │ = LLM 결과 채움 │
                          │ (phase_hint,    │
                          │  signal_relev., │
                          │  confidence)    │
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │ mismatch?       │
                          │ (det ≠ shadow)  │
                          └───┬────────┬────┘
                             Yes   │   No
                          ┌───▼────▼──┐   │
                          │ canary-   │   │
                          │mismatches │   │
                          │  .jsonl   │   │
                          └───────────┘   │
                              │           │
                              ▼           ▼
                        ┌──────────────────────┐
                        │  집계 리포트 함수      │
                        │  (온디맨드 호출 가능)  │
                        └──────────────────────┘
```

#### LLM 호출 한계 — 추가 조사 (2026-04-20)

**핵심 발견: 플러그인 훅에서 LLM을 직접 호출할 수 없다**

OpenCode Plugin API 전수 조사 결과:

| 방법 | 가능? | 근거 |
|------|-------|------|
| Plugin Hook에서 LLM 호출 | ❌ | hook은 `input`/`output`만 받고 LLM 접근점 없음 |
| `event` 핸들러에서 LLM 호출 | ❌ | 순수 이벤트 수신. LLM API 미제공 |
| `config`에서 LLM 호출 | ❌ | 설정 등록만. 실행 시점에 LLM 없음 |
| OpenCode client 객체 사용 | ❌ | `input.client`는 plugin-client (hook trigger용). LLM 호출 API 아님 |
| 외부 HTTP API 직접 호출 | ⚠️ 기술적으론 가능 | API key 관리, 비용 추적, 모델 동기화를 플러그인이 직접 해야 함 |

이 제약 때문에 canary의 LLM 활용 방식이 달라진다. 아래 5가지 대안을 비교했다.

#### LLM 호출 대안 5종 비교

**A: 메타데이터 전용 (LLM 없음)** ← **5f 채택안**

```
compacting shadow와 동일 패턴
  ├── 규칙/히스토리 메타데이터로 유추
  ├── phase_hint: "역행" / "gate blocked" 등 deterministic 메타데이터에서 산출
  ├── signal_relevance: 키워드 빈도, 에러 패턴 빈도로 산출
  ├── confidence: 프록시 상황의 희귀성으로 산출
  └── 장점: LLM 필요 없음, 즉시 구현, deterministic 재현 가능
      단점: "의미적" 판단 불가 (예: "왜이래"가 감탄인지 불만인지 구분 못함)
```

**B: 프롬프트 인젝션 (LLM 간접 호출)**

```
훅에서 canary 질문을 파일/컨텍스트에 쓰기
  ├── 다음 orchestrator 턴에서 LLM이 자연스럽게 평가
  ├── 결과를 파일로 쓰면 다음 훅에서 읽음
  └── 장점: 실제 LLM 판단 활용, API key 불필요
      단점: 지연 (1턴 대기), 비결정적, 훅↔에이전트 결합도 증가
```

**C: 외부 API 직접 호출**

```
플러그인에서 fetch()로 Claude/GPT API 직접 호출
  ├── API key는 harness.jsonc에 설정
  └── 장점: 독립적, 지연 없음, 동기 호출 가능
      단점: API key 관리 부담, 모델 동기화 문제, shadow 단계엔 과도한 복잡도
```

**D: 전용 서브에이전트에 위임**

```
plugin 훅이 canary 평가 요청을 파일에 기록
  → orchestrator 프롬프트에 "canary 평가 대기중" 주입
  → orchestrator가 전용 canary 서브에이전트(@advisor 등)에 위임
  → 서브에이전트 결과를 파일에 기록
  → 다음 훅에서 결과 읽어 shadow block 채우기
  └── 장점: 기존 에이전트 인프라 활용, API key 불필요, 모델 선택 자유
      단점: 1~2턴 지연, orchestrator 협력 필요, 프롬프트 결합도
```

**E: tmux 외부 세션 호출**

```
플러그인 훅에서 child_process로 tmux 세션 생성
  → CLI 도구 (claude-code, codex, gemini, opencode 등) 실행
  → stdout 캡처 후 세션 kill
  → 결과 파싱해서 shadow block 채우기
  └── 장점: 어떤 LLM이든 사용 가능, API key 불필요 (도구가 자체 관리)
      단점: tmux 의존성, CLI 도구 설치 필요, 10~30초 지연,
           출력 파싱 취약점, 동시 세션 관리 복잡도
```

#### 대안 비교 매트릭스

| 기준 | A: 메타데이터 | B: 프롬프트 | C: 외부API | D: 서브에이전트 | E: tmux |
|------|-------------|------------|-----------|---------------|---------|
| LLM 판단 품질 | 낮음 (메타데이터 한계) | 높음 | 높음 | 높음 | 높음 |
| 구현 복잡도 | 낮음 | 중간 | 중간 | 중간 | 높음 |
| 지연 | 없음 (동기) | 1턴 | 없음 (비동기 가능) | 1~2턴 | 10~30초 |
| 외부 의존성 | 없음 | 없음 | API key | 없음 | tmux + CLI 도구 |
| API key 관리 | 불필요 | 불필요 | 필요 | 불필요 | 불필요 |
| shadow 단계 적합성 | ★★★ | ★★ | ★ | ★★ | ★ |
| 본 경로 승격 가능성 | → D/B/E | → 본 경로 | → 본 경로 | → 본 경로 | → 본 경로 |

#### 판단: 5f는 A, 향후 D 또는 E로 승격

1. **A로 시작**: compacting shadow가 이미 증명한 패턴. `rankSemanticSoftRules()`가 LLM 없이도 유의미한 결과를 만듦. shadow 단계에서 LLM 오류와 canary 오류를 분리할 수 없으므로 메타데이터가 안전

2. **D가 유력한 승격 후보**: 기존 에이전트 인프라를 그대로 활용. orchestrator가 canary 서브에이전트에 위임하면 API key 없이 LLM 판단 확보. 프롬프트 인젝션(B)보다 명시적이고 제어 가능

3. **E는 백업 옵션**: 다른 LLM(예: claude-code ↔ opencode)으로 교차 검증이 필요해질 때 유력. 하지만 환경 의존성이 높아 기본 경로로는 부적합

4. **C는 최후 수단**: API key 관리 부담이 크고, shadow 단계에서 정당화하기 어려움. 본 경로에서도 B/D/E가 더 나은 선택지

**승격 로드맵:**

```
5f (지금):  A (메타데이터 전용)
             → canary-mismatches.jsonl 축적
             → mismatch 패턴 분석
             → "메타데이터로 충분한가?" 판단

5g+ (향후): D (서브에이전트 위임) 또는 E (tmux 외부 세션)
             → 메타데이터 한계가 확인된 경우
             → 실제 LLM 판단과 비교
             → B/C는 특수 상황에서만 검토
```

#### 구현 예상 범위 (A안 기준)

| 항목 | 내용 |
|------|------|
| 프록시 판정 함수 | deterministic 판정이 저신뢰도 프록시에 해당하는지 판별 |
| Shadow 레코드 리더 | `phase-signal-shadow.jsonl` 역순 읽기 (최근 N개) |
| 메타데이터 canary 평가 | 프록시 통과 시, 메타데이터 기반으로 `phase_hint`, `signal_relevance`, `confidence` 산출 |
| Shadow block 채우기 | stub → 메타데이터 평가 결과로 `phase_hint`, `signal_relevance`, `confidence` 기록 |
| Mismatch 감지 | deterministic vs shadow 불일치 탐지 → `canary-mismatches.jsonl` |
| 집계 리포트 | mismatch율, 패턴별 분포, 승격 후보 판정 함수 |
| 설정 | `canary_enabled` (default: false), 프록시 on/off 플래그 |

---

## 5. diff 기반 실수 패턴 학습

### 현재 상태

`fix_commit` 흐름과 diff 파싱 하드닝은 이미 있다. Step 5a로 `mistake-pattern-shadow.jsonl`에 실수 요약 그림자 로그를 쌓고, Step 5e로 `mistake-pattern-candidates.jsonl`에 반복 패턴을 candidate로 기록하는 `groupMistakeCandidates()`가 추가됐다. `computePatternIdentity()`로 동일 패턴을 식별하고, `candidate_threshold`(기본값 3) 도달 시 candidate를 생성한다. 본 경로 rule 생성은 아직 비활성.

### 의도

단순한 파일 목록이 아니라 실수 패턴을 뽑는다.

- 어떤 종류의 버그였는지
- 왜 그런 실수가 났는지
- 다음에는 무엇을 막아야 하는지

### 논리

기존 deterministic 경로는 "무엇이 바뀌었는가"를 본다. 여기서 한 단계 더 가서 "왜 바뀌었는가"를 추출해야 규칙 품질이 좋아진다.

### 이유

파일명만 보면 수정 금지 대상을 잘못 학습할 수 있다. 그래서 `source_file` 단독 기준은 위험하다.

### 리스크

- diff가 크면 요약이 뭉개진다.
- LLM이 패턴 대신 문장 요약만 할 수 있다.
- 동일한 실수인데 커밋 스타일이 다르면 분류가 흔들린다.

### 활성 조건

- fix 커밋이 충분히 축적됨
- diff와 최종 수정 결과를 비교할 수 있음
- 같은 유형의 실수가 여러 번 반복됨

### 승격 체크리스트

- shadow `mistake_summary`와 실제 fix 결과를 함께 봤을 때, 반복 패턴이 사람 눈으로도 확인돼야 한다.
- `source_file` 단독으로는 충분하지 않으므로, diff/commit message/변경 맥락을 같이 검토해야 한다.
- candidate는 먼저 추천만 하고, 자동 rule 생성은 끈 채로 수동 승인 절차를 둔다.
- canary는 일부 반복 패턴에 한해 열고, 잘못된 패턴 분류가 나오면 즉시 후보 생성만 중단한다.
- 본 경로 반영은 여러 번 같은 패턴이 재현되고, 리뷰에서 예방 규칙이 타당하다고 확인된 뒤에만 한다.

### 튜닝 가이드

- 먼저 shadow extractor로 `mistake_summary`만 쌓는다.
- 패턴은 커밋 메시지, diff, 변경 파일을 함께 본다.
- 같은 패턴이 여러 번 반복될 때만 rule candidate로 올린다.

### 다음 방향

나중에는 "어떤 실수였는가"와 "어떤 예방 규칙이 유효했는가"를 분리 저장하는 편이 좋다.

### 아직 비활성

- 실수 패턴의 자동 규칙 설치
- 단일 diff를 근거로 한 즉시 학습
- 검토 없는 auto-promotion

---

## 6. Ack 조건 강화

### 현재 상태

Step 5a로 `ack-status.jsonl`에 `written` / `accepted`를 분리 기록한다. `ack_guard_enabled`는 기본값이 false라 accepted는 가드가 켜질 때만 기록된다.

### 의도

ack를 written/accepted로 나눠서, 저장 성공과 실제 통과를 분리한다.

### 논리

ack는 상태 전이의 마지막 문턱이어야 한다. 그런데 write 성공만 보고 ack를 찍으면 잘못된 규칙도 너무 쉽게 완료 처리된다.

### 이유

문제가 된 건 거짓 ack 자체보다, 검증 없이 닫히는 구조다. 즉, acceptance plane이 필요하다.

### 리스크

- 검증이 무거우면 ack가 느려진다.
- 너무 강한 검증은 처리량을 떨어뜨린다.
- 검증 도구가 없으면 예전 방식으로 되돌아간다.

### 활성 조건

- `harness-eval` 또는 이에 준하는 acceptance check가 준비됨
- ack 지연이 사용자 경험을 심하게 해치지 않음
- 검증 실패 시 재시도/보류 정책이 정리됨

### 승격 체크리스트

- `written`과 `accepted`의 차이가 실제로 검증 가능해야 하고, accepted 쪽 근거가 로그로 남아야 한다.
- review는 rule/signal 종류별로 나뉘어야 하며, 실패 시 hold/retry 기준이 먼저 합의돼 있어야 한다.
- canary에서는 일부 ack 유형만 `accepted`를 열고, 나머지는 계속 `written`만 남긴다.
- 기본 경로는 여전히 `written` 우선이어야 하며, accepted는 opt-in 뒤에만 켠다.
- 롤백은 `ack_guard_enabled=false`로 되돌리는 것만으로 끝나야 하고, 기존 written 로그는 유지돼야 한다.
- 본 경로 반영은 검증 실패 처리와 보류 정책이 안정적으로 굴러갈 때만 한다.

### 튜닝 가이드

- ack를 두 단계로 나눈다: `written` → `accepted`. accepted는 default-off 가드 뒤에서만 기록된다.
- acceptance check는 signal/rule 종류별로 다르게 둔다.
- eval이 불가능하면 기존 ack를 유지하고 경고만 남긴다.

### 다음 방향

ack는 결국 "파일이 써졌는가"가 아니라 "목적을 만족했는가"로 바뀌어야 한다.

### 아직 비활성

- `accepted`의 기본 활성화
- 검증 실패 시 즉시 ack 거부하는 강제 모드
- writing 성공만으로 완료 처리하는 옛 의미의 ack 복귀

---

## 7. Cross-Project 자동 승격

### 현재 상태

현재는 `project_key`와 `global` 개념이 있다. Step 5c에서 `projects/global/cross-project-promotion-candidates.jsonl`에 exact-match 후보를 기록하지만, 자동 global rule 쓰기는 아직 guarded-off다.

### 의도

한 프로젝트에서만 보이던 실수가 여러 프로젝트에서 반복되면 그건 공통 패턴일 수 있다. 이때만 global 승격을 고려한다.

### 논리

Cross-Project 승격은 프로젝트 간 학습 전파다. 하지만 공통 패턴처럼 보이는 우연한 유사성도 많기 때문에 자동화하면 위험하다.

### 이유

blast radius가 크다. 잘못 global로 올리면 하나의 오판이 여러 프로젝트에 퍼진다.

### 리스크

- 패턴 유사도 판정이 애매하다.
- 프로젝트 수가 적으면 통계가 흔들린다.
- 잘못된 global rule은 복구 비용이 크다.

### 활성 조건

- 2개 이상 프로젝트에서 동일 패턴이 반복됨
- `project_key`가 충분히 다양함
- shadow에서 global 후보와 실제 효과를 비교할 수 있음

### 튜닝 가이드

- 처음부터 자동 승격하지 말고 후보만 모은다.
- 수동 `global` 설정을 우선 경로로 둔다.
- 최소 2단계 확인이 필요하다: 패턴 일치 + 실제 효과.
- 후보 로그는 `projects/global/cross-project-promotion-candidates.jsonl`에 append-only로 남긴다.

### 다음 방향

프로젝트 수가 더 늘어나면 cohort 단위 global 승격이나 프로젝트 그룹별 승격이 더 안전할 수 있다.

---

## 8. auto-update-checker

### 현재 상태

완료. 기본 비활성의 warn-only 세션 시작 체크로 붙였다.

### 의도

npm 배포 후, 사용자가 너무 오래된 버전을 쓰지 않도록 알려준다.

### 논리

세션 시작(`session.created`) 시에만 레지스트리 버전을 확인하고, 현재 설치 버전보다 새 버전이 있으면 warn-only로 알린다. 자동 갱신은 하지 않는다.

### 이유

이 기능은 품질 제어보다 운영 편의에 가깝다. 그래서 하네스 핵심 루프보다 훨씬 늦게 열어도 된다.

### 리스크

- 매 세션 체크가 귀찮을 수 있다.
- 네트워크 장애가 세션 시작을 방해하면 안 된다.
- 자동 업데이트는 사용자가 원치 않을 수 있다.

### 활성 조건

- npm 배포가 실제로 진행됨
- 버전 비교 기준이 안정적임
- 체크 실패가 세션에 영향을 주지 않음
- 전역 쿨다운 상태 파일이 유지됨

### 튜닝 가이드

- 기본은 비활성으로 둔다.
- 체크 실패는 무시하고 경고만 남긴다.
- 빈번한 알림은 24h 전역 쿨다운으로 줄인다.
- 상태 파일은 `~/.config/opencode/harness/projects/global/auto-update-checker.json`을 사용한다.

### 다음 방향

나중에는 patch/minor/major에 따라 알림 강도를 다르게 줄 수 있다. 자동 설치까지 가는 건 별도 판단이 필요하다.

---

## 한 줄 요약

이 8개는 모두 "지금 당장 본 경로를 바꾸는 기능"이 아니라, **데이터를 먼저 쌓고 그림자 모드로 검증한 뒤 가드로 승격하는 기능**이다.  
그래서 `AGENTS.md`에는 짧게 남기고, 상세 이유는 이 문서에만 둔다.

## 범위 밖

외부 트렌드 자동 수집, todo-continuation, autopilot은 이 문서의 범위에서 제외한다.
