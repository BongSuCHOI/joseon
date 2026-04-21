## Context

현재 하네스의 Observer(L1)는 3개 신호(error_repeat, user_feedback, fix_commit)만 감지한다. Memory 7단계 중 Recall(L7)은 미구현 상태이며, compacting 때 모든 관련 fact를 전체 내용(~200 토큰/fact)으로 주입한다. MemoryFact 모델에는 접근 추적·TTL 필드가 없어, 구식 fact가 무한정 누적된다.

token-optimizer(#2)의 낭비 탐지기와 token-savior(#4)의 점진적 공개·TTL 패턴을 우리 하네스 아키텍처에 맞게 흡수한다. 핵심 제약: OpenCode 플러그인 API에서 실제 토큰 수를 알 수 없으므로, 프록시 메트릭(툴 호출 횟수, 반복 패턴)을 사용해야 한다.

## Goals / Non-Goals

**Goals:**
- Observer에 3개 프록시 기반 낭비 탐지 신호를 추가하여 기존 Signal→Rule 파이프라인을 강화
- Memory Recall(L7)을 3계층 점진적 공개로 구현하여 compacting 주입 토큰 ~70-90% 절감
- Fact에 접근 추적·TTL을 추가하여 미사용 fact를 자동 정리

**Non-Goals:**
- 실제 토큰 수 계산/추정 (OpenCode API 제약으로 불가)
- Bayesian validity (데이터 포인트 부족으로 과잉 설계)
- 심볼 스테일니스/content hash 기반 fact 무효화 (fact 수가 적어 비용 > 이득)
- QJL 스케치 유령 토큰 감지 (아직 문제가 발생하지 않음)
- 컴팩션 의미 추출 (OpenCode가 담당, 우리는 이미 semantic ranking 중)

## Decisions

### Decision 1: 프록시 메트릭 기반 낭비 탐지

**선택:** 툴 호출 횟수·패턴을 프록시로 사용
**대안:** 실제 토큰 수 기반 (OpenCode API 미지원으로 불가)
**이유:** `tool.execute.after`에서 tool 이름, args, 세션 내 누적 호출을 추적할 수 있다. 이걸로 "동일 툴+args 반복", "연속 에러→재시도", "동일 파일 반복 읽기"를 감지한다. 신호 품질은 토큰 기반보다 낮지만, 기존 Signal→Rule 파이프라인에 그대로 태울 수 있어 구현 비용이 낮다.

### Decision 2: 3계층 점진적 공개를 compacting 주입에 직접 적용

**선택:** Layer 1(인덱스 ~15 토큰)을 항상 주입, Layer 2/3는 조건부
**대안 A:** 모든 fact를 전체 내용으로 주입 (현재 방식, 토큰 낭비)
**대안 B:** fact를 압축된 형태로만 주입 (정보 손실 위험)
**이유:** 현재 compacting에서 fact 5개 × ~200 토큰 = ~1,000 토큰을 항상 주입. Layer 1만 주입하면 5개 × ~15 토큰 = ~75 토큰으로 줄어든다. LLM이 상세 내용이 필요하면 `memory_get` 형태로 다음 턴에서 요청하는 패턴은 OpenCode 플러그인 API에서 구현 불가(별도 툴 제공 불가)하므로, compacting 시점에 어느 계층까지 주입할지를 `semantic_compacting_enabled` 설정과 점수로 결정한다.

구체적 주입 로직:
- 점수 상위 30% fact → Layer 3 (전체 내용)
- 점수 중간 40% fact → Layer 2 (요약: keywords + 첫 문장)
- 점수 하위 30% fact → Layer 1 (인덱스: id + keywords만)

### Decision 3: 간단한 임계값 기반 TTL (Bayesian 제외)

**선택:** TTL 기본값 30일 + access_count ≥ 5 → TTL 2배 연장 + 30일 미접속 → prune 후보
**대안:** Bayesian 사전 확률 + 모순 감지 (token-savior 방식)
**이유:** 우리 fact는 현재 접근 추적이 없어서 Bayesian에 필요한 데이터가 부족함. 임계값 기반은 구현 단순, 기존 markPruneCandidates() 패턴과 일치, fact가 50개 이상 쌓이면 그때 Bayesian 고려.

### Decision 4: 하위 호환성 — 새 필드는 옵셔널

**선택:** MemoryFact에 `last_accessed_at?: number`, `access_count?: number` 추가
**이유:** 기존 fact 파일에 새 필드가 없어도 기본값(last_accessed_at=created_at, access_count=0)으로 동작. 마이그레이션 스크립트 불필요.

## Risks / Trade-offs

**[프록시 메트릭 정확도]** → tool_loop 임계값을 보수적으로 설정(동일 툴+args 5회 이상)하여 false positive 최소화. 캐나리 평가로 신호 품질 모니터링.

**[점진적 공개 정보 손실]** → 상위 30%는 여전히 전체 내용을 주입하므로 핵심 fact는 유지. 캐나리 평가로 compacting 전후 행동 변화를 모니터링.

**[TTL이 너무 공격적]** → prune 후보만 마킹하고 자동 삭제는 안 함(기존 guard와 동일). 30일은 보수적 임계값.
