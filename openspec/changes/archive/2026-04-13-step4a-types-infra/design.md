## Context

Step 1~3에서 구현된 하네스(observer, enforcer, improver)는 L1~L6 성숙도를 달성했다. Step 4(오케스트레이션)는 하네스 위에서 동작하며, 에이전트 기반 Phase 관리를 통해 대규모 구현 작업을 체계적으로 진행한다.

현재 코드베이스:
- `src/types.ts`: Signal, Rule, ProjectState 타입 정의 (57줄)
- `src/harness/observer.ts`: L1 관측 + L2 신호 변환 (111줄)
- `src/shared/utils.ts`: getProjectKey, ensureHarnessDirs, logEvent, mergeEventHandlers (101줄)

Step 4의 후속 Change(에이전트 정의, 에러 복구, Orchestrator 통합)가 공통으로 의존하는 타입과 기반 모듈을 먼저 구현해야 한다.

## Goals / Non-Goals

**Goals:**
- Step 4 후속 Change가 의존하는 타입 계약 확정
- Phase Manager를 독립 모듈로 구현하여 단위 테스트 가능하게
- PID 파일로 같은 프로젝트 동시 세션 차단
- 기존 Step 1~3 코드에 zero-impact

**Non-Goals:**
- 에이전트 정의/프롬프트 (Change B)
- 에러 복구 4단계 (Change C)
- Orchestrator 플러그인 메인 (Change D)
- 실동작 통합 테스트 (Change E)

## Decisions

### D1: Phase 상태 파일 위치 — `.opencode/` (프로젝트 레벨)

Phase 상태는 프로젝트별 작업 진행 상황이므로 프로젝트 worktree 내부에 배치.

```
{project}/.opencode/orchestrator-phase.json
```

**대안 검토:**
- `~/.config/opencode/harness/projects/{key}/`: 가능하지만, Phase 상태는 프로젝트 단위로 Git과 함께 관리되는 것이 자연스러움. 사용자가 `.gitignore` 여부를 직접 결정 가능.

### D2: Phase 5 완료 시 리셋 (AGENTS.md 확정)

Phase 상태 파일의 역할은 "지금 어디에 있는가"이지 "과거에 어디에 있었는가"가 아님. 완료 시 초기화.

### D3: PID 파일 위치 — `~/.config/opencode/harness/projects/{key}/` (글로벌 런타임)

PID 파일은 세션 관리 메타데이터이므로 런타임 데이터 디렉토리에 배치. `ensureHarnessDirs()`에서 이미 생성하는 `projects/{key}/` 경로 활용.

### D4: Phase 2.5 gate는 Phase Manager 내부에서 구현

`transitionPhase(ctx, 3)` 호출 시 자동으로 qa-test-plan.md 존재 확인. 에이전트 프롬프트가 아닌 코드 레벨에서 강제.

### D5: Signal에 agent_id 추가는 optional

`agent_id?: string` — Step 1~3에서 생성한 signal에는 필드가 없어도 동작. Step 4에서 오케스트레이터가 필요시 주입.

## Risks / Trade-offs

- [Phase 파일 손상] → JSON 파싱 실패 시 빈 상태로 폴백 (Phase 1로 시작)
- [PID 파일 잔존] → Stale lock 감지 로직으로 해소 (PID 생존 확인)
- [Phase 2.5 gate가 너무 엄격] → Phase 2.5는 코드 레벨 강제이므로, 사용자가 qa-test-plan.md를 빈 파일로 만들면 우회 가능. 의도된 동작.
