## 1. 타입 및 설정

- [x] 1.1 `src/types.ts`에 `CanaryMismatchRecord` 인터페이스 추가 (id, timestamp, project_key, proxy_type, deterministic, canary, shadow_record_id)
- [x] 1.2 `src/config/schema.ts`의 `HarnessSettings`에 `canary_enabled?: boolean` 필드 추가, 기본값 `false`

## 2. Shadow 레코드 리더

- [x] 2.1 `src/harness/canary.ts`에 `readRecentShadowRecords(worktree, count)` 함수 구현 — `phase-signal-shadow.jsonl` 역순 읽기, 최근 N개 반환
- [x] 2.2 빈 파일/미존재 파일 처리 — 빈 배열 반환

## 3. 저신뢰도 프록시 판정

- [x] 3.1 `src/harness/canary.ts`에 `isLowConfidenceProxy(record)` 함수 구현 — 4가지 프록시 조건 판별 (phase_blocked, phase_regression, user_feedback, error_pre_alert)
- [x] 3.2 정상 판정 (순방향 phase, fix_commit 등)은 proxy 대상에서 제외 확인

## 4. 메타데이터 Canary 평가

- [x] 4.1 `src/harness/canary.ts`에 `computePhaseHint(record)` 함수 구현 — `"forward"`, `"blocked_gate"`, `"regression"`, `"same"`, `"reset"` 산출
- [x] 4.2 `src/harness/canary.ts`에 `computeSignalRelevance(record)` 함수 구현 — `"high"`, `"medium"`, `"low"` 산출 (키워드 매칭 수, 에러 카운트 기반)
- [x] 4.3 `src/harness/canary.ts`에 `computeConfidence(proxyType, recentRecords)` 함수 구현 — 동일 프록시 빈도 기반 0.0~1.0 산출 (빈도 ≥5 → ≤0.3, 빈도 <3 → ≥0.7)
- [x] 4.4 `src/harness/canary.ts`에 `evaluateCanary(record, recentRecords, config)` 통합 함수 구현 — 위 3개 함수 조합하여 canary 평가 결과 반환

## 5. Shadow Block 채우기 + Mismatch 감지

- [x] 5.1 기존 `appendPhaseShadowRecord` 호출 지점에 canary 평가 연동 — `canary_enabled=true` + low-confidence proxy 통과 시 evaluated 레코드 추가 append
- [x] 5.2 기존 `appendSignalShadowRecord` 호출 지점에 canary 평가 연동 — 동일 패턴
- [x] 5.3 `src/harness/canary.ts`에 `getCanaryMismatchesPath(worktree)` 함수 구현 — `canary-mismatches.jsonl` 경로 반환
- [x] 5.4 `src/harness/canary.ts`에 `appendMismatchRecord(record)` 함수 구현 — mismatch 감지 조건 충족 시 `CanaryMismatchRecord` append
- [x] 5.5 `canary_enabled=false`에서 기존 stub 동작 완전 유지 확인 (zero-impact)

## 6. 집계 리포트

- [x] 6.1 `src/harness/canary.ts`에 `generateCanaryReport(worktree)` 함수 구현 — 총 evaluations, mismatches, mismatch율, 프록시별 분포, 승격 후보 (>30%) 산출
- [x] 6.2 빈 파일/미존재 파일 처리 — total=0, mismatches=0 반환

## 7. 테스트

- [x] 7.1 `src/__tests__/smoke-step5f-canary.ts` 작성 — 프록시 판정, 메타데이터 평가, mismatch 감지, 집계 리포트, canary_enabled=false 동작 검증
- [x] 7.2 기존 smoke suite 전체 통과 확인 (회귀 없음)
