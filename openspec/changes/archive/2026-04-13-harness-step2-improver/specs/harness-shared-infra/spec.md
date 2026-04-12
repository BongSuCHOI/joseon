## MODIFIED Requirements

### Requirement: mergeEventHandlers utility merges event hook arrays
`shared/utils.ts`에 `mergeEventHandlers(...hookObjects)` 함수를 추가한다. 여러 플러그인이 반환한 hook 객체에서 `event` 키를 병합하여, 모든 event 핸들러가 순차 실행되도록 보장한다.

#### Scenario: Two plugins with event hooks merged correctly
- **WHEN** observer가 `{ event: fn1 }`을 반환하고 improver가 `{ event: fn2 }`를 반환함
- **THEN** `mergeEventHandlers(observerHooks, improverHooks)`의 결과에서 `event`는 fn1과 fn2를 순차 호출하는 단일 함수임

#### Scenario: Plugin without event hook handled gracefully
- **WHEN** enforcer가 `{ event: fn1 }`을 반환하고 observer가 `{ 'tool.execute.after': fn2 }`를 반환함 (event 없음)
- **THEN** 병합 결과에서 `event`는 fn1만 호출함
- **AND** `'tool.execute.after'`도 정상적으로 보존됨

#### Scenario: Three plugins with event hooks all execute
- **WHEN** 세 플러그인이 모두 event 핸들러를 반환함
- **THEN** 병합 결과의 event 호출 시 세 핸들러가 모두 순차 실행됨
- **AND** 한 핸들러에서 에러가 발생해도 나머지는 계속 실행됨 (에러는 로깅만)
