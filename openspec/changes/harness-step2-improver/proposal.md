## Why

Step 1에서 L1(관측)~L4(규칙 차단)까지 동작하는 기본 하네스를 완성했다. 하지만 규칙은 수동으로만 생성할 수 있고, signal이 pending에 방치되며, SOFT→HARD 승격이 자동으로 일어나지 않는다. Step 2는 improver 플러그인을 추가하여 "신호→규칙 자동 생성→효과 측정→승격/폐기" 사이클(L5~L6)을 완성한다. 이것이 하네스의 핵심 차별점인 폐루프 자가개선을 실현하는 단계다.

## What Changes

- **harness-improver 플러그인 신규 구현**: `event`(session.idle) 훅에서 pending signal을 자동으로 SOFT 규칙으로 변환, SOFT→HARD 자동 승격, 30일 효과 측정, 프로젝트 상태 갱신
- **experimental.session.compacting 훅 추가**: 컴팩션 시 scaffold + HARD/SOFT 규칙을 컨텍스트에 주입 (scope: 'prompt' 규칙의 유일한 강제 수단)
- **Loop 1 (fix: 커밋 학습) 구현**: session.idle 시 세션 내 fix: 커밋을 감지하여 fix_commit signal 생성 → scaffold NEVER DO 자동 추가
- **index.ts 수정**: improver export 추가 + event 훅 병합 유틸리티(mergeEventHandlers) 도입 (기존 스프레드 연산자는 observer의 event 핸들러를 덮어쓰는 버그가 있음)
- **Signal 중복 처리**: signalToRule()에서 동일 pattern.match의 규칙이 이미 존재하는지 soft+hard 양쪽 체크
- **violation_count 버그 수정**: promoteRules() 승격 시 카운터 리셋, evaluateRuleEffectiveness()는 delta 기반 측정

## Capabilities

### New Capabilities
- `harness-improver`: L5 자동 수정 + L6 폐루프. signal→규칙 자동 변환, SOFT→HARD 자동 승격, 30일 효과 측정, fix: 커밋 학습, compacting 컨텍스트 주입, 프로젝트 상태 갱신

### Modified Capabilities
- `harness-shared-infra`: mergeEventHandlers 유틸리티 추가 (event 훅 병합)
- `harness-observer`: session.created 시 타임스탬프 기록 (fix: 커밋 감지의 세션 시작 시점 필요)

## Impact

- **새 코드**: `src/harness/improver.ts` (신규, ~250줄), `src/index.ts` (수정), `src/shared/utils.ts` (mergeEventHandlers 추가)
- **런타임 데이터**: `~/.config/opencode/harness/`의 rules/, signals/ack/, projects/state.json, rules/history.jsonl 자동 갱신
- **의존성**: 변경 없음 (기존 fs, path, crypto만 사용)
- **배포**: index.ts에 improver export 추가. 기존 observer/enforcer 동작에 영향 없음 (event 훅 병합으로 해결)
- **v3 가이드 버그 수정**: event 훅 덮어쓰기 버그(C1), violation_count 누적값 버그(W3)를 구현에서 수정
