## 1. 타입 확장

- [x] 1.1 `src/types.ts`에 `Signal` 타입에 `agent_id?: string` optional 필드 추가
- [x] 1.2 `src/types.ts`에 `PhaseState` 인터페이스 추가 (`current_phase`, `phase_history`, `qa_test_plan_exists`, `incomplete_phase?`)
- [x] 1.3 `src/types.ts`에 `QAFailures` 인터페이스 추가 (`[scenarioId: string]: { count, last_failure_at, details[] }`)
- [x] 1.4 `src/types.ts`에 `EvalResult` 인터페이스 추가 (`total_checks`, `passed_checks`, `hard_ratio`, `failures[]`)
- [x] 1.5 `npm run build` 통과 확인 (기존 코드에 영향 없음)

## 2. Phase Manager 모듈

- [x] 2.1 `src/orchestrator/` 디렉토리 생성
- [x] 2.2 `src/orchestrator/phase-manager.ts`에 `getPhaseState(worktree)` 구현 (파일 없으면 초기화, JSON 파싱 실패 시 Phase 1 폴백)
- [x] 2.3 `src/orchestrator/phase-manager.ts`에 `transitionPhase(worktree, targetPhase)` 구현 (이전 Phase completed_at 기록, 새 Phase entered_at 기록, 동일 Phase면 no-op)
- [x] 2.4 `transitionPhase`에 Phase 2.5 gate 구현 (targetPhase === 3일 때 `docs/qa-test-plan.md` 존재 확인, 없으면 throw Error with "[ORCHESTRATOR BLOCK]")
- [x] 2.5 `src/orchestrator/phase-manager.ts`에 `resetPhase(worktree)` 구현 (current_phase: 1, phase_history: [] 로 초기화)
- [x] 2.6 `getPhaseState` 반환값에 미완료 Phase 감지 추가 (마지막 history entry에 completed_at 없으면 incomplete_phase 필드 설정)

## 3. PID 세션 차단

- [x] 3.1 `src/harness/observer.ts`에 `isProcessRunning(pid)` 함수 추가 (process.kill(pid, 0)으로 생존 확인)
- [x] 3.2 `src/harness/observer.ts`에 `acquireSessionLock(projectKey)` 함수 추가 (PID 파일 쓰기, stale lock 감지 및 교체, 활성 lock 시 경고 로그)
- [x] 3.3 observer의 `session.created` 핸들러에 `acquireSessionLock` 호출 추가
- [x] 3.4 observer의 `session.idle` 핸들러에 PID lock 파일 삭제 로직 추가

## 4. 빌드 및 스모크 테스트

- [x] 4.1 `npm run build` 통과 확인
- [x] 4.2 스모크 테스트 작성: Phase Manager (Phase 전환, 2.5 gate, 리셋, 미완료 감지, 손상 파일 폴백)
- [x] 4.3 스모크 테스트 작성: PID Lock (최초 생성, stale lock 교체, 활성 lock 경고, 정리)
- [x] 4.4 기존 Step 1/3 스모크 테스트 여전히 통과 확인
- [x] 4.5 배포 동기화 — `.opencode/plugins/harness/`에 빌드 결과 복사
