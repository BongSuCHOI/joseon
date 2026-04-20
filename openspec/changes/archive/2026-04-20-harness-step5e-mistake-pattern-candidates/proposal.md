## Why

`mistake_summary` shadow 레코드가 `mistake-pattern-shadow.jsonl`에 append-only로 쌓이고 있지만, 개별 레코드는 서로 연결되지 않은 채 방치된다. 같은 실수가 여러 커밋에서 반복되어도 시스템이 이를 "반복 패턴"으로 인식하지 못한다. 규칙 생성 전 단계인 **candidate grouping**이 없어서, shadow → rule 사이의 징검다리가 빠져 있다.

## What Changes

- **Mistake pattern candidate grouping**: `mistake-pattern-shadow.jsonl`의 개별 레코드를 읽어, 같은 패턴으로 묶이는 것들을 `mistake-pattern-candidates.jsonl`에 candidate로 기록
- **Pattern identity 기준**: commit message 키워드 + affected 파일 경로 정규화로 패턴 동일성 판단. LLM은 사용하지 않음 (deterministic baseline 유지)
- **반복 임계값**: 같은 패턴이 N회 이상(기본 3회) 관측되면 candidate로 승격. 1~2회는 shadow에만 머뭄
- **자동 rule 생성 없음**: candidate 파일은 "승인 대기" 상태일 뿐, rule을 자동으로 만들지 않음. 수동 검토 후 별도 승인 절차 필요
- **Ambiguous 레코드 제외**: `ambiguous: true`인 shadow 레코드는 candidate grouping에서 제외

## Capabilities

### New Capabilities
- `mistake-pattern-candidates`: shadow 레코드를 반복 패턴으로 묶어 candidate로 기록하는 기능. pattern identity, 반복 임계값, candidate 스키마 포함

### Modified Capabilities
- `harness-step5a-signal-quality-foundation`: 기존 `appendMistakeSummaryShadow`가 쓴 shadow를 candidate grouper가 읽어들이는 consumer 관계 성립. 기존 쓰기 경로는 변경 없음

## Impact

- **코드**: `src/harness/improver.ts`에 candidate grouping 로직 추가. `src/types.ts`에 `MistakePatternCandidate` 타입 추가
- **데이터**: 프로젝트별 `projects/{key}/mistake-pattern-candidates.jsonl` 신규 생성
- **설정**: `candidate_threshold` (기본 3) 설정 항목 추가 가능 (harness.jsonc)
- **기존 경로**: shadow 쓰기 경로, rule 생성 경로 모두 변경 없음. 읽기만 추가
