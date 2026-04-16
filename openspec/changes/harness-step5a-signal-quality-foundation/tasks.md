## 1. 그림자 판정 기반

- [ ] 1.1 phase/signal shadow 레코드 스키마와 저장 경로를 정의한다.
- [ ] 1.2 deterministic 결과를 유지한 채 LLM 그림자 phase/signal 판정을 기록한다.
- [ ] 1.3 fix diff에서 `mistake_summary`를 추출해 append-only 로그에 남긴다.

## 2. Ack 강화 가드

- [ ] 2.1 written/accepted ack를 분리하는 가드 경로를 구현한다.
- [ ] 2.2 가드가 없거나 실패하면 기존 ack 동작을 그대로 유지한다.
- [ ] 2.3 shadow-only 상태에서 기존 사용자 흐름이 깨지지 않는지 확인한다.

## 3. 검증

- [ ] 3.1 shadow 전용 단위 테스트를 추가한다.
- [ ] 3.2 실제 세션 1회로 shadow 기록과 기존 deterministic 경로 보존을 확인한다.
- [ ] 3.3 실패 시 롤백 기준을 문서화한다.
