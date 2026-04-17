## ADDED Requirements

### Requirement: Auto-update checker stays default-off
The system SHALL keep the auto-update checker disabled by default and SHALL not block session start when update checking is unavailable or fails.

#### Scenario: Checker disabled by default
- **WHEN** the configuration does not enable the auto-update checker
- **THEN** the system SHALL skip the version check and SHALL continue the session normally

#### Scenario: Check failure is ignored
- **WHEN** the version check fails because the registry is unavailable or the network errors
- **THEN** the system SHALL ignore the failure and SHALL NOT interrupt the session

### Requirement: Release notice is warn-only with cooldown
The system SHALL compare the installed version against the registry at session start when enabled and SHALL only emit a warning notice subject to cooldown or TTL.

#### Scenario: New version produces a warning
- **WHEN** the checker is enabled and a newer version is available
- **THEN** the system SHALL emit a warning-only notice and SHALL NOT auto-update

#### Scenario: Cooldown suppresses repeated notices
- **WHEN** the same version notice was already shown within the cooldown window
- **THEN** the system SHALL suppress the duplicate notice

#### Scenario: Up-to-date version stays silent
- **WHEN** the installed version matches the latest available version
- **THEN** the system SHALL remain silent and SHALL not change session behavior
