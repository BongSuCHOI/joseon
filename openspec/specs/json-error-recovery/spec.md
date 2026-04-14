## ADDED Requirements

### Requirement: JSON parse error detection in tool output
`src/hooks/json-error-recovery.ts`는 `tool.execute.after` 훅에서 도구 출력 문자열을 검사하여 JSON 파싱 에러 패턴을 감지한다. bash, read, glob, webfetch 등은 제외 목록에 포함한다.

#### Scenario: JSON error detected
- **WHEN** 도구 출력에 JSON 파싱 에러 패턴("Unexpected token", "is not valid JSON", "JSON.parse" 등)이 포함됨
- **THEN** 에러가 감지되어 수정 프롬프트 주입이 트리거됨

#### Scenario: Excluded tools ignored
- **WHEN** 도구가 bash, read, glob, webfetch, grep_app_searchgithub, websearch 중 하나임
- **THEN** JSON 에러 감지를 수행하지 않음 (이 도구들은 JSON 출력이 아님)

#### Scenario: Normal tool output ignored
- **WHEN** 도구 출력에 JSON 에러 패턴이 없음
- **THEN** 아무 동작도 수행하지 않음

### Requirement: JSON error correction reminder injection
JSON 에러 감지 시, 수정 리마인더를 시스템 컨텍스트에 주입한다. 리마인더는 "잘못된 JSON 인자를 보냈다, 수정하고 재시도하라"는 내용을 포함한다.

#### Scenario: Correction reminder injected
- **WHEN** JSON 파싱 에러가 감지됨
- **THEN** 동일한 잘못된 호출을 반복하지 말고 JSON 문법을 수정하라는 리마인더가 주입됨
