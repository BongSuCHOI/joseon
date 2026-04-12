## ADDED Requirements

### Requirement: Memory Index extracts keywords from session JSONL
Improver 플러그인은 session.idle에서 `logs/sessions/`의 세션 JSONL을 읽어, 미리 정의된 키워드 패턴(decision:, NEVER DO:, ALWAYS:, MUST:, constraint:, FIXME: 등)이 포함된 줄을 추출하여 `memory/facts/{id}.json`에 저장한다.

#### Scenario: Decision keyword extracted and stored as fact
- **WHEN** 세션 JSONL에 `decision: API 응답은 항상 JSON 형식`이라는 내용이 포함됨
- **AND** improver가 session.idle에서 Index를 실행함
- **THEN** `memory/facts/{id}.json`에 `{ keywords: ["decision", "API", "JSON"], content: "decision: API 응답은 항상 JSON 형식", source_session: "<sessionID>", created_at: "<timestamp>" }`가 저장됨

#### Scenario: Session without keywords creates no facts
- **WHEN** 세션 JSONL에 키워드 패턴이 포함되지 않음
- **THEN** fact 파일이 생성되지 않음

#### Scenario: Multiple keywords in one session create separate facts
- **WHEN** 세션 JSONL에 `NEVER DO: console.log`와 `ALWAYS: 에러 핸들링`이 모두 포함됨
- **THEN** 2개의 fact 파일이 각각 생성됨

### Requirement: Memory Search injects relevant facts on compacting
Improver의 compacting 훅에서 현재 scaffold/규칙 주입 후, `memory/facts/`에서 관련 fact를 키워드 기반으로 검색하여 컨텍스트에 주입한다.

#### Scenario: Relevant fact injected during compacting
- **WHEN** compacting 훅이 발동함
- **AND** `memory/facts/`에 `{ keywords: ["API", "JSON"] }` fact가 존재함
- **THEN** fact의 content가 `[HARNESS MEMORY — past decisions]` 헤더와 함께 output.context에 push됨

#### Scenario: No facts results in no memory injection
- **WHEN** `memory/facts/`에 파일이 없음
- **THEN** memory 섹션은 생략됨 (scaffold/규칙 주입만)

#### Scenario: Too many facts limits injection
- **WHEN** 관련 fact가 10개 이상 검색됨
- **THEN** 최대 10개까지만 주입됨
