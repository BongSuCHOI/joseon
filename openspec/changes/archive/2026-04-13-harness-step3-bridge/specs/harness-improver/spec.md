## MODIFIED Requirements

### Requirement: Improver updates .opencode/rules/ markdown in parallel with JSON rules
Improver는 `signalToRule()`에서 SOFT 규칙 JSON 생성 시, `.opencode/rules/harness-soft-rules.md` 마크다운 파일도 동시 갱신한다. `promoteRules()`에서 HARD 승격 시에도 마크다운에 반영한다. 이 파일은 OpenCode가 세션 시작부터 자동 로드한다.

#### Scenario: SOFT rule created updates markdown
- **WHEN** signalToRule()이 새로운 SOFT 규칙을 `rules/soft/`에 생성함
- **THEN** `.opencode/rules/harness-soft-rules.md`에 `- [SOFT|{scope}] {description}` 형식으로 규칙이 추가됨

#### Scenario: HARD promotion updates markdown
- **WHEN** promoteRules()가 SOFT 규칙을 HARD로 승격함
- **THEN** `.opencode/rules/harness-soft-rules.md`에서 해당 항목이 제거되고 `.opencode/rules/harness-hard-rules.md`에 `- [HARD|{scope}] {description}`으로 추가됨

#### Scenario: Markdown file created when not exists
- **WHEN** `.opencode/rules/harness-soft-rules.md` 파일이 존재하지 않음
- **THEN** 파일이 생성되고 `# Harness Rules (auto-generated)` 헤더와 함께 규칙이 기록됨

### Requirement: Improver detects fix: commits with improved parsing
Improver의 `detectFixCommits()`는 `git log --format="COMMIT_START%n%H%n%s" --name-only` 포맷을 사용하여 커밋 해시, 메시지, 변경 파일 목록을 명확하게 분리 파싱한다.

#### Scenario: fix: commit with changed files correctly parsed
- **WHEN** `fix: 타입 에러 수정` 커밋이 `src/types.ts`와 `src/index.ts`를 변경함
- **THEN** fix_commit signal의 `source_file`이 `src/types.ts`로 설정됨 (첫 번째 변경 파일)
- **AND** `pattern`이 `src/types.ts`로 설정됨

#### Scenario: fix: commit with no file changes creates signal with commit message
- **WHEN** `fix: 문서 오타` 커밋이 변경 파일 없이 메시지만 수정함
- **THEN** `source_file`이 빈 문자열로 설정되고, `pattern`이 커밋 메시지로 설정됨

#### Scenario: git log failure does not crash improver
- **WHEN** `git log` 실행이 실패함
- **THEN** 에러가 로깅되고 fix: 커밋 감지가 건너뛰어지며 다른 기능은 정상 동작함
