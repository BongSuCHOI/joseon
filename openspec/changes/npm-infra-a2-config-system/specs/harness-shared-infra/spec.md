## MODIFIED Requirements

### Requirement: logEvent appends JSONL records
`shared/utils.ts`의 `logEvent(category, filename, data)`는 `@deprecated` 마크되며, 내부적으로 `logger.info()`로 redirect한다. category는 data 객체에 `_category` 필드로 보존된다.

#### Scenario: Log entry is appended with timestamp
- **WHEN** `logEvent('tools', '2026-04-11.jsonl', { tool: 'bash' })`를 호출함
- **THEN** `harness.jsonl`에 `{"level":"info","module":"legacy","msg":"logEvent","data":{"tool":"bash","_category":"tools","_filename":"2026-04-11.jsonl"},"ts":"..."}` 레코드가 append됨

## ADDED Requirements

### Requirement: Harness modules read thresholds from config
enforcer, improver, error-recovery, qa-tracker 모듈은 하드코딩된 임계값 대신 config에서 로드한 `HarnessSettings` 값을 사용한다.

#### Scenario: Enforcer uses config threshold
- **WHEN** config에 `{"harness": {"soft_to_hard_threshold": 3}}`가 설정됨
- **THEN** enforcer가 violation_count >= 3일 때만 SOFT→HARD 승격을 수행함

#### Scenario: QA tracker uses config threshold
- **WHEN** config에 `{"harness": {"escalation_threshold": 5}}`가 설정됨
- **THEN** qa-tracker가 5회 실패 시에만 escalate 판정을 내림
