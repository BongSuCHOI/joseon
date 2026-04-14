## ADDED Requirements

### Requirement: FallbackConfig defines model fallback chains
`src/config/schema.ts`의 `FallbackConfig` 인터페이스는 `enabled`와 `chains` 필드를 정의한다. `chains`는 에이전트 이름별 모델 배열을 매핑한다.

#### Scenario: FallbackConfig with chains
- **WHEN** `FallbackConfig` 타입을 사용함
- **THEN** `enabled?: boolean`과 `chains?: Record<string, string[]>` 필드가 정의되어 있음

#### Scenario: FallbackConfig defaults
- **WHEN** config 파일에 fallback 섹션이 없음
- **THEN** `enabled: true`, `chains: {}` 기본값으로 동작함

### Requirement: Model array in agent config creates fallback chain
에이전트의 `model` 필드가 배열인 경우, `_modelArray`에 저장하고 첫 번째 모델을 `config.model`에 설정한다. 나머지 모델은 FallbackChain으로 사용된다.

#### Scenario: Model array sets first model and stores chain
- **WHEN** 에이전트 설정에 `model: ["provider-a/model-x", "provider-b/model-y"]`가 지정됨
- **THEN** `config.model`은 `"provider-a/model-x"`로 설정되고, `_modelArray`에 전체 배열이 저장됨

#### Scenario: Model array with variant objects
- **WHEN** 에이전트 설정에 `model: [{ id: "provider/model", variant: "high" }]`가 지정됨
- **THEN** `_modelArray`에 `{ id: "provider/model", variant: "high" }` 객체가 저장됨

#### Scenario: Single model string works as before
- **WHEN** 에이전트 설정에 `model: "provider/model"`이 지정됨
- **THEN** `config.model`이 `"provider/model"`로 설정되고 `_modelArray`는 생성되지 않음

### Requirement: Fallback chains merged from model arrays and fallback config
에이전트별 model 배열과 `fallback.chains`를 병합하여 최종 FallbackChain을 구성한다. 에이전트의 model 배열이 우선한다.

#### Scenario: Model array takes precedence over fallback chains
- **WHEN** 에이전트에 model 배열 `["a", "b"]`이 있고 `fallback.chains.agentName`이 `["c", "d"]`임
- **THEN** 최종 체인은 `["a", "b"]`가 됨 (model 배열이 우선)

#### Scenario: Fallback chain used when no model array
- **WHEN** 에이전트에 model이 단일 문자열이고 `fallback.chains.agentName`이 `["c", "d"]`임
- **THEN** 최종 체인은 `["c", "d"]`가 됨

#### Scenario: No chain when neither exists
- **WHEN** 에이전트에 model 배열도 없고 `fallback.chains.agentName`도 없음
- **THEN** 빈 체인이 됨 (fallback 없이 단일 모델로 동작)
