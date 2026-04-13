## ADDED Requirements

### Requirement: PID-based session lock acquisition
The system SHALL create a PID lock file at `~/.config/opencode/harness/projects/{key}/.session-lock` during `session.created` to prevent concurrent sessions on the same project.

#### Scenario: First session on a project
- **WHEN** a new session is created and no `.session-lock` file exists for the project
- **THEN** system SHALL create the lock file with `{ pid: process.pid, started_at: ISO8601 }`

#### Scenario: Session lock already held by live process
- **WHEN** a new session is created and `.session-lock` exists with a PID that is still running
- **THEN** system SHALL log a warning message containing "session already active" and NOT create a new lock

#### Scenario: Session lock held by dead process (stale lock)
- **WHEN** a new session is created and `.session-lock` exists but the PID is no longer running
- **THEN** system SHALL replace the lock file with the new session's PID

### Requirement: PID lock cleanup on session end
The system SHALL remove the PID lock file when the session ends.

#### Scenario: Lock cleanup on session idle
- **WHEN** `session.idle` event fires for a session that holds the lock
- **THEN** system SHALL delete the `.session-lock` file

### Requirement: Process alive detection
The system SHALL detect whether a PID is still running using platform-appropriate methods.

#### Scenario: Check running process
- **WHEN** `isProcessRunning(pid)` is called with a PID of a running process
- **THEN** it SHALL return `true`

#### Scenario: Check dead process
- **WHEN** `isProcessRunning(pid)` is called with a PID of a non-existent process
- **THEN** it SHALL return `false`
