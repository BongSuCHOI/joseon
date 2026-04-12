## Context

Step 1에서 observer(L1 관측 + L2 신호 변환)와 enforcer(L3 프로젝트 격리 + L4 규칙 차단)를 구현 완료했다. signal은 pending에 생성되지만 규칙으로 변환되지 않고 방치되며, 규칙은 수동으로만 만들 수 있다. Step 2는 improver 플러그인을 추가하여 L5(자동 수정) + L6(폐루프)를 실현한다.

**현재 제약:**
- OpenCode Plugin API는 소스코드에서 전체 확인 완료 (`docs/api-confirmation.md` 참조)
- `experimental.session.compacting` 훅: `output.context.push(string)`로 컨텍스트 주입
- `event` 훅: observer와 improver가 모두 등록하므로 병합 필요 (v3 버그 C1)
- `violation_count`는 누적값이므로 승격 시 리셋 + 효과 측정은 delta 사용 필요 (v3 버그 W3)

**v3 의사코드 기준:** v3-final 5장 887~1167행에 의사코드가 있으나, 사전 분석에서 버그 2건(C1, W3)과 누락(fix_commit 파이프라인 전체)을 발견. 구현 시 수정 반영.

**사전 분석 문서:** `docs/step2-pre-implementation-analysis.md`에 참고 문서 6개 분석, V3 vs 원본 갭 6개, 오라클 크로스 리뷰 결과 정리됨.

## Goals / Non-Goals

**Goals:**
- L5: pending signal이 session.idle에서 자동으로 SOFT 규칙으로 변환됨
- L5: fix: 커밋을 감지하여 scaffold NEVER DO에 자동 추가 (Loop 1)
- L6: SOFT 규칙의 violation_count≥2 시 HARD로 자동 승격 (scope: 'prompt' 제외)
- L6: 30일 경과 규칙의 효과를 delta 기반으로 측정
- 컴팩션 시 scaffold + HARD/SOFT 규칙 컨텍스트 주입
- Signal 중복 처리 (soft+hard 양쪽 체크, 완전 일치만)
- event 훅 병합 유틸리티로 observer의 event 핸들러 보존
- 프로젝트 상태(state.json) 자동 갱신

**Non-Goals:**
- 크로스세션 기억 7단계 중 상위 4단계 (v3 5.2.1, 데이터 축적 후)
- 이중 모델 검증 / cross-reviewer (v3 5.2.2, Step 4)
- 외부 트렌드 자동 수집 (v3 5.2.3, 가장 마지막)
- 표면 UX 래핑 / commands (v3 5.2.4, 엔진 안정화 후)
- 규칙 자동 삭제 / Pruning (규칙 수 적을 때 수동 관리)
- Cross-Project 승격 (단일 프로젝트 환경)
- 규칙 Rollback 자동화 (수동 삭제로 충분)
- LLM 기반 signal 판정 (결정론적 코드가 적절)

## Decisions

### 1. event 훅 병합 — mergeEventHandlers 유틸리티

**선택:** shared/utils.ts에 `mergeEventHandlers(...hooks)` 함수를 추가하여, 여러 플러그인의 event 핸들러를 배열로 수집하여 순차 실행.

**이유:** v3 의사코드의 `{ ...observerHooks, ...improverHooks }` 스프레드 패턴은 나중 것이 앞의 것을 덮어씀. observer의 event 핸들러(session.error, file.edited, message.part.updated)가 전부 소실됨. index.ts에서 병합하도록 수정.

**대안 고려:**
- (기각) 각 플러그인의 event를 하나의 함수로 합침 → 플러그인 독립성 훼손
- (기각) 별도 파일로 분리 → 단일 패키지 원칙 위반

### 2. fix: 커밋 감지 — session.created 타임스탬프 + session.idle에서 git log

**선택:** observer가 session.created 시 타임스탬프를 기록하고, improver가 session.idle 시 `git log --since=<timestamp>`로 세션 내 fix: 커밋을 조회.

**이유:** COMMIT_EDITMSG는 마지막 커밋만 담아 신뢰할 수 없음. git log --since로 세션 내 모든 fix: 커밋을 포착. 패턴 추출은 파일 경로 기반으로 단순화.

**대안 고려:**
- (기각) COMMIT_EDITMSG 읽기 → 마지막 커밋만, 신뢰성 낮음
- (기각) file.edited 이벤트 기반 → 커밋 메시지를 모름

### 3. violation_count — 승격 시 리셋 + delta 기반 측정

**선택:** promoteRules()가 HARD 승격 시 violation_count를 0으로 리셋. evaluateRuleEffectiveness()는 `violation_count - (effectiveness.last_measured_count || 0)` delta로 재발 판정.

**이유:** violation_count 누적값으로 판정하면 "생성 직후 3회 위반 + 30일간 0회"도 needs_promotion이 됨. 승격 시 리셋으로 HARD = 새 출발, delta로 정확한 기간 내 재발 측정.

### 4. Signal 중복 — soft+hard 양쪽 완전 일치 체크

**선택:** signalToRule()에서 규칙 생성 전, `soft/`와 `hard/` 모두에서 동일 `pattern.match`가 있는지 체크. 완전 일치만. 유사도/LLM 기반은 제외.

**이유:** SOFT→HARD 승격 후 동일 패턴의 SOFT가 재생성되는 시나리오를 방지. ~20줄로 방어적 코딩 기본 수준.

### 5. 컨텍스트 주입 — scaffold + HARD + SOFT 전부

**선택:** compacting 훅에서 scaffold, HARD 규칙 설명, SOFT 규칙 설명을 모두 context.push(). scope: 'prompt' 규칙은 이 주입이 유일한 강제 수단.

**이유:** 컴팩션은 세션이 길어졌을 때만 발생. 세션 초반에는 적용되지 않지만, Step 2에서는 이것만으로 충분. 세션 시작부터 적용하려면 .opencode/rules/ 병행이 필요한데, 이건 Step 3 브릿지에서.

### 6. 파일 I/O 경쟁 조건 — idempotency 보장

**선택:** 프로세스 중간 사망 시 같은 signal이 재처리될 수 있지만, Signal 중복 체크(ruleExists)가 있으므로 재시도가 멱등성 보장.

**이유:** write-ahead(ack 먼저 이동)는 signal 손실 가능성이 있음. 중복 체크로 안전하게 재시도하는 것이 낫다.

## Risks / Trade-offs

**[event 훅 병합 누락 시 Step 1 고장]** → mergeEventHandlers 유틸리티로 반드시 병합. 단위 테스트로 검증.

**[COMMIT_EDITMSG vs git log]** → git log --since를 사용하므로 COMMIT_EDITMSG 의존 없음. 하지만 child_process.execSync가 필요하므로 OpenCode 플러그인 샌드박스에서 허용되는지 확인 필요.

**[compacting 토큰 한계]** → 규칙 수십 개 시 컨텍스트 과부하 가능. Step 2 초기엔 규칙 수가 적어 문제없음. 고도화에서 선택적 주입.

**[fix: 커밋 패턴 추출 품질]** → 파일 경로 기반으로 단순화. LLM 기반 추출보다 품질 낮지만 결정론적이고 비용 없음. 나중에 harness-eval 도구로 보완 가능.

**[needs_promotion 상태 소비자 없음]** → 측정은 하되 액션은 취하지 않음. 의식적 선택. 나중에 자동 삭제 기준으로 활용.
