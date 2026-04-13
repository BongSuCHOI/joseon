## 1. 에러 복구 모듈

- [ ] 1.1 `src/orchestrator/error-recovery.ts`에 `attemptRecovery(projectKey, error, context)` 함수 구현 — 현재 단계 파악 (error-recovery.jsonl에서 마지막 시도 확인)
- [ ] 1.2 1차 직접수정 반환: `{ stage: 1, action: "direct_fix" }`
- [ ] 1.3 2차 구조변경 반환: `{ stage: 2, action: "structural_change" }`
- [ ] 1.4 3차 다른 모델 rescue 반환: `{ stage: 3, action: "cross_model_rescue" }`
- [ ] 1.5 4차 리셋 반환: `{ stage: 4, action: "reset" }`
- [ ] 1.6 4차도 실패 시 사용자 에스컬레이션: `{ stage: 5, action: "escalate_to_user" }`
- [ ] 1.7 각 시도 이력을 `projects/{key}/error-recovery.jsonl`에 append (timestamp, stage, action, error_summary, result)

## 2. QA 실패 추적 모듈

- [ ] 2.1 `src/orchestrator/qa-tracker.ts`에 `trackQAFailure(projectKey, scenarioId, detail)` 함수 구현
- [ ] 2.2 `projects/{key}/qa-failures.json` 파일 읽기/쓰기 (파일 없으면 초기화)
- [ ] 2.3 동일 시나리오 1~2회 실패 시 `{ verdict: "retry", count: N }` 반환
- [ ] 2.4 동일 시나리오 3회 실패 시 `{ verdict: "escalate", count: 3 }` 반환
- [ ] 2.5 각 실패에 `{ timestamp, detail }`을 details 배열에 추가

## 3. 빌드 및 스모크 테스트

- [ ] 3.1 `npm run build` 통과 확인
- [ ] 3.2 스모크 테스트 작성: 에러 복구 1→2→3→4→5 단계 진행 확인
- [ ] 3.3 스모크 테스트 작성: QA 실패 retry→retry→escalate 확인, 시나리오별 독립 추적 확인
- [ ] 3.4 기존 Step 1/3 스모크 테스트 여전히 통과 확인
