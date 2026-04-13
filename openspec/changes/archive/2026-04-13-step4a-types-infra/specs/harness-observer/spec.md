## MODIFIED Requirements

### Requirement: Session creation event handling
The observer SHALL handle `session.created` events to initialize project state AND acquire PID session lock.

#### Scenario: New session with no lock
- **WHEN** `session.created` event fires and no `.session-lock` exists for the project
- **THEN** observer SHALL create PID lock file AND initialize project state as before

#### Scenario: New session with stale lock
- **WHEN** `session.created` event fires and `.session-lock` exists but PID is dead
- **THEN** observer SHALL replace lock file AND initialize project state normally

#### Scenario: New session with active lock
- **WHEN** `session.created` event fires and `.session-lock` exists with live PID
- **THEN** observer SHALL log warning "[harness] Session already active for this project (PID: {pid})" AND still proceed (graceful, not crash)
