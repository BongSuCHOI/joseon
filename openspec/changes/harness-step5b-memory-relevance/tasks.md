## 1. 상위 기억 그림자 기록

- [ ] 1.1 Extract / Consolidate / Relate / Recall 후보 레코드 형식을 정의한다.
- [ ] 1.2 세션 아카이브와 memory fact 처리에서 shadow 기록을 append-only로 남긴다.
- [ ] 1.3 기존 Search 결과가 shadow 기록으로 바뀌지 않는지 확인한다.

## 2. 의미 기반 compacting 필터

- [ ] 2.1 semantic relevance 필터를 default-off로 구현한다.
- [ ] 2.2 필터 비활성 시 현재 compacting 동작을 그대로 유지한다.
- [ ] 2.3 활성 시 metadata-first 순서로 후보를 정렬하는 로직을 추가한다.

## 3. 검증

- [ ] 3.1 상위 기억 shadow와 compacting shadow에 대한 단위 테스트를 추가한다.
- [ ] 3.2 실제 세션 1회로 Search baseline과 shadow 비교 로그를 확인한다.
- [ ] 3.3 default-off 회귀 여부를 점검한다.
