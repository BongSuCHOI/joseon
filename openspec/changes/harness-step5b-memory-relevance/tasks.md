## 1. 범위 축소 및 shadow 기록

- [x] 1.1 OpenSpec proposal / design / spec / tasks를 reduced-safe 5b 범위로 정리한다.
- [x] 1.2 session log → fact 인덱싱 시 Extract shadow 기록을 append-only로 남긴다.
- [x] 1.3 기존 Search / compacting baseline이 비활성 상태에서 유지되는지 확인한다.

## 2. 의미 기반 compacting 필터

- [x] 2.1 semantic compacting opt-in 설정과 relevance shadow 로그를 추가한다.
- [x] 2.2 필터 비활성 시 현재 compacting 동작을 그대로 유지한다.
- [x] 2.3 활성 시 metadata-first 순서로 후보를 정렬하는 로직을 추가한다.

## 3. 검증 및 동기화

- [x] 3.1 Extract shadow / compacting shadow / default-off 회귀 테스트를 추가한다.
- [x] 3.2 빌드, smoke, 필요 시 tmux 실세션 sanity check로 기본 응답 경로를 검증한다.
- [x] 3.3 관련 문서와 체크리스트를 현재 reduced-safe 5b 상태에 맞게 동기화한다.
