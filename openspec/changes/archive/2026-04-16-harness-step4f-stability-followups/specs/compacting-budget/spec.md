## ADDED Requirements

### Requirement: Compaction output is bounded
The system SHALL bound the content appended during session compaction so the injected context cannot grow without limit.

#### Scenario: Large compaction input
- **WHEN** compaction runs with many scaffold, rule, and memory entries
- **THEN** the injected context stays within a bounded budget instead of appending everything

#### Scenario: Priority-based trimming
- **WHEN** the available content exceeds the budget
- **THEN** hard rules and scaffold content are retained before soft rules and memory facts

#### Scenario: Empty compaction input
- **WHEN** no scaffold, rules, or memory facts exist
- **THEN** compaction adds nothing and still completes successfully
