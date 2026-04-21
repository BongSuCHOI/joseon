## Why

하네스의 Observer(L1)는 3개 신호(error_repeat, user_feedback, fix_commit)만 감지하고, Memory Recall(L7)은 미구현 상태다. token-optimizer(#2)의 낭비 탐지기와 token-savior(#4)의 점진적 공개·TTL 패턴을 흡수하여, (1) 더 많은 토큰 낭비 패턴을 자동 감지하고 (2) compacting 시 fact 주입 토큰을 ~70-90% 절감하며 (3) 구식 fact를 자동 정리한다.

## What Changes

- Observer(L1)에 3개 프록시 기반 낭비 탐지 신호 추가: `tool_loop`(동일 툴+args 반복), `retry_storm`(연속 에러→재시도 패턴), `excessive_read`(동일 파일 반복 읽기)
- Memory 7단계 중 미구현인 **Recall(L7)** 구현: 3계층 점진적 공개(Layer 1 인덱스 ~15토큰 → Layer 2 요약 ~60토큰 → Layer 3 전체 ~200토큰)
- Fact 모델에 `last_accessed_at`, `access_count` 필드 추가 및 접근 추적
- 30일 미접속 fact → prune 후보 자동 마킹, 고접근 fact → TTL 연장
- Improver compacting 로직: 기존 "전체 fact 주입"을 "Layer 1 인덱스만 주입"으로 변경

## Capabilities

### New Capabilities
- `memory-recall-progressive`: Memory Recall(L7) 3계층 점진적 공개 — compacting 시 fact를 인덱스만 주입하고, 필요시 상세 내용을 순차적으로 제공
- `observer-waste-detectors`: Observer 낭비 탐지기 — tool_loop, retry_storm, excessive_read 3개 신호를 기존 Signal→Rule 파이프라인에 통합

### Modified Capabilities
- `harness-observer`: Observer에 3개 새 신호 타입 추가 (signal_type enum 확장, 감지 로직, pending JSON 생성)
- `harness-step5b-memory-relevance`: Fact 데이터 모델에 TTL/접근 추적 필드 추가, consolidate 시 접근 카운트 갱신, 미접속 fact prune 마킹

## Impact

- **타입**: `src/types.ts` — `SignalType` 유니온에 3개 타입 추가, `Fact` 인터페이스에 2개 필드 추가
- **Observer**: `src/harness/observer.ts` — `tool.execute.after` 훅에서 3개 낭비 패턴 감지 로직 추가
- **Improver**: `src/harness/improver.ts` — Recall 계층 구현, compacting 주입 방식 변경, fact 접근 추적, TTL 기반 prune
- **설정**: `src/config/schema.ts` — `fact_ttl_days`, `fact_ttl_extend_threshold` 설정 추가
- **하위 호환**: 기존 fact에 새 필드가 없으면 기본값으로 동작 (마이그레이션 불필요)
