## Why

Phase Manager, 에이전트 정의, 에러 복구, QA 추적 모듈(Change A, B, C)이 완료된 후, 이들을 하나의 Orchestrator 플러그인으로 통합하고 진입점에 연결해야 한다.

## What Changes

- **Orchestrator 플러그인 메인:** `src/orchestrator/orchestrator.ts`에서 Phase Manager, 에러 복구, QA 추적을 통합하는 훅 구성
- **진입점 통합:** `src/index.ts`에 Orchestrator 플러그인 추가, mergeEventHandlers에 포함
- **signal에 agent_id 주입:** Orchestrator가 signal 생성 시 어떤 에이전트에서 발생했는지 추적

## Capabilities

### New Capabilities
- `orchestrator-plugin`: Phase Manager + 에러 복구 + QA 추적을 통합하는 Plugin 4 진입점

### Modified Capabilities
- `harness-shared-infra`: `src/index.ts`에 Orchestrator hooks 병합

## Impact

- `src/orchestrator/orchestrator.ts`: 신규 (~150줄)
- `src/index.ts`: 수정 (Orchestrator import + mergeEventHandlers 포함)
- 디렉토리 구조에 `orchestrator/` 반영
