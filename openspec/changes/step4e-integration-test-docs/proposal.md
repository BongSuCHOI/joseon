## Why

Step 4 전체 구현(Change A~D) 완료 후, 전체 5-Phase 워크플로우의 실동작을 검증하고 문서를 업데이트해야 한다.

## What Changes

- **통합 스모크 테스트:** Phase 전환, 에이전트 등록, 에러 복구, QA 추적, PID 차단의 통합 동작 검증
- **문서 업데이트:** AGENTS.md, README.md, development-guide.md에 Step 4 완료 상태 반영

## Capabilities

### New Capabilities
- `step4-integration-test`: 전체 Step 4 통합 스모크 테스트 스위트

### Modified Capabilities
(문서 업데이트만 — spec 변경 없음)

## Impact

- `test/smoke-test-step4.ts`: 신규
- `AGENTS.md`, `README.md`, `docs/development-guide.md`: 업데이트
