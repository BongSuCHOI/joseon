## 1. 통합 스모크 테스트

- [ ] 1.1 `test/smoke-test-step4.ts` 파일 생성
- [ ] 1.2 Phase Manager 통합 테스트: Phase 1→2→3(gate 차단)→3(gate 통과)→4→5→리셋 전체 흐름
- [ ] 1.3 에러 복구 통합 테스트: 1→2→3→4→에스컬레이션 + 이력 파일 기록 확인
- [ ] 1.4 QA 추적 통합 테스트: 시나리오별 retry→retry→escalate + 독립 추적 확인
- [ ] 1.5 PID Lock 통합 테스트: 생성→활성 lock 감지→stale lock 교체→정리
- [ ] 1.6 에이전트 등록 통합 테스트: config 콜백이 opencodeConfig에 에이전트 병합 확인
- [ ] 1.7 Orchestrator hooks 통합 테스트: mergeEventHandlers에 4개 플러그인 hooks 포함 확인

## 2. 문서 업데이트

- [ ] 2.1 전체 md 파일 검색 후 업데이트 필요 항목 파악
- [ ] 2.2 AGENTS.md: Step 4 상태 "✅ 완료" 업데이트
- [ ] 2.3 README.md: Step 4 상태 + 오케스트레이션 아키텍처 설명 업데이트
- [ ] 2.4 development-guide.md: Step 4 테스트 결과 + 새 모듈 배포 절차 추가

## 3. 최종 검증

- [ ] 3.1 `npm run build` 통과 확인
- [ ] 3.2 전체 스모크 테스트 (Step 1 + Step 3 + Step 4) 통과 확인
- [ ] 3.3 배포 동기화 최종 확인
