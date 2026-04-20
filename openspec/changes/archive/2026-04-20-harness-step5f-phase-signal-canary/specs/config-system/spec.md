## MODIFIED Requirements

### Requirement: HarnessSettings defines harness tuning parameters
`HarnessSettings`은 `soft_to_hard_threshold`, `escalation_threshold`, `max_recovery_stages`, `history_max_bytes`, `regex_max_length`, `scaffold_match_ratio`, `search_max_results`, `max_subagent_depth`, `candidate_threshold`, `canary_enabled` 필드를 가진다. 모두 optional.

#### Scenario: Override canary_enabled
- **WHEN** config 파일에 `{"harness": {"canary_enabled": true}}`가 설정됨
- **THEN** phase/signal canary 평가가 활성화되어 저신뢰도 프록시 상황에서 메타데이터 기반 평가 수행

#### Scenario: Default canary_enabled is false
- **WHEN** config 파일에 canary_enabled가 없음
- **THEN** 기본값 false로 동작함. 기존 shadow stub 동작 유지 (zero-impact)

#### Scenario: All defaults match current behavior
- **WHEN** config 파일이 존재하지 않거나 harness 섹션이 비어있음
- **THEN** 모든 하네스 설정값이 현재 하드코딩된 기본값과 동일함. canary 비활성.
