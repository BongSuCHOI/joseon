## Why

Step 4 이후 고도화 문서에서 신호 품질과 phase 판정은 먼저 그림자 모드로 검증하라고 정리되어 있다. 현재의 결정적 경로를 건드리지 않은 채 품질 근거를 쌓을 수 있는 분리된 변경이 필요하다.

## What Changes

- phase와 signal 판정을 LLM 그림자 모드로 함께 기록한다.
- fix diff에서 실수 패턴을 추출해 그림자 학습 로그를 남긴다.
- ack 강화는 가드가 만족될 때만 반영하고, 기본 경로는 기존 동작을 유지한다.
- 외부 트렌드 자동 수집, todo-continuation, autopilot은 범위 밖으로 둔다.

## Capabilities

### New Capabilities
- `harness-step5a-signal-quality-foundation`: phase/signal 그림자 판정, 실수 패턴 그림자 학습, 가드된 ack 강화를 포함한다.

### Modified Capabilities
- 없음

## Impact

- `src/orchestrator/phase-manager.ts`, `src/harness/observer.ts`, `src/orchestrator/error-recovery.ts`, `src/orchestrator/qa-tracker.ts`의 신호 품질 관련 흐름
- 그림자 로그, diff 파서, ack 판정에 쓰이는 파일 기반 상태 경로
- 검증 스크립트와 스모크 테스트에서의 판정 비교 로직
