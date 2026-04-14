## Context

Change A(Phase Manager, PID), Change B(에이전트), Change C(에러 복구, QA)의 모듈을 하나의 Orchestrator 플러그인으로 통합한다.

의존성: Change A, B, C 전부 완료 후 진행.

## Goals / Non-Goals

**Goals:**
- Orchestrator 플러그인의 훅 구성 (event, tool.execute.before 등)
- src/index.ts 진입점에 Orchestrator 추가
- signal에 agent_id 필드 주입

**Non-Goals:**
- 개별 모듈의 내부 로직 변경
- 새로운 기능 추가

## Decisions

### D1: Orchestrator는 event 훅만 사용

Phase Manager는 @build 에이전트 프롬프트에서 호출. Orchestrator 플러그인은 session.idle에서 정리 작업만.

### D2: mergeEventHandlers로 기존 + Orchestrator 병합

Step 1~3의 observer + enforcer + improver hooks에 Orchestrator hooks를 추가. 기존 패턴 유지.

## Risks / Trade-offs

- [훅 실행 순서] → mergeEventHandlers가 순차 실행 보장. 이미 검증된 패턴
