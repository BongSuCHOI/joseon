## ADDED Requirements

### Requirement: Phase state file management
The system SHALL manage Phase state in `.opencode/orchestrator-phase.json` with `current_phase` (1-5), `phase_history` (array of phase entries with entered_at/completed_at), and `qa_test_plan_exists` (boolean).

#### Scenario: Initialize Phase state file
- **WHEN** `getPhaseState(worktree)` is called and no phase file exists
- **THEN** system SHALL create a new file with `current_phase: 1`, empty `phase_history`, and `qa_test_plan_exists: false`

#### Scenario: Read existing Phase state
- **WHEN** `getPhaseState(worktree)` is called and a phase file exists
- **THEN** system SHALL return the current phase, history, and qa_test_plan status

#### Scenario: Corrupted phase file fallback
- **WHEN** phase file exists but contains invalid JSON
- **THEN** system SHALL treat it as missing and return Phase 1 with empty history

### Requirement: Phase transition with history
The system SHALL support `transitionPhase(worktree, targetPhase)` that records the transition in phase_history, updates current_phase, and saves to file.

#### Scenario: Transition from Phase 1 to Phase 2
- **WHEN** `transitionPhase(worktree, 2)` is called with current_phase = 1
- **THEN** system SHALL set Phase 1's `completed_at` in history, add Phase 2 with `entered_at`, update `current_phase` to 2

#### Scenario: Transition to same phase is no-op
- **WHEN** `transitionPhase(worktree, 2)` is called with current_phase = 2
- **THEN** system SHALL do nothing and return current state

### Requirement: Phase 2.5 gate
The system SHALL block Phase 3 entry when `docs/qa-test-plan.md` does not exist in the project root.

#### Scenario: Blocked transition to Phase 3 without QA plan
- **WHEN** `transitionPhase(worktree, 3)` is called and `docs/qa-test-plan.md` does not exist
- **THEN** system SHALL throw Error with message containing "[ORCHESTRATOR BLOCK]" and NOT update the phase file

#### Scenario: Allowed transition to Phase 3 with QA plan
- **WHEN** `transitionPhase(worktree, 3)` is called and `docs/qa-test-plan.md` exists
- **THEN** system SHALL proceed with normal Phase 3 transition

### Requirement: Phase 5 completion reset
The system SHALL reset phase state to initial values when `resetPhase(worktree)` is called after Phase 5 completion.

#### Scenario: Reset after Phase 5
- **WHEN** `resetPhase(worktree)` is called
- **THEN** system SHALL set `current_phase: 1`, `phase_history: []`, and save to file

### Requirement: Incomplete phase detection
The system SHALL detect incomplete phases where the last phase entry has no `completed_at`.

#### Scenario: Detect incomplete phase
- **WHEN** `getPhaseState(worktree)` returns state where the last history entry has `completed_at: undefined`
- **THEN** the returned state SHALL include an `incomplete_phase` field set to the last phase number
