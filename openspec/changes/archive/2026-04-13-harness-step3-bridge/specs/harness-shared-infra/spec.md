## MODIFIED Requirements

### Requirement: logEvent rotates history.jsonl on size limit
`shared/utils.ts`의 `logEvent()` 함수(또는 별도 유틸)는 `history.jsonl`에 append하기 전에 파일 크기를 체크한다. 1MB 초과 시 기존 파일을 `history-{timestamp}.jsonl`로 rename하고 새 파일을 생성한다.

#### Scenario: History file under limit appends normally
- **WHEN** `history.jsonl` 파일 크기가 1MB 미만임
- **THEN** 기존 파일에 append됨

#### Scenario: History file over limit triggers rotation
- **WHEN** `history.jsonl` 파일 크기가 1MB를 초과함
- **THEN** 기존 파일이 `history-{YYYYMMDD-HHmmss}.jsonl`로 rename됨
- **AND** 새 `history.jsonl` 파일이 생성되어 레코드가 append됨

#### Scenario: No existing history file creates new one
- **WHEN** `history.jsonl` 파일이 존재하지 않음
- **THEN** 새 파일이 생성되어 레코드가 append됨 (로테이션 없음)
