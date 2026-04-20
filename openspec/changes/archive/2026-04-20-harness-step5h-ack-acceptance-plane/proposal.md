## Why

현재 `evaluateAckAcceptance()`는 `acceptance_check: 'rule_written'` 단일 체크만 수행한다 — "rule 파일이 디스크에 존재하는가?" 이것은 "파일이 써졌는가"를 확인할 뿐 "목적을 만족했는가"를 판정하지 않는다. acceptance plane을 multi-check 구조로 확장하여, accepted 판정의 근거를 명확히 하고 후속 고도화의 기반을 마련해야 한다.

**탐색-결정 논리 체인:**

1. **Q1 — Scope:** A(메타데이터)/B(effectiveness 연동)/C(다단계) 중 **A 선택.** 근거: effectiveness는 30일 주기로, 방금 생성된 규칙의 accepted 판정 타이밍과 맞지 않음. re-evaluate 트리거가 없어 구조 변경이 필요. B는 별도 고도화 항목으로 분리하는 게 적절.
2. **Q2 — no_recent_recurrence 포함 여부:** 포함 안 함 선택. 근거: 이 체크가 의미하려면 "accepted → demoted" 취소 메커니즘이 전제되어야 함. 현재 accepted는 단방향(되돌림 없음). 취소 메커니즘은 accepted 레코드가 충분히 축적된 후, "accepted인데 재발한" 사례가 실제 확인될 때 설계 (YAGNI).
3. **Q3 — accepted=true의 실제 효과:** passive(로그만) 선택. 근거: Q1에서 체크 깊이가 "형태 검증" 수준이므로, 여기에 시스템 행동 변화(prune 보호 등)를 부여하면 체크 깊이와 혜택의 균형이 무너짐. 효과는 check 깊이가 올라간 후속 Step에서 부여.

**현재 상태:** `ack_guard_enabled`(default false)로 written/accepted 분리 기록만 있음. `evaluateAckAcceptance()`는 `ruleExists()` 1개 체크.

**이후 고도화 경로:**

| 단계 | acceptance_check 추가 | 전제 조건 | 변화 |
|------|----------------------|-----------|------|
| 5h (지금) | `rule_written`, `rule_valid`, `not_prune_candidate` | 없음 | multi-check 기반 구조 확립 |
| 후속 A | `effectiveness_confirmed` | 30일+ 규칙 축적, effectiveness 데이터 검증 | accepted = "실제 효과 입증" |
| 후속 B | `no_recent_recurrence` | accepted 취소/강등 메커니즘 설계 | accepted = "재발 억제 중" |
| 후속 C | `not_false_positive` | canary mismatch 데이터로 오탐 규칙 식별 | accepted = "오탐 아님 확인" |

후속 A/B/C 충족 후, accepted 규칙에 **prune 보호** 또는 **compacting 우선순위 가산** 등의 시스템 혜택을 부여할 수 있음. 이때 체크 깊이와 혜택의 균형이 맞음.

## What Changes

- `evaluateAckAcceptance()`를 `rule_written` 단일 체크에서 multi-check 구조로 확장
  - `rule_written`: rule 파일 존재 (기존)
  - `rule_valid`: rule JSON 파싱 + 필수 필드 존재 (신규)
  - `not_prune_candidate`: 규칙이 prune_candidate가 아님 (신규)
- `AckRecord` 타입 확장: 단일 `acceptance_check` → 통과/실패 check 목록 + 판정 결과
- `appendAckRecord()` 호출부가 새로운 평가 결과를 기록하도록 수정
- `ack_guard_enabled=true`일 때 accepted 판정이 multi-check 결과를 반영
- **시스템 행동 변화 없음** (passive). accepted=true여도 규칙의 compacting/prune/동작이 바뀌지 않음

## Capabilities

### New Capabilities
- `ack-acceptance-plane`: multi-check acceptance evaluation + accepted 레코드 누적. 체크 항목: rule_written, rule_valid, not_prune_candidate. passive(로그만, 시스템 효과 없음)

### Modified Capabilities
- `harness-step5a-signal-quality-foundation`: guarded ack strengthening 시나리오가 acceptance_check='rule_written' 단일에서 multi-check 구조로 확장됨. 기존 ack 흐름은 유지, 평가만 다중화

## Impact

- `src/types.ts`: `AckRecord` 인터페이스 변경 (필드 확장)
- `src/harness/improver.ts`: `evaluateAckAcceptance()` 시그니처 및 내부 로직 확장, 호출부 수정
- `src/config/schema.ts`: 변경 없음 (기존 `ack_guard_enabled` 재사용)
- `src/__tests__/smoke-step5h-ack-acceptance.ts`: 신규 테스트 파일
- 기존 테스트 `smoke-step5a-foundation.ts`의 ack 관련 assertion 업데이트 필요 가능
