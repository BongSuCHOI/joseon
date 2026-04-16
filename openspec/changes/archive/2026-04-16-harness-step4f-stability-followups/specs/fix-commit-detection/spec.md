## ADDED Requirements

### Requirement: Recent fix commits emit fix signals
The system SHALL inspect repository history since the current session started and emit a pending `fix_commit` signal for each commit whose subject begins with `fix`.

#### Scenario: Fix commit after session start
- **WHEN** a commit with subject `fix: tighten harness compaction` exists after the current session start time
- **THEN** the system emits a pending `fix_commit` signal for that commit

#### Scenario: Non-fix commit ignored
- **WHEN** a commit with subject `docs: update README` exists after the current session start time
- **THEN** no `fix_commit` signal is emitted for that commit

### Requirement: Fix commit signals use commit message as the pattern
The system SHALL store the commit subject as the signal pattern and SHALL keep `source_file` empty. Affected files are metadata only.

#### Scenario: Pattern comes from commit message
- **WHEN** a `fix_commit` signal is created
- **THEN** the signal pattern equals the commit subject text

#### Scenario: File path is metadata only
- **WHEN** a `fix_commit` signal includes affected files
- **THEN** file paths are recorded only as metadata and are not used as the pattern
