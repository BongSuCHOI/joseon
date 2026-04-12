# Step 2 — 사전 구현 분석서

> **작성일:** 2026-04-11  
> **분석자:** orchestrator (참고 문서 완독 + 갭 분석)  
> **크로스 리뷰어:** @oracle (독립 검증 — v3 의사코드 버그 2건 발견)  
> **상태:** Step 1 완료·아카이브됨. Step 2 구현 전.  
> **참고:** v3-final 5장 "Step 2 — 하네스 고도화" 및 8장 "참고 문서 인덱스"  
> **전제:** 원본은 Claude Code 기반, v3는 OpenCode 플러그인 기반으로 환경 차이가 있음

---

## 목차

1. [분석 배경 및 대상](#1-분석-배경-및-대상)
2. [참고 문서 6개 분석](#2-참고-문서-6개-분석)
3. [V3 vs 원본 갭 분석 (6개)](#3-v3-vs-원본-갭-분석-6개)
4. [보완 포인트 분석 (4개)](#4-보완-포인트-분석-4개)
5. [오라클 크로스 리뷰](#5-오라클-크로스-리뷰)
6. [V3 의사코드 충실도 재평가](#6-v3-의사코드-충실도-재평가)
7. [Step 2 구현 범위 최종 확정](#7-step-2-구현-범위-최종-확정)
8. [구현 시 반영 체크리스트](#8-구현-시-반영-체크리스트)

---

## 1. 분석 배경 및 대상

### 왜 이 분석을 했는가

AGENTS.md에 명시된 의무:

> **[구현 전] 사전 숙지:** 각 단계/레이어 작업 시작 전, `/docs/opencode-harness-orchestration-guide-v3-final.md` 내 작업 범위에 해당하는 내용과 함께 첨부된 참고 링크를 반드시 완독한다.

Step 2 참고 문서 6개를 완독하고, v3 의사코드와의 정합성을 검증. 오라클에게 크로스 리뷰를 의뢰하여 독립 검증 수행.

### 분석 대상 문서

| # | 문서 | URL | Step 2 역할 |
|---|------|-----|-------------|
| 1 | Self-Evolving System | https://hugh-kim.space/self-evolving-system.html | **핵심.** 3개 피드백 루프, SOFT→HARD 승격 원본 설계 |
| 2 | Codex Loop Era L6 | https://hugh-kim.space/codex-loop-era-l6.html | Practical L6, wrapper 기반 폐루프, acceptance plane |
| 3 | Codex Integration | https://hugh-kim.space/codex-integration.html | 이중 모델 검증, 3중 강제 게이트, 에러 복구 4단계 |
| 4 | Memory Bank Analysis | https://hugh-kim.space/memory-bank-analysis.html | 크로스세션 기억 7-Step 파이프라인 |
| 5 | Trend Harvest Log | https://hugh-kim.space/trend-harvest-log.html | 외부 트렌드 수집, 5축 필터 |
| 6 | Loopy V2 Surface Gap | https://hugh-kim.space/loopy-v2-surface-gap.html | 표면 UX 래핑, 6개 사용자 명령 설계 |

### 현재 코드베이스 상태 (Step 1 완료)

```
src/
├── index.ts                  # observer + enforcer export
├── types.ts                  # Signal, Rule, ProjectState
├── shared/
│   ├── constants.ts          # HARNESS_DIR
│   ├── utils.ts              # getProjectKey, ensureHarnessDirs, logEvent, generateId
│   └── index.ts              # 배럴 export
└── harness/
    ├── observer.ts           # L1 관측 + L2 신호 변환
    └── enforcer.ts           # L4 HARD 차단 + SOFT 위반 추적
```

---

## 2. 참고 문서 6개 분석

### 2.1 Self-Evolving System — 폐루프 원본 설계도

**3개 피드백 루프:**

| 루프 | 트리거 | 처리 | 산출물 |
|------|--------|------|--------|
| Loop 1 — Reactive | fix: 커밋 | diff 분석 → 패턴 추출 | scaffold NEVER DO 추가 |
| Loop 2 — Proactive | 사용자 불만 키워드 | feedback.jsonl → 근본 원인 분석 | 규칙 생성 |
| Loop 3 — Meta | 30일 경과 | 효과 평가 | 승격/폐기 |

**SOFT→HARD 승격 3단계:**
1. **Soft Rule** — rules/*.md에 자연어 규칙. AI가 무시 가능
2. **Pattern Match** — scaffold NEVER DO에 추가. violation-check.sh 경고
3. **Hard Block** — 자동 승격. exit 2 무시 불가능

**원본 Phase 구조 (v3에서 단순화됨 — 갭 A에서 상세 분석):**
- Phase 0: 불만 분석
- Phase 1: Memory-Bank 검색
- Phase 1.45: SOFT→HARD 판정
- Phase 1.5: fix diff → scaffold 진화
- Phase 1.6: Pruning
- Phase 1.7: Cross-Project 승격
- Phase 2~4: 생성 → 적용

**실제 진화 이력 (원본 7일간 운영):**
- 51건 자동 개선
- 4개 프로젝트 독립 scaffold
- 12개 HARD hook 운영
- 모든 규칙이 실제 fix: 커밋에서 생성

---

### 2.2 Codex Loop Era L6 — Practical L6

**L1~L6 충족 구조:**

| Level | 의미 | 핵심 구현 |
|-------|------|-----------|
| L1 | 관측 가능성 | codex-event-daemon.py, session JSONL |
| L2 | 신호 변환 | telemetry-judge.py, actionable signal 분류 |
| L3 | 프로젝트 격리 | project_key 기반 상태 파일, pending/ack 분리 |
| L4 | 규칙 차단 | session-start, pre-commit, pre-push에서 hard rule block |
| L5 | 자동 수정 | self-improve-worker.py, detached worktree 기반 |
| L6 | 폐루프 | worker auto-run, acceptance plane, auto-ack |

**폐루프 닫힘 흐름:**
```
Observe → Classify → Persist → Repair → Accept/Enforce
```

**Key insight — "Practical L6":**
- Codex 런타임 자체의 native hook이 아닌 wrapper 기반
- OpenCode 플러그인은 wrapper 개념 없이 직접 훅을 등록하므로, **OpenCode가 원본보다 더 네이티브한 L6 구현이 가능**

**Acceptance plane 안전성:**
- arbitrary shell verification 제거
- 허용된 check type + global smoke + repo-local smoke만 통과
- "성공했다고 말하면 ack" 구조 약화 → worker가 자기 수정을 자가 검증하는 근본적 충돌(자가 채점) 해결

---

### 2.3 Codex Integration — 이중 모델 검증

**3중 강제 게이트:**
1. **Review Gate** — SubagentStop/TaskCompleted 시 `codex review --uncommitted` 자동 실행. CRITICAL 0건이면 `.codex-review-passed` 증거 파일 생성
2. **Stop Gate** — 응답 종료 시도 시 codex review → `decision: "block"` 반환 시 멈춤
3. **Push Gate** — `.qa-cycle-passed` + `.codex-review-passed` 둘 다 PASS여야 push 허용 (exit 2 HARD BLOCK)

**에러 복구 4단계:**
1. 직접 수정 (타입 정의, import 경로, 로직 수정)
2. 구조 변경 (타입 가드, optional chaining, 대안 라이브러리)
3. **codex:rescue** — GPT-5.4에 위임, 완전히 다른 접근 시도
4. 리셋 (revert 후 다른 구현 방식 재시도)
→ 4차 실패 시 사용자 에스컬레이션 (텔레그램 알림)

**Step 2와의 관계:** 3중 게이트와 에러 복구 4단계는 **오케스트레이션 레벨 기능**. Step 2 하네스 단계에서는 해당 없음. v3 5.2.2에서 Step 2 고도화 포인트로 명시, 7.1에서 cross-reviewer 에이전트로 정의됨 (갭 D에서 상세 분석).

---

### 2.4 Memory Bank Analysis — 크로스세션 기억

**7-Step Data Pipeline:**
```
Sync → Index → Search → Extract → Consolidate → Relate → Recall
```

**각 단계의 입력→산출물:**
| 단계 | 입력 | 산출물 |
|------|------|--------|
| Sync | conversation JSONL | `memory/archive/{session_id}.jsonl` 복사 |
| Index | archive JSONL | SQLite + vector table (exchange, vector) |
| Search | semantic/text/hybrid 쿼리 | 과거 대화 회수 결과 |
| Extract | 세션 종료 시 대화 | decision/preference/constraint 키워드 → `memory/facts/{id}.json` |
| Consolidate | facts | 중복/충돌/진화 정리 → fact 품질 유지 |
| Relate | facts | domain/category 분류 + typed relation 연결 |
| Recall | 전체 지식 베이스 | MCP/CLI/UI 인터페이스로 회수 |

**3층 구조:**
1. **Input Layer** — Archive-able Context (대화 JSONL, tool call, 세션 메타데이터)
2. **Transformation Layer** — Searchable Knowledge (embedding, indexing, fact extraction)
3. **Recall Layer** — Grounded Interfaces (MCP, CLI, UI)

**설계 원칙:**
- **Archive First** — 원본 보존해야 재해석 가능
- **Fact Promotion** — 세션 내용을 reusable statement로 승격
- **Scoped Memory** — 프로젝트 로컬 vs 글로벌 분리
- **Evolution Aware** — fact revision과 contradiction 추적 필수

**v3와의 정렬:** v3 5.2.1이 memory-bank의 하위 3단계(Sync, Index, Search)만 Step 2 고도화에서 구현하도록 정의. 상위 4단계는 데이터 축적 후 (갭 F에서 상세 분석).

---

### 2.5 Trend Harvest Log — 외부 트렌드 수집

**5축 철학 필터:**
- 자동화 (Automation)
- 마찰 제거 (Friction Reduction)
- HARD 전환 (Hard Enforcement)
- 토큰 효율 (Token Efficiency)
- 측정 가능 (Measurability)

**운영 실적:** 수확 #14 기준(2026-04-10) SEEN 137, Applied 27. 매 6시간마다 GitHub trending 지속 수집 중.

**Step 2와의 관계:** v3 5.2.3에서 명시: *"이 기능은 하네스가 안정된 뒤 가장 마지막에 추가"*. Step 2 기본에서 제외 확정.

---

### 2.6 Loopy V2 Surface Gap — 표면 UX 래핑

**6개 표면 명령:**

| 명령 | 내부 매핑 | 구현 상태 |
|------|----------|----------|
| /loopy:start | init-project → team → qa-scenario-gen | 오케스트레이션 래퍼 필요 |
| /loopy:auto | qa-cycle → self-improve → eval | 오케스트레이션 래퍼 필요 |
| /loopy:resume | checkpoint → auto 재진입 | alias만 |
| /loopy:status | metric parse + state | alias + 출력 포맷 확장 필요 (HARD 비율만 반환 → SOFT 수, pending, 회차 추가 필요) |
| /loopy:history | results.tsv 추이 | alias만 |
| /loopy:measure | eval only | alias만 |

**핵심 통찰:** "엔진 재설계가 아니라 표면 API 정의". 3개는 alias로, 1개는 alias+확장, 2개는 얇은 래퍼로 달성 가능. 총 ~200줄 / 3~4시간.

**Step 2와의 관계:** v3 5.2.4에 정의. 하네스 엔진 안정화 후 적용 (갭 E에서 상세 분석).

---

## 3. V3 vs 원본 갭 분석 (6개)

### 갭 A: Phase 구조 단순화 (Phase 0~4 → `signalToRule()`)

| | 원본 (self-evolving) | v3 의사코드 |
|--|----|----|
| 구조 | Phase 0: 불만분석 → Phase 1: Memory검색 → Phase 1.45: 승격판정 → Phase 1.5: scaffold진화 → Phase 1.6: Pruning → Phase 1.7: Cross-Project승격 → Phase 2~4 | `signalToRule()` 하나로 끝 |

**원본이 다단계인 이유:**
Claude Code 환경에서 `/self-improve`를 직접 호출하면 LLM이 판단하는 다단계 프로세스. 각 Phase가 LLM 프롬프트에 해당.

**v3가 단순화한 이유:**
OpenCode 플러그인은 코드로 동작. LLM 판정 단계를 결정론적 코드 로직으로 대체.

| 장점 | 단점 |
|------|------|
| 결정론적 — 매번 같은 결과 | LLM 기반 판단보다 규칙 생성 품질 낮음 |
| 토큰 비용 0 | 복잡한 상황에서 "적절한 규칙" 자동 생성 어려움 |
| 디버깅 용이 | Signal→Rule 매핑이 경직적 |
| 테스트 가능 | — |

**이후 Step에서 보완 예정?**
명시적 언급 없음. Step 4 오케스트레이션의 cross-reviewer(다른 모델 리뷰)가 간접 보완 가능.

**오버엔지니어링 판정:**
원본 Phase 0~4를 그대로 구현하려면 플러그인 안에 LLM 호출 레이어를 넣어야 함.
- API 키 관리 → 복잡도 폭발
- 토큰 비용 → 매 signal마다 LLM 호출
- 비결정적 → 자동화 테스트 불가

**판정:** v3 단순화가 맞음. 나중에 LLM 기반 판단이 필요하면 별도 도구(`harness-eval`)로 분리해서 "필요할 때만" 호출하는 구조가 적절.

---

### 갭 B: Cross-Project 승격

| | 원본 | v3 |
|--|----|----|
| 동작 | 동일 패턴 2개 프로젝트에서 발견 → 글로벌 rule 자동 승격 | 없음. 규칙은 project_key 또는 'global' 수동 설정 |

**원본이 이렇게 한 이유:**
Hugh Kim이 4개 프로젝트를 동시 운영하며 프로젝트 간 공통 실수 패턴을 발견. 예: article21-page와 bisframework에서 동일 필드명 실수.

| 장점 | 단점 |
|------|------|
| 프로젝트 간 학습 전파 | 잘못된 글로벌 승격 → 다른 프로젝트에 side effect |
| 규칙 중복 방지 | 판정 기준이 애매 (몇 프로젝트? 패턴 유사도 기준?) |

**이후 Step에서 보완 예정?** 없음.

**오버엔지니어링 판정:**
현재 프로젝트는 **단일 프로젝트**에 하네스를 적용하는 게 목적. Cross-Project 승격은 "4개 프로젝트 동시 운영"이라는 특수 환경에서 나온 요구. 지금 구현하려면 project_key 비교 로직, 패턴 유사도 판정 기준, 글로벌 승격 이력 관리가 전부 필요.

**판정:** 명백한 오버엔지니어링. 필요해지면 그때 추가. 지금은 수동으로 `project_key: 'global'` 설정하면 충분.

---

### 갭 C: Pruning (규칙 자동 삭제)

| | 원본 | v3 |
|--|----|----|
| 동작 | Phase 1.6에서 효과 없는 규칙 자동 삭제 | `evaluateRuleEffectiveness()`는 측정만. 삭제 없음 |

**원본:** 측정 → needs_promotion이면 HARD 승격. 그마저도 효과 없으면 삭제.  
**v3:** 측정 → effectiveness.status 필드만 기록. 액션 없음.

| 장점 | 단점 |
|------|------|
| 규칙 수 통제 | 측정만 하고 안 지우면 규칙이 무한 증식 가능 |
| 노이즈 제거 | 삭제 기준 자체가 잘못되면 좋은 규칙을 잃음 |
| — | 한번 삭제하면 복구 어려움 |

**이후 Step에서 보완 예정?** 명시적 언급 없음.

**오버엔지니어링 판정:**
Step 2에서는 규칙 수가 많지 않을 것. 30일 효과 측정 자체가 Step 2에 처음 도입되는 기능. "측정은 자동, 삭제는 수동"으로 시작하는 게 안전. 삭제 기준을 잘못 잡으면 복구 불가.

**판정:** "측정 자동 + 삭제 수동"이 적절. v3가 맞음. 나중에 규칙이 수십 개 이상 쌓이면 그때 자동 삭제 기준 추가.

---

### 갭 D: 에러 복구 4단계

| | 원본 (codex-integration) | v3 |
|--|----|----|
| 동작 | 1차 직접수정 → 2차 구조변경 → **3차 다른 모델 rescue** → 4차 리셋 | 없음 (오케스트레이션 레벨 기능) |

**원본 구조:**
1. 직접 수정 (타입 정의, import 경로, 로직 수정)
2. 구조 변경 (타입 가드, optional chaining, 대안 라이브러리)
3. **codex:rescue** — GPT-5.4에 위임, 완전히 다른 접근 시도
4. 리셋 (revert 후 다른 구현 방식 재시도)
→ 4차 실패 시 사용자 에스컬레이션 (텔레그램 알림)

**이후 Step에서 보완 예정?**
✅ **명시적으로 Step 4에 예정됨.**
- v3 5.2.2: "이중 모델 검증"으로 언급
- v3 7.1: cross-reviewer 에이전트 정의 (`model: "openai/gpt-5.4"`, `permissions: { "file_edit": "deny", "bash": "deny" }`)

**오버엔지니어링 판정:**
에러 복구 4단계는 **서브에이전트가 작업 실패했을 때**의 이야기. Step 2는 단일 에이전트 하네스. 지금 구현하려면 다른 모델 API 호출, 서브에이전트 에스컬레이션 전부 필요.

**판정:** Step 4에서 구현 예정. Step 2에서 불필요.

---

### 갭 E: 표면 UX (6개 명령 래핑)

| | 원본 (loopy-v2-surface-gap) | v3 |
|--|----|----|
| 동작 | `/loopy:start`, `auto`, `resume`, `status`, `history`, `measure` | 5.2.4에 `harness-status`, `harness-history`, `harness-eval` 명령어로 언급 |

**원본 분석 결과:**
- 3개는 기존 엔진 alias로 즉시 가능
- 1개(/loopy:status)는 alias + 출력 포맷 확장 필요
- 2개(/loopy:start, /loopy:auto)는 얇은 오케스트레이션 래퍼 필요 (~140줄)
- 총 구현 비용 ~200줄 / 3~4시간
- **엔진 개조가 아니라 표면 API 정의**

**이후 Step에서 보완 예정?**
✅ **명시적으로 v3 5.2.4에 예정됨.**

**오버엔지니어링 판정:**
하네스 엔진이 안정되기 전에 명령어를 만들면, 엔진 변경마다 명령어도 같이 수정해야 함. 명령어는 사용자 인터페이스이므로 내부가 안정화된 후 정의하는 게 맞음.

**판정:** Step 2 고도화에서. v3 타이밍이 맞음.

---

### 갭 F: 크로스세션 기억 7단계 중 상위 4단계

| | 원본 (memory-bank) | v3 |
|--|----|----|
| 전체 | Sync → Index → Search → **Extract → Consolidate → Relate → Recall** | 하위 3단계(Sync, Index, Search)만 5.2.1에 정의 |

**상위 4단계가 하는 일:**
- **Extract:** LLM 기반 fact 추출 (세션에서 결정/선호/제약을 자동 식별)
- **Consolidate:** 중복/충돌/진화 정리 (fact 품질 유지)
- **Relate:** Ontology 분류 + typed relation 연결 (그래프 구조)
- **Recall:** MCP 서버, CLI, UI 인터페이스 (다양한 회수 경로)

**이후 Step에서 보완 예정?**
✅ v3 5.2.1에 명시: *"상위 4단계는 하네스가 충분히 동작하여 데이터가 축적된 뒤에 구현"*

**오버엔지니어링 판정:**
- Extract → LLM API 호출 필요
- Consolidate → 복잡한 로직 (중복 감지, 충돌 해결, 진화 추적)
- Relate → 그래프 DB 또는 복잡한 인덱스 필요 가능
- Recall → MCP 서버 인터페이스 구현

하위 3단계(Sync, Index, Search)만으로도 `memory/archive/`에 JSONL 복사 + 키워드 기반 검색으로 충분한 가치 제공. 데이터 없이 상위 단계를 구현하는 게 진짜 오버엔지니어링.

**판정:** v3 범위가 적절. 데이터 먼저 축적.

---

### 갭 종합

| 갭 | v3 처리 | 이후 Step 보완 | 오버엔지니어링 |
|----|---------|---------------|---------------|
| A. Phase 단순화 | 의도적 단순화 | 간접 (Step 4) | 원본 복원이 오버엔지니어링 |
| B. Cross-Project 승격 | 의도적 제외 | 없음 | 명백한 오버엔지니어링 |
| C. Pruning | 측정만 | 없음 | 지금은 OK |
| D. 에러 복구 4단계 | 범위 밖 | Step 4 예정 | Step 2에서는 오버엔지니어링 |
| E. 표면 UX | 범위 밖 | 고도화 예정 | 엔진 먼저 |
| F. 기억 상위 4단계 | 의도적 제외 | 고도화 예정 | 데이터 먼저 |

**총평:** v3의 단순화가 전부 합리적. 원본을 그대로 구현하려는 게 오버엔지니어링.

---

## 4. 보완 포인트 분석 (4개)

v3 의사코드를 읽으면서 발견한 누락/보완 필요 항목. 각 항목의 출처(직접 발견 vs v3 요구 vs 오라클 제안)를 명시.

### 포인트 1: fix: 커밋 감지 로직

**출처:** 분석자 발견 (v3에 명시적 요구). 오라클 크로스 리뷰에서 "누락이 아니라 Loop 1 전체 미구현"으로 심각도 상향 (→ 오라클 리뷰 W1에서 상세).

**v3에 있는 것:**
- `signalToRule()`에 `fix_commit` case 존재 ✅
- 주석에 *"Step 2에서 구현"* 명시 ✅

**v3에 없는 것:**
- 실제 감지 로직 (`.git/COMMIT_EDITMSG` 읽기, `fix:` 접두사 확인, diff 추출)
- session.idle 핸들러에 fix: 커밋 감지 코드가 빠져있음 ❌
- **`fix_commit` signal을 생성하는 코드가 코드베이스 전체에 존재하지 않음** ❌

**구현 전 결정 필요사항 (오라클 리뷰 W1에서 추가 식별):**

| 결정 | 옵션 | 고려사항 |
|------|------|----------|
| git diff 실행 방식 | `child_process.execSync` vs `ctx` 메서드 | OpenCode 플러그인 샌드박스에서 execSync 허용 여부 |
| 패턴 추출 전략 | 파일 경로? 변경된 심볼? 에러 메시지? | pattern.match에 무엇을 넣을지 |
| 다중 커밋 처리 | 마지막 1개만? 세션 내 전체? | `COMMIT_EDITMSG`는 마지막 커밋만 담음 |

**COMMIT_EDITMSG 신뢰성 이슈 (오라클 리뷰 W1):**
1. 마지막 커밋 메시지만 담음 → 세션 내 여러 커밋 시 첫 번째 것만 잡힘
2. 커밋 완료 후에도 파일이 남아있을 수도, 아닐 수도 있음 (git 구현 의존)
3. v3 858행은 `file.edited` 이벤트로 감지한다고 하고, 868행은 `session.idle`에서 `COMMIT_EDITMSG`를 읽는다고 함 — 두 설명 충돌

**오라클 권장:** `git log --since=<session_start>`로 세션 내 모든 커밋을 조회. 이를 위해 observer가 `session.created` 시 타임스탬프를 기록해야 함.

**오버엔지니어링 판정:** ❌ 필수 기능. 이것 없으면 Loop 1 (실수 학습)이 동작하지 않음.

**Step 2 포함 여부:** ✅ 포함

---

### 포인트 2: 규칙 Rollback 메커니즘

**출처:** 분석자 제안. v3에 없음. 오라클 리뷰에서도 제외에 동의.

**원본 참고:** codex-loop-era-l6에 snapshot 기반 rollback 존재.

**문제 시나리오:**
잘못 승격된 HARD 규칙 → history.jsonl로 추적은 되지만 되돌릴 방법 없음 → 수동으로 `rules/hard/{id}.json` 삭제해야 함.

**자동 rollback 구현 시 필요한 것:**
1. 규칙 변경 전 snapshot 저장 (매 변경마다 파일 복사)
2. rollback 트리거 조건 정의 (언제 되돌리나?)
3. rollback 로직 자체 (이것도 버그 가능 → rollback의 rollback을 고민하게 됨)

**구현 시 차이:**
| 없으면 | 있으면 |
|--------|--------|
| 잘못된 HARD 차단 → 수동 파일 삭제 (1분) | 자동 복원 |
| history.jsonl은 있지만 "언제 누가 지웠는지" 추적 안 됨 | rollback 이력도 기록 |
| "규칙 꼬여서 harness 전체 리셋" 가능성 | 안전장치 |

**오버엔지니어링 판정:**
Step 1→2 전환 직후엔 규칙 수가 한자리 수. 수동 삭제로 1분이면 해결. rollback 로직 자체의 버그가 더 위험할 수 있음.

**Step 2 포함 여부:** ❌ 제외. 대신 `history.jsonl`에 충실한 기록만 남기고 수동 복원. 나중에 규칙 수십 개 이상 쌓이면 그때 자동화 고려.

---

### 포인트 3: Signal 중복 처리

**출처:** 분석자 제안. v3에 없음. 오라클 크로스 리뷰에서 `hard/` 디렉토리도 확인하도록 범위 확장 권고 (→ 오라클 리뷰 W2).

**문제 시나리오:**
```
Session A: error_repeat signal 생성 (pattern: "TypeError: ...")
Session B: 동일 에러로 error_repeat signal 또 생성
→ pending에 동일 패턴 signal 2개
→ improver가 각각 처리 → 동일 패턴 SOFT 규칙 2개
→ enforcer가 둘 다 매칭 → violation_count가 각각 증가
→ promoteRules가 둘 다 HARD로 승격
→ 동일한 HARD 규칙 2개 중복
```

**실제 발생 가능성:**
```
단일 에이전트 (Step 1~2):
  → session.idle이 세션 끝날 때 발동
  → observer의 errorCounts Map이 세션 내 중복 통제
  → 세션 간에는 pending이 session.idle에서 처리되어 ack로 이동
  → 중복 가능성: 낮음

멀티 에이전트 (Step 4):
  → 서브에이전트들이 동시에 pending에 signal 쌓음
  → improver의 session.idle이 각각 발동
  → 중복 가능성: 높음
```

**제안 내용:**
`signalToRule()`에서 규칙 생성 전, 동일 `pattern.match`가 이미 존재하는지 체크. 완전 일치 매칭만. 유사도 기반 퍼지 매칭은 제외.

**오라클 리뷰 W2에서 식별한 추가 시나리오:**
```
1. 에러 반복 → SOFT 규칙 A 생성 (pattern.match = "TypeError: ...")
2. 위반 2회 → A가 HARD로 승격 (soft/a.json → hard/a.json 이동)
3. 동일 에러 발생 → 동일 signal → signalToRule() → SOFT 규칙 B 생성 (동일 pattern.match)
4. 동일 패턴에 HARD 규칙 A와 SOFT 규칙 B 공존
5. B도 HARD로 승격 → 동일 패턴 HARD 2개 중복
```

**결론:** 중복 체크 범위를 `soft/` + `hard/` **모두**로 확장 필요.

```typescript
// 구현 예시:
function ruleExists(pattern: string, projectKey: string): boolean {
    for (const type of ['soft', 'hard']) {  // ← 둘 다 체크
        const dir = join(HARNESS_DIR, `rules/${type}`);
        // ... pattern.match 비교
    }
}
```

**구현량:** ~20줄 (원안 15줄에서 hard/ 체크 추가)

**구현 시 차이:**
| 없으면 | 있으면 |
|--------|--------|
| 동일 패턴 HARD 규칙 N개 중복 가능 | 규칙당 1개 보장 (idempotent) |
| violation_count가 분산 → 승격 지연 | 정확한 위반 추적 |
| enforcer가 N번 매칭 → 의미 없는 다중 차단 | 깔끔한 단일 차단 |

**오버엔지니어링 판정:**
- ✅ 완전 일치 매칭만: ~20줄, 복잡도 낮음, 방어적 코딩의 기본 → **포함**
- ❌ 유사도 기반 퍼지 매칭: 정규식 복잡도, false positive → **오버엔지니어링**
- ❌ LLM 기반 중복 판정: API 호출, 비결정성 → **오버엔지니어링**

**Step 2 포함 여부:** ✅ 포함 (완전 일치 매칭, soft+hard 양쪽 체크)

---

### 포인트 4: Compacting에서 scaffold 없을 때

**출처:** v3 의사코드에 이미 처리됨. 갭이 아닌 확인 항목.

v3 의사코드 962~974행에서 `projects/{projectKey}/scaffold.md` 존재 여부 체크 후 주입.

**Step 2 포함 여부:** N/A (이미 처리됨)

---

## 5. 오라클 크로스 리뷰

**리뷰어:** @oracle (독립 코드 리뷰)  
**리뷰 대상:** 본 문서의 초안 (당시 step2-reference-analysis.md, step2-v3-gap-analysis.md)  
**결과:** v3 의사코드 자체의 버그 2건 발견 + 설계 이슈 다수

### 🔴 CRITICAL — 1건

#### C1. `event` 훅 덮어쓰기 버그 (v3 의사코드 자체의 버그)

**발견자:** 오라클

**문제:**
observer와 improver가 **둘 다 `event` 훅**을 등록합니다. 현재 `index.ts`는 스프레드 연산자로 병합:

```typescript
// Step 2에서 improver 추가 시:
return { ...observerHooks, ...enforcerHooks, ...improverHooks };
```

observer와 improver 모두 `event` 키를 가진 객체를 반환. **스프레드 연산자는 나중 것이 앞의 것을 덮어씀.** observer의 `event` 핸들러가 완전히 사라짐.

**영향:**
- observer의 session.error → 에러 반복 감지 동작 안 함
- observer의 file.edited → 파일 편집 로깅 동작 안 함
- observer의 message.part.updated → 불만 키워드 감지 동작 안 함
- **Step 2 배포 시 Step 1이 고장남**

**해결 방법 (3가지 옵션):**

| 옵션 | 방법 | 장단점 |
|------|------|--------|
| A (권장) | `mergeEventHandlers` 유틸리티로 event 핸들러 배열 병합 | 명시적, 테스트 가능, 단일 패키지 원칙 유지 |
| B | 각 플러그인의 event 핸들러를 하나의 함수로 합침 | 간단하지만 플러그인 독립성 훼손 |
| C | 각 플러그인을 별도 파일로 분리하여 OpenCode가 독립 로드 | 단일 패키지 원칙 위반 |

**v3 가이드 수정 필요:** 이건 분석 문서가 아니라 v3 가이드 자체의 버그.

---

### 🟡 WARNING — 5건

#### W1. `fix_commit` 파이프라인 전체 미구현

**발견자:** 오라클

**기존 인식 (본 분석):** "감지 로직이 누락됨" (보완 포인트 1)

**실제 상황 (오라클 판정):** 누락이 아니라 **Loop 1 전체가 미구현 상태**.

- `types.ts`에 `fix_commit` signal type 정의됨 ✅
- `signalToRule()`에 `fix_commit` case 있음 ✅
- **`fix_commit` signal을 생성하는 코드가 코드베이스 전체에 없음** ❌

**COMMIT_EDITMSG 신뢰성 이슈:** (→ 보완 포인트 1에 반영)

#### W2. Signal 중복 체크 시 `hard/` 디렉토리도 확인 필요

**발견자:** 오라클

SOFT→HARD 승격 후 동일 패턴의 SOFT 규칙이 재생성되는 시나리오 식별. (→ 보완 포인트 3에 반영하여 체크 범위를 soft+hard로 확장)

#### W3. `violation_count` 누적값 버그 (v3 의사코드 자체의 버그)

**발견자:** 오라클

**문제:**
`evaluateRuleEffectiveness()`가 30일 경과 규칙의 `violation_count`를 읽어 effectiveness를 판정. 하지만 `violation_count`는 **규칙 생성 이후 누적값**.

**시나리오:**
```
규칙 생성 직후 위반 3회 (violation_count = 3)
→ 30일 동안 재발 0회
→ evaluateRuleEffectiveness() 판정: recurrence = 3 → needs_promotion
→ 실제로는 30일간 효과적이었으나 needs_promotion 판정 (잘못됨)
```

**v3 의사코드 (line 1092):**
```typescript
const recurrence = rule.violation_count;  // ← 전체 누적값
```

**해결 옵션:**

| 옵션 | 방법 | 장단점 |
|------|------|--------|
| A | `promoteRules()`가 HARD 승격 시 `violation_count` 리셋 | 자연스러움 (HARD 이동 = 새 시작). 하지만 과거 이력이 사라짐 |
| B | effectiveness 측정 시 delta 사용 (현재값 - 마지막 측정값) | 정확. `effectiveness.last_measured_count` 필드 추가 필요 |
| C | 측정 기준을 violation_count가 아닌 측정 기간 내 위반 로그로 변경 | 가장 정확하지만 구현 복잡 |

**권장:** 옵션 A (승격 시 리셋) + 옵션 B (delta) 결합. HARD로 이동하는 순간 카운터 초기화, 30일 측정은 마지막 측정 이후 delta만 카운트.

#### W4. 파일 I/O 경쟁 조건

**발견자:** 오라클

**문제:**
improver의 `session.idle` 핸들러에서:
1. pending signal 파일 읽기
2. signal → rule 생성 (write)
3. signal을 ack로 이동 (write + unlink)

프로세스가 1~3 사이에 죽으면: **rule은 생성되었지만 signal이 ack로 이동하지 못함** → 다음 session.idle에서 같은 signal 재처리 → 중복 규칙 생성.

**완화 전략:**

| 전략 | 방법 | 장단점 |
|------|------|--------|
| (a) Write-ahead | 먼저 ack 이동 → rule 생성 | 손실은 있지만 중복 없음 |
| (b) Idempotency 보장 | W2 중복 체크가 있으므로 재시도해도 안전 | 중복 체크 구현에 의존 |

**권장:** 전략 (b). W2의 중복 체크(ruleExists)가 있으면 재시도가 멱등성 보장. 의식적인 선택으로 명시.

#### W5. Improver의 ack가 "자가 채점" 문제를 가짐

**발견자:** 오라클

**문제:**
v3 의사코드에서 improver가 signal을 처리하고 규칙을 생성한 뒤 ack로 이동. 이때 ack의 기준이 **"파일 쓰기 성공"** 임. 이건 acceptance plane 없이 무조건 ack하는 것과 같음.

원본(codex-loop-era-l6)에서는 이 문제를 "arbitrary shell verification 제거 + 제한된 check type만 허용"으로 해결.

**실제 리스크:** 낮음. improver는 외부 검증 없이 규칙을 생성하므로 "거짓 ack"보다는 **"잘못된 규칙의 ack"**가 문제. 하지만 이건 규칙 품질 문제이지 ack 프로토콜 문제가 아님.

**권장:** Step 2에서는 현재 설계 유지. 고도화에서 규칙 품질 검증(harness-eval) 도입 시 ack 조건 강화.

---

### 🔵 INFO — 4건

#### I1. Loop 3의 `needs_promotion` 상태 소비자 없음

**발견자:** 오라클

`evaluateRuleEffectiveness()`가 `needs_promotion` 상태를 기록하지만, 이 상태를 읽어서 액션을 취하는 코드가 없음. `promoteRules()`는 별도로 `violation_count >= 2`로만 승격. 측정은 하되 액션은 안 함. 의도된 것일 수 있지만 명시 필요.

#### I2. Compacting 토큰 한계 미고려

**발견자:** 오라클

`experimental.session.compacting` 훅에서 scaffold + HARD 규칙 + SOFT 규칙을 전부 주입하는데, 규칙이 수십 개 이상 쌓이면 컨텍스트가 과부하됨. 토큰 제한 고려 없음. Step 2 초기엔 규칙 수가 적어 문제없음. 고도화에서 우선순위 기반 선택적 주입 필요.

#### I3. `updateProjectState()`가 `project_path` 필드 누락

**발견자:** 오라클

`ProjectState` 타입(types.ts)이 `project_path` 필드를 가지지만, v3 의사코드의 `updateProjectState()`는 이 필드를 기록하지 않음. 경미한 불일치. 구현 시 `project_path: ctx.worktree` 추가하면 됨.

#### I4. `history.jsonl` 무한 증식

**발견자:** 오라클

규칙 생성/승격/삭제 이력을 append-only로 기록. 파일이 무한히 커짐. 규칙 수가 적어도 이력은 계속 쌓임. Step 2에서는 무시. 나중에 로테이션 또는 사이즈 기반 정리 필요.

---

## 6. V3 의사코드 충실도 재평가

초기 평가 후 오라클 크로스 리뷰 결과를 반영하여 재평가.

| 항목 | 초기 판정 | 재평가 | 변경 이유 |
|------|----------|--------|----------|
| Loop 1 (fix: 커밋) | ⚠️ 감지 로직 누락 | 🔴 **전체 미구현** | 오라클 W1: signal 생성 코드 자체가 없음 |
| Loop 2 (불만→규칙) | ✅ 충실 | ✅ 충실 | 변경 없음 |
| Loop 3 (30일 측정) | ✅ 충실 | ⚠️ **버그 있음** | 오라클 W3: violation_count 누적값으로 판정 → 잘못된 결과 |
| SOFT→HARD 승격 | ✅ 충실 | ⚠️ **부분 충실** | 오라클 I1: `promoteRules`는 violation_count≥2, `evaluateRuleEffectiveness`는 별도 기준. 두 로직이 서로 다른 기준으로 동작. 승격 시 카운터 리셋 없음 |
| 컨텍스트 주입 | ✅ 충실 | ⚠️ **주의** | 오라클 I2: 규칙 수십 개 시 토큰 한계 도달 가능 |
| 프로젝트 상태 | ✅ 충실 | ⚠️ **경미** | 오라클 I3: project_path 필드 누락 |
| event 훅 병합 | (평가 안 됨) | 🔴 **v3 버그** | 오라클 C1: 스프레드 연산자로 인해 observer event 핸들러 소실 |

**v3 의사코드 자체의 버그 (2건):**
1. **event 훅 덮어쓰기** — 구현 시 반드시 수정 필요 (C1)
2. **violation_count 누적값** — 구현 시 반드시 수정 필요 (W3)

---

## 7. Step 2 구현 범위 최종 확정

### 기본 (MUST) — Step 2 본체

```
1. improver.ts 플러그인 구현
   ├── signalToRule() — signal→SOFT 규칙 자동 변환
   │   └── ruleExists() — 중복 체크 (soft+hard 양쪽) ← 보완 포인트 3 + 오라클 W2
   ├── promoteRules() — violation_count≥2 → HARD 승격
   │   └── 승격 시 violation_count 리셋 ← 오라클 W3
   ├── evaluateRuleEffectiveness() — 30일 효과 측정
   │   └── delta 기반 측정 (누적값 대신 마지막 측정 이후 증분) ← 오라클 W3
   └── updateProjectState() — state.json 갱신
       └── project_path 필드 추가 ← 오라클 I3

2. experimental.session.compacting 훅
   ├── scaffold 주입
   ├── HARD 규칙 주입
   └── SOFT 규칙 주입 (scope:prompt 유일 강제 수단)

3. Loop 1 — fix: 커밋 학습
   └── session.idle 시 세션 내 fix: 커밋 감지 ← 보완 포인트 1 + 오라클 W1
       └── COMMIT_EDITMSG 또는 git log --since 활용
       └── fix: 접두사 → diff 분석 → signal 생성

4. index.ts 수정
   ├── improver export 추가
   └── event 훅 병합 유틸리티 (mergeEventHandlers) ← 오라클 C1

5. 공유 유틸리티 확장
   └── shared/에 mergeEventHandlers 추가 ← 오라클 C1
```

### 구현 시 의식적 선택사항

| 항목 | 선택 | 근거 |
|------|------|------|
| 파일 I/O 경쟁 조건 | idempotancy 보장 (중복 체크로 완화) | 오라클 W4: 전략 (b) |
| ack 자가 채점 | 현재 설계 유지 | 오라클 W5: 리스크 낮음 |
| needs_promotion 소비자 | 없음 (측정만) | 오라클 I1: 의식적 선택 |
| Compacting 토큰 한계 | 현재 무시 | 오라클 I2: 규칙 수 적음 |

### 고도화 (LATER)

| 항목 | v3 섹션 | 예상 시점 |
|------|---------|----------|
| 크로스세션 기억 (memory-bank 하위 3단계) | 5.2.1 | Step 2 안정화 후 |
| 이중 모델 검증 (cross-reviewer) | 5.2.2 | Step 4 |
| 외부 트렌드 자동 수집 | 5.2.3 | 가장 마지막 |
| 표면 UX 래핑 (commands/) | 5.2.4 | 엔진 안정화 후 |
| 규칙 자동 삭제 (Pruning) | 없음 | 규칙 수십 개 이상 시 |
| history.jsonl 로테이션 | 없음 | 파일 크기 문제 시 |

---

## 8. 구현 시 반영 체크리스트

| 심각도 | 항목 | 발견자 | 반영 위치 | 상태 |
|--------|------|--------|----------|------|
| 🔴 CRITICAL | event 훅 덮어쓰기 | 오라클 | index.ts + shared 유틸리티 | ❌ 구현 전 해결 필요 |
| 🔴 CRITICAL | fix_commit 전체 파이프라인 미구현 | 분석자 + 오라클 | improver.ts | ❌ 설계 결정 + 구현 필요 |
| 🟡 WARNING | violation_count 누적값 버그 | 오라클 | improver.ts (promoteRules, evaluate) | ❌ v3 버그 수정 |
| 🟡 WARNING | 중복 체크 hard/ 포함 | 분석자 + 오라클 | improver.ts (signalToRule) | ❌ 보완 포인트 3 수정 |
| 🟡 WARNING | 파일 I/O 경쟁 조건 | 오라클 | improver.ts (session.idle 핸들러) | ⚠️ 중복 체크로 완화 |
| 🟡 WARNING | ack 자가 채점 | 오라클 | improver.ts | ⚠️ 현재 설계 유지 |
| 🔵 INFO | needs_promotion 소비자 없음 | 오라클 | — | ℹ️ 인지 |
| 🔵 INFO | Compacting 토큰 한계 | 오라클 | improver.ts (compacting 훅) | ℹ️ 인지 |
| 🔵 INFO | project_path 누락 | 오라클 | improver.ts (updateProjectState) | ℹ️ 구현 시 추가 |
| 🔵 INFO | history.jsonl 증식 | 오라클 | — | ℹ️ 나중에 |

---

## 9. 구현 완료 기록 (2026-04-11)

> **상태:** Step 2 구현 완료. 스모크 테스트 29/29 통과.

### 구현된 파일

| 파일 | 변경 유형 | 주요 내용 |
|------|----------|----------|
| `src/harness/improver.ts` | 신규 (~280줄) | L5 자가개선 + L6 폐루프. signalToRule, promoteRules, evaluateRuleEffectiveness, detectFixCommits, updateProjectState, compacting |
| `src/index.ts` | 수정 | improver import 추가 + mergeEventHandlers로 event 훅 병합 (C1 수정) |
| `src/shared/utils.ts` | 수정 | mergeEventHandlers 함수 추가 (v3 버그 C1 해결) |
| `src/shared/index.ts` | 수정 | mergeEventHandlers re-export |
| `src/harness/observer.ts` | 수정 | session.created 이벤트에서 타임스탬프 기록 (fix: 커밋 감지용) |

### 체크리스트 최종 상태

| 심각도 | 항목 | 발견자 | 반영 위치 | 상태 |
|--------|------|--------|----------|------|
| 🔴 CRITICAL | event 훅 덮어쓰기 | 오라클 | index.ts + shared/utils.ts | ✅ mergeEventHandlers로 해결 |
| 🔴 CRITICAL | fix_commit 전체 파이프라인 미구현 | 분석자 + 오라클 | improver.ts detectFixCommits() | ✅ git log --since로 구현 |
| 🟡 WARNING | violation_count 누적값 버그 | 오라클 | improver.ts promoteRules + evaluate | ✅ 승격 시 리셋 + delta 기반 |
| 🟡 WARNING | 중복 체크 hard/ 포함 | 분석자 + 오라클 | improver.ts ruleExists() | ✅ soft+hard 양쪽 체크 |
| 🟡 WARNING | 파일 I/O 경쟁 조건 | 오라클 | improver.ts session.idle | ✅ 중복 체크로 멱등성 보장 |
| 🟡 WARNING | ack 자가 채점 | 오라클 | improver.ts | ⚠️ 현재 설계 유지 (의식적 선택) |
| 🔵 INFO | needs_promotion 소비자 없음 | 오라클 | — | ℹ️ 측정만, 액션은 수동 |
| 🔵 INFO | Compacting 토큰 한계 | 오라클 | improver.ts | ℹ️ 규칙 수 적어 현재 무시 |
| 🔵 INFO | project_path 누락 | 오라클 | improver.ts updateProjectState | ✅ project_path: ctx.worktree 추가 |
| 🔵 INFO | history.jsonl 증식 | 오라클 | — | ℹ️ 나중에 로테이션 |

---

## 10. Step 3 계획 — 형님과의 논의 결과 (2026-04-11)

> Step 2 완료 후, 간소화/패싱된 항목의 단계별 배치를 논의하여 확정.

### 논의 결정 사항

#### 제외 확정 (불필요)

| 항목 | 결정 | 이유 |
|------|------|------|
| 인터페이스 계약 확정 (명시적) | **안함** | types.ts + 파일 구조가 이미 계약. Step 1~2가 이 계약으로 잘 돌아가고 있음. "명시적"으로 바꾼다는 게 실제로는 문서 정리일 뿐 코드 변경 없음 |
| harness-status / harness-eval 도구 | **안함** | `cat state.json`으로 충분. 규칙 수십 개 쌓이면 그때 |
| Cross-Project 승격 | **안함** | 단일 프로젝트 환경. 필요해지면 그때 |

#### Step 3에서 구현

| 항목 | 이유 |
|------|------|
| **.opencode/rules/ 병행** | scope:prompt 규칙이 세션 시작부터 노출되어야 함. compacting은 긴 세션에서만 발동 |
| **크로스세션 기억 하위 3단계** (Index, Search) | Sync는 observer가 이미 함. Index(JSONL→키워드 인덱스) + Search(키워드 기반 회수)만 추가 |
| **history.jsonl 로테이션** | 10줄 수준의 간단한 유틸. 파일 무한 증식 방지 |

#### Step 4에서 구현 (오케스트레이션)

| 항목 | v3 섹션 |
|------|---------|
| 에러 복구 4단계 | 5.2.2 |
| 이중 모델 검증 (cross-reviewer) | 5.2.2, 7.1 |
| 5-Phase 워크플로우 | 7장 |
| Phase 2.5 gate | 7장 |
| 서브에이전트 정의 | 7.1 |

#### Step 4 이후 (데이터/안정성 선행)

| 항목 | 선행 조건 |
|------|----------|
| 크로스세션 기억 상위 4단계 (Extract, Consolidate, Relate, Recall) | 데이터 충분히 축적 후 |
| 규칙 자동 삭제 (Pruning) | 규칙 수십 개 이상 쌓일 때 |
| Compacting 토큰 한계 대응 (선택적 주입) | 규칙 수십 개 시 |
| 외부 트렌드 자동 수집 | 하네스 완전 안정화 후, 가장 마지막 |

#### 간소화 항목 (#A, #B) — 데이터 축적 후

| 항목 | 결정 | 이유 |
|------|------|------|
| #A LLM 기반 Phase 구조 | **데이터 축적 후** | LLM 비용이 문제가 아니라 비결정성과 복잡도가 문제. deterministic 매핑으로 실제 "틀린 규칙" 패턴을 먼저 파악해야 LLM 프롬프트를 제대로 작성 가능 |
| #B LLM 기반 signal 판정 | **데이터 축적 후** | 동일. deterministic vs LLM 품질 비교 기준이 있어야 개선 효과 측정 가능 |

**타이밍:** Step 3에서 데이터 쌓고 → Step 4 이후에서 LLM 기반 판정 도입.

#### 실동작 테스트에서 발견한 후속 이슈

| 항목 | 내용 | 상태 |
|------|------|------|
| fix: 커밋 패턴 추출 품질 | `detectFixCommits()`에서 `git log --name-only` 출력 파싱이 완벽하지 않음. `source_file`이 빈 문자열로 나오고, `pattern`에 파일 경로 대신 커밋 메시지가 들어감. 파일 경로 기반 추출 로직 보강 필요 | Step 3 고도화 |
| git log 포맷 의존성 | `--format="%H|||%s|||" --name-only` 출력이 git 버전/설정에 따라 다를 수 있음. `--name-only`가 각 커밋 블록 아래에 파일 목록을 출력하는데, `split('\n\n')` 기반 파싱이 깨지는 케이스 존재 | Step 3 고도화 |