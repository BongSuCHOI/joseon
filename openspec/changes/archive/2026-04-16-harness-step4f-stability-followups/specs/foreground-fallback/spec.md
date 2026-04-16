## ADDED Requirements

### Requirement: Foreground fallback uses resolved model chains at runtime
The system SHALL switch the active foreground model to the next configured model when the current model is rate-limited, unavailable, or fails to continue.

#### Scenario: Primary model is rate-limited
- **WHEN** the foreground model returns a rate-limit failure
- **THEN** the system retries the request with the next configured fallback model without requiring the user to restart the conversation

#### Scenario: Fallback chain is exhausted
- **WHEN** every configured fallback model fails
- **THEN** the system surfaces the original failure instead of inventing a new model choice

#### Scenario: Fallback is disabled
- **WHEN** fallback is disabled in configuration
- **THEN** the system continues to use the primary model and does not switch models automatically
