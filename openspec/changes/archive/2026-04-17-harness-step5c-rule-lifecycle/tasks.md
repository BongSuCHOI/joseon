## 1. 규칙 pruning 후보 관리

- [x] 1.1 prune candidate 판정에 필요한 메타데이터를 정의한다.
- [x] 1.2 candidate-only 상태를 기록하고 guard 충족 전에는 삭제하지 않는다.
- [x] 1.3 `scope: prompt` 예외가 자동 pruning에서 빠지는지 확인한다.

## 2. cross-project 승격 후보

- [x] 2.1 project_key별 패턴 집계와 global 후보 기록 경로를 만든다.
- [x] 2.2 auto promotion을 기본 비활성으로 두고 manual global 경로를 유지한다.
- [x] 2.3 guard 미충족 시 global write가 발생하지 않는지 확인한다.

## 3. 검증

- [x] 3.1 pruning과 cross-project 후보에 대한 단위 테스트를 추가한다.
- [x] 3.2 실제 프로젝트 2개 이상을 가정한 시나리오로 guarded-off 동작을 확인한다.
- [x] 3.3 롤백 시 candidate 로그만 남는지 점검한다.
