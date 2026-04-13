## Why

서브에이전트 작업 실패 시 단계적 복구와, QA 시나리오별 실패 추적이 필요하다. 이 두 모듈은 Orchestrator 통합(Change D) 전에 독립적으로 구현되어야 한다.

## What Changes

- **에러 복구 4단계:** `src/orchestrator/error-recovery.ts` 신규. 1차 직접수정 → 2차 구조변경 → 3차 다른 모델 rescue → 4차 리셋 → 사용자 에스컬레이션. 각 단계 시도 이력을 파일로 기록
- **QA 실패 추적:** `src/orchestrator/qa-tracker.ts` 신규. 시나리오별 3회 실패 시 에스컬레이션 판정. `projects/{key}/qa-failures.json` 파일 기반 관리

## Capabilities

### New Capabilities
- `error-recovery`: 4단계 에러 복구 로직 + 이력 기록
- `qa-tracker`: 시나리오별 QA 실패 추적 + 에스컬레이션 판정

### Modified Capabilities
(없음 — 신규 독립 모듈)

## Impact

- `src/orchestrator/error-recovery.ts`: 신규 (~120줄)
- `src/orchestrator/qa-tracker.ts`: 신규 (~60줄)
- 런타임 파일: `~/.config/opencode/harness/projects/{key}/error-recovery.jsonl`, `~/.config/opencode/harness/projects/{key}/qa-failures.json`
