## Context

**현재 상태:**

`evaluateAckAcceptance()` (improver.ts L452-468)는 `ruleExists()` 1개 체크만 수행. `ack_guard_enabled=true`일 때 signal→rule 변환 직후 `session.idle`에서 평가. 결과는 `ack-status.jsonl`에 append-only로 기록.

**AckRecord 구조** (types.ts L154-164):
```
signal_id, project_key, timestamp, state('written'|'accepted'),
signal_type, guard_enabled, acceptance_check('rule_written'),
accepted(boolean), reason(string)
```

**제약:** `acceptance_check`는 현재 리터럴 `'rule_written'` 단일값. 다중 체크 결과를 담을 구조가 아님.

**호출부** (improver.ts L1350-1378): guard 켜짐 → `evaluateAckAcceptance()` → 통과 시 accepted 레코드 추가 기록.

## Goals / Non-Goals

**Goals:**
- `evaluateAckAcceptance()`를 multi-check evaluator로 확장 (rule_written + rule_valid + not_prune_candidate)
- `AckRecord`가 각 check의 통과/실패를 기록하여 후속 분석 가능하게
- 기존 흐름 변경 최소: `ack_guard_enabled=false`에서는 동작 동일
- 후속 고도화(effectiveness_confirmed, no_recent_recurrence)의 확장 포인트 제공

**Non-Goals:**
- accepted=true 규칙에 시스템 혜택(prune 보호, compacting 가산 등) 부여 — 후속 Step
- accepted 취소/강등(demotion) 메커니즘 — 후속 Step
- `no_recent_recurrence` 체크 — 취소 메커니즘 전제 필요
- `effectiveness_confirmed` 체크 — re-evaluate 트리거 설계 선행 필요
- LLM 기반 acceptance 판정

## Decisions

### D1: AckRecord 필드 확장 방식

**기존:** `acceptance_check: 'rule_written'` (string literal)

**선택: checks_passed + checks_failed + verdict로 확장**

```typescript
// Before
acceptance_check: 'rule_written';
accepted: boolean;
reason: string;

// After
acceptance_checks_passed: string[];   // ['rule_written', 'rule_valid', 'not_prune_candidate']
acceptance_checks_failed: Array<{ check: string; reason: string }>;
acceptance_verdict: 'accepted' | 'rejected';
reason: string;  // 요약 (예: 'all_3_checks_passed' 또는 'failed: rule_valid')
```

**대안 검토:**

| 대안 | 장점 | 단점 | 판단 |
|------|------|------|------|
| acceptance_check를 string→enum으로 | 타입 안전 | 후속 check 추가 시 enum 수정 필요, 기존 레코드 호환성 | ❌ |
| checks_passed/failed 배열 | 확장 가능, 읽기 쉬움 | 필드 3개 추가 | ✅ 채택 |
| JSON string 필드 1개 | 필드 1개 | 파싱 필요, 쿼리 불편 | ❌ |

**근거:** 배열 필드는 후속 check 추가 시 코드 변경 없이 레코드만 확장됨. canary mismatch 로그(5f/5g)에서 증명한 패턴과 동일.

### D2: 체크 항목 구현

**Check 1: rule_written (기존 유지)**
- 로직: `ruleExists(patternMatch, projectKey)` — 기존 `ruleExists()` 재사용
- 실패 사유: `'rule_file_not_found'`

**Check 2: rule_valid (신규)**
- 로직: rule 파일을 JSON.parse → 필수 필드(id, type, pattern, description) 존재 확인
- 실패 사유: `'rule_json_parse_error'` | `'rule_missing_required_fields'`
- 구현: 기존 `ruleExists()`를 확장하여 rule 객체 자체를 반환하는 `findRule()` 도입, 여기서 valid 체크까지 수행

**Check 3: not_prune_candidate (신규)**
- 로직: rule.prune_candidate === undefined 또는 rule.prune_candidate.guard_enabled === false
- 실패 사유: `'rule_is_prune_candidate'`
- 구현: Check 2에서 얻은 rule 객체의 prune_candidate 필드 확인

