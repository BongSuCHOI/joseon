## Context

Step 5a에서 모든 deterministic phase/signal 판정을 `phase-signal-shadow.jsonl`에 기록하는 그림자 로깅을 구현했다. 하지만 shadow block은 항상 stub(`status: 'unavailable'`, `confidence: 0`)이며, 이 데이터를 읽거나 분석하는 코드가 전혀 없다.

탐색에서 확인한 핵심 제약: **OpenCode Plugin API에서 LLM을 직접 호출할 수 없다.** 훅은 `input`/`output`만 받고 LLM 접근점이 없다. 따라서 canary는 LLM 없이 메타데이터만으로 판정해야 한다. 이는 compacting shadow의 `rankSemanticSoftRules()`가 이미 증명한 패턴이다.

상세 탐색 결과는 `docs/step4-post-enhancements.md`의 "Step 5f 탐색 결과" 섹션에 기록되어 있다.

## Goals / Non-Goals

**Goals:**
- deterministic 판정의 경계 상황(저신뢰도 프록시)을 자동 식별
- 메타데이터 기반으로 `phase_hint`, `signal_relevance`, `confidence` 산출
- deterministic vs canary mismatch를 감지하고 집계
- 향후 LLM 기반 판정(D: 서브에이전트 위임, E: tmux 외부 세션) 승격의 근거 수집

**Non-Goals:**
- LLM 호출 (A안: 메타데이터 전용. D/E 승격은 향후)
- deterministic 판정 경로 수정 (canary는 읽기 전용)
- 실시간 orchestrator 프롬프트 주입 (③안, premature)
- `canary_enabled=false`에서의 동작 변화 (zero-impact 보장)

## Decisions

### D1: 메타데이터 전용 (A안) — LLM 없이 canary 평가

**선택**: 메타데이터 기반 산출
**대안**: B(프롬프트 인젝션), C(외부 API), D(서브에이전트 위임), E(tmux 외부 세션)
**근거**:
1. 플러그인 훅에서 LLM 직접 호출 불가
2. compacting shadow의 `rankSemanticSoftRules()`가 LLM 없이도 유의미한 결과를 이미 증명
3. shadow 단계에서 LLM 오류와 canary 오류를 분리할 수 없음 → 메타데이터가 안전
4. 향후 D/E로 승급하는 자연스러운 경로 존재

### D2: 저신뢰도 프록시 4가지

phase/signal 판정 중 다음 4가지 상황만 canary 평가 대상:

| 프록시 | 종류 | 근거 |
|--------|------|------|
| Phase 2.5 gate BLOCKED | phase | agent가 Phase 3 원했는데 deterministic이 막음 |
| Phase 역행 (from > to) | phase | 정방향이 보통, 역행은 예외적 |
| user_feedback signal 발생 | signal | 한국어 키워드 매칭은 근본적으로 noisy |
| error_repeat count=2 (임계값 직전) | signal | 사전 경보 역할, "곧 반복 에러인데 미리 알아야 하나?" |

**대안**: 전수(A), 샘플링(C). 전수는 자명한 판정에 토큰/계산 낭비, 샘플링은 edge case 놓침.

### D3: 출력 = mismatch 로그 + 집계 리포트

**선택**: `canary-mismatches.jsonl` + 온디맨드 집계 함수
**대안**: ① 로그만, ③ 로그 + orchestrator 주입
**근거**: shadow의 목적은 승격 근거 수집. 로그만(①)은 아무도 안 읽고, 주입(③)은 premature. 집계 리포트가 있어야 "승격할까?"를 데이터로 결정.

### D4: 컨텍스트 = 최근 10개 shadow 레코드

canary 평가 시 `phase-signal-shadow.jsonl`에서 최근 10개 레코드를 읽어 컨텍스트로 사용. 메타데이터 산출이므로 LLM 토큰 비용은 없고, 파일 I/O만 발생.

### D5: 메타데이터 canary 평가 산출 방식

LLM 없이 다음 값을 산출:

**phase_hint** (phase 전환에만):
- `"forward"` — 정방향 전환 (from < to)
- `"blocked_gate"` — Phase 2.5 gate에서 차단
- `"regression"` — 역행 (from > to)
- `"same"` — 동일 phase (no-op)
- `"reset"` — Phase 5 후 초기화

**signal_relevance** (signal에만):
- `"high"` — user_feedback + 키워드가 2개 이상 매칭, 또는 error_repeat count ≥ 2
- `"medium"` — user_feedback + 키워드 1개, 또는 fix_commit 감지
- `"low"` — threshold 미달 (count < 2 for error, 키워드 없음 for feedback)
- 기존 emit 여부와 무관하게 독립 산출

**confidence** (공통):
- 직전 N개 레코드에서 동일 프록시 상황의 빈도로 산출
- 자주 발생(≥5회) → 낮은 confidence (일상적)
- 드물게 발생(<3회) → 높은 confidence (예외적)
- 범위: 0.0 ~ 1.0

### D6: 파일 배치

```
~/.config/opencode/harness/
  └── projects/{key}/
      ├── phase-signal-shadow.jsonl      ← 기존 (5a)
      └── canary-mismatches.jsonl         ← 신규 (5f)
```

canary 평가 결과는 기존 `phase-signal-shadow.jsonl`의 shadow block을 갱신.
mismatch만 별도 파일에 기록.

## Risks / Trade-offs

| 위험 | 완화 |
|------|------|
| 메타데이터 한계: "왜이래"가 감탄인지 불만인지 구분 불가 | → A안의 알려진 한계. mismatch 로그로 케이스 수집 후 D/E 승격으로 해결 |
| canary 평가가 hook 응답 시간에 미치는 영향 | → 파일 읽기 10개 레코드 + 메타데이터 계산은 <1ms. 무시 가능 |
| canary_enabled=true 설정 시 예기치 않은 동작 | → default: false. 명시적 설정 필요 |
| shadow block 갱신이 append-only 원칙 위반? | → 기존 레코드를 수정하지 않음. canary 평가 결과는 새 레코드로 append (shadow block이 채워진 버전) |

## Migration Plan

1. 배포: `canary_enabled` default: false → 기존 동작 zero-impact
2. 옵트인: `harness.jsonc`에 `canary_enabled: true` 설정
3. 데이터 수집: `canary-mismatches.jsonl` 축적
4. 검토: 집계 리포트로 mismatch 패턴 분석
5. 승격 결정: D(서브에이전트) 또는 E(tmux) 전환 여부 판단

롤백: `canary_enabled: false` 설정 또는 필드 제거 → 즉시 기존 동작 복원.
