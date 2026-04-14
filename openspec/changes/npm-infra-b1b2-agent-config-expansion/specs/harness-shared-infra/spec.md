## ADDED Requirements

### Requirement: parseList utility exported from shared
`src/shared/utils.ts`의 `parseList()` 함수는 shared 배럴 인덱스를 통해 export된다.

#### Scenario: Import parseList from shared
- **WHEN** 다른 모듈에서 `import { parseList } from '../shared/index.js'`를 호출함
- **THEN** `parseList` 함수가 사용 가능함