**체크 순서:** rule_written → rule_valid → not_prune_candidate. 순서대로, 하나라도 실패하면 이후 체크 생략(short-circuit). 이유: 파일이 없으면 파싱할 수 없고, 파싱이 안 되면 필드를 확인할 수 없음.

### D3: evaluateAckAcceptance 시그니처 변경

```typescript
// Before
export function evaluateAckAcceptance(
    signal: Signal,
    ackPath: string
): { accepted: boolean; reason: string; acceptance_check: 'rule_written' }

// After
export function evaluateAckAcceptance(
    signal: Signal,
    ackPath: string
): AckAcceptanceResult

// 새 타입
interface AckAcceptanceResult {
    checks_passed: string[];
    checks_failed: Array<{ check: string; reason: string }>;
    verdict: 'accepted' | 'rejected';
    reason: string;
}
```

`ackPath` 파라미터는 하위 호환을 위해 유지(현재 사용하지 않지만 제거하면 호출부 수정 증가).

### D4: 기존 AckRecord 타입 마이그레이션

기존 `acceptance_check: 'rule_written'` 필드를 deprecated 처리. 새 레코드는:
- `acceptance_checks_passed`, `acceptance_checks_failed`, `acceptance_verdict` 사용
- `acceptance_check` 필드는 이전 버전 호환을 위해 쓰지 않음 (값 없음)
- 기존 `accepted: boolean` 필드는 `acceptance_verdict`와 동일 의미로 유지 (호환)

### D5: findRule 헬퍼 도입

`ruleExists()`는 boolean만 반환. multi-check를 위해 rule 객체 자체가 필요하므로:

```typescript
function findRule(patternMatch: string, projectKey: string): Rule | null
```

`ruleExists()`는 `findRule() !== null`로 리팩토링. 기존 `ruleExists()` 호출부는 영향 없음.

## Risks / Trade-offs

**[Risk] 기존 ack-status.jsonl 스키마 파편화** → 새 레코드와 구 레코드가 다른 필드를 가짐. 하지만 append-only이므로 구 레코드는 읽기만 하고, 쓰기는 항상 새 스키마. 읽는 코드가 두 스키마를 모두 처리해야 함 → 로깅만 하므로 읽는 코드가 거의 없음. 리스크 낮음.

**[Risk] rule_valid 체크가 엄격하면 accepted 비율이 낮아짐** → 필수 필드 체크만(id, type, pattern, description)으로 제한. signalToRule()이 항상 이 필드들을 생성하므로, 정상 경로에서는 거의 항상 통과. 실패는 파일 corruption 등 비정상 케이스만.

**[Trade-off] 체크가 shallow하면 accepted의 의미가 약함** → 의도적. 5h은 "기반 구조 확립"이 목적. 체크 깊이는 후속 Step에서 점진적 추가. shallow check에 시스템 혜택을 주지 않음(passive)으로 일관성 유지.

## Open Questions

없음 — 탐색 단계에서 3개 의사결정이 모두 확정됨.

## 후속 고도화 로드맵

```
5h (지금):  multi-check 기반 구조 + passive 로그
             │
             │  [전제: 30일+ 규칙 축적]
             ▼
후속 A:    + effectiveness_confirmed check
             → accepted = "실제 효과 입증"
             → 이때부터 accepted 규칙에 prune 보호 검토 가능
             │
             │  [전제: accepted 레코드 50+, 취소 사례 확인]
             ▼
후속 B:    + no_recent_recurrence check
             + accepted → demoted 메커니즘
             → accepted = "재발 억제 중"
             → demoted 규칙은 재평가 대상
             │
             │  [전제: canary mismatch 데이터 충분]
             ▼
후속 C:    + not_false_positive check
             → accepted = "오탐 아님 확인"
             → 최종: accepted 규칙에 compacting 우선순위 가산 검토
```
