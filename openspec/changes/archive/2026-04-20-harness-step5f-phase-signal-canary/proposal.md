## Why

Step 5a에서 `phase-signal-shadow.jsonl`에 모든 deterministic 판정을 기록하는 그림자 로깅을 구현했지만, shadow block은 항상 stub(`status: 'unavailable'`, `confidence: 0`)이다. 아무도 이 데이터를 읽거나 분석하지 않는다. canary 판정 보조 시스템을 추가하여 deterministic 판정의 경계 상황에서 메타데이터 기반 평가를 수행하고, mismatch를 감지·집계함으로써 향후 LLM 기반 판정 승격의 근거를 수집한다.

## What Changes

- **저신뢰도 프록시 판정**: deterministic phase/signal 판정 중 경계 상황(Phase 2.5 gate BLOCKED, 역행 phase, user_feedback signal, error_repeat 임계값 직전)을 식별하는 함수 추가
- **메타데이터 기반 canary 평가**: LLM 없이 기존 shadow 레코드와 규칙/히스토리 메타데이터로 `phase_hint`, `signal_relevance`, `confidence` 산출. compacting shadow의 `rankSemanticSoftRules()` 패턴 재사용
- **Shadow block 채우기**: 저신뢰도 프록시 통과 시 stub → 메타데이터 평가 결과로 shadow block 갱신
- **Mismatch 감지**: deterministic 판정과 canary 평가의 불일치를 `canary-mismatches.jsonl`에 기록
- **집계 리포트 함수**: mismatch율, 패턴별 분포, 승격 후보 판정을 온디맨드로 조회 가능한 함수
- **설정**: `canary_enabled` (default: false), 프록시 on/off 플래그

## Capabilities

### New Capabilities
- `phase-signal-canary`: 저신뢰도 프록시 판정, 메타데이터 canary 평가, mismatch 감지·집계

### Modified Capabilities
- `harness-step5a-signal-quality-foundation`: shadow block 채우기 로직이 stub에서 메타데이터 평가 결과로 확장. 기존 `appendPhaseShadowRecord` / `appendSignalShadowRecord` 호출 지점에 canary 평가 연동
- `config-system`: `canary_enabled`, 프록시 on/off 설정 필드 추가

## Impact

- **`src/harness/improver.ts`**: canary 평가 함수, 프록시 판정 함수, shadow 레코드 리더, 집계 리포트 함수 추가. 기존 `appendPhaseShadowRecord` / `appendSignalShadowRecord` 호출 지점 수정
- **`src/harness/observer.ts`**: signal 쪽 canary 연동 지점
- **`src/orchestrator/phase-manager.ts`**: phase 쪽 canary 연동 지점
- **`src/types.ts`**: `CanaryMismatchRecord` 타입 추가
- **`src/config/schema.ts`**: canary 설정 필드 추가
- **런타임 데이터**: `canary-mismatches.jsonl` 신규 파일
- **기존 동작 영향**: `canary_enabled=false` (기본값)에서는 기존 동작 완전 동일. zero-impact
