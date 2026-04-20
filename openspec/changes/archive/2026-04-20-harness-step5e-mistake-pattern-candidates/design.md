## Context

`mistake-pattern-shadow.jsonl`에 MistakeSummaryShadowRecord가 append-only로 쌓이고 있다. 각 레코드는 `commit_hash`, `commit_message`, `affected_files`, `mistake_summary`, `ambiguous` 필드를 갖는다. 현재는 이 레코드를 개별적으로 저장만 할 뿐, 서로 연결하거나 반복 패턴으로 묶는 로직이 없다.

Candidate grouping은 shadow → rule 사이의 징검다리 역할을 한다. shadow는 "관측된 사실"이고, candidate는 "반복되어 규칙 후보가 될 수 있는 패턴"이다.

기존 인프라:
- `appendMistakeSummaryShadow()`: improver.ts에서 이미 구현됨
- `readMistakeSummaryShadowRecords()`: 파일 읽기 유틸 이미 존재
- `appendJsonlRecord()`: 공유 JSONL append 유틸
- `MistakeSummaryShadowRecord`: types.ts에 정의됨

## Goals / Non-Goals

**Goals:**
- 같은 실수 패턴이 여러 커밋에서 반복되면 하나의 candidate로 묶기
- 반복 임계값(기본 3회)을 넘은 패턴만 candidate로 승격
- candidate는 승인 대기 상태로 저장, 자동 rule 생성은 하지 않음
- 기존 shadow 쓰기 경로와 독립적으로 동작

**Non-Goals:**
- LLM 기반 패턴 분석 (deterministic baseline 유지)
- candidate의 자동 rule 생성 (수동 승인 절차는 별도)
- `ambiguous: true` 레코드의 candidate 처리
- cross-project candidate 승격 (5c에서 이미 candidate-only 경로 존재)

## Decisions

### D1: Pattern identity 판단 방식 — 키워드 + 경로 정규화

**선택:** commit message에서 fix 키워드 추출 + affected_files 경로 정규화(디렉토리 기준) 후 결합

**대안:**
- (A) commit message 전체 해시 → 커밋 메시지가 조금만 달라도 다른 패턴이 됨. 너무 엄격
- (B) LLM 임베딩 유사도 → deterministic baseline 원칙 위배
- (C) affected_files 교집합만 → 파일이 겹치더라도 전혀 다른 버그일 수 있음

**근거:** "fix: null check in parser" + `src/parser/` 조합이면 같은 패턴으로 간주하는 게 실용적. 키워드는 commit message에서 `fix`, `bug`, `error`, `crash` 등의 동사/명사를 추출하고, 파일 경로는 최상위 2단계 디렉토리까지 정규화하여 결합.

### D2: Candidate 저장소 — 프로젝트별 JSONL

**선택:** `projects/{key}/mistake-pattern-candidates.jsonl`에 append-only

**대안:**
- (A) state.json 내부에 배열 → 파일이 이미 충분히 큼
- (B) 별도 JSON 파일 (overwrite) → 이력이 사라짐

**근거:** 기존 모든 shadow/candidate 저장소가 JSONL append-only 방식. 일관성 유지. candidate 업데이트 시 기존 레코드를 찾아 새 레코드로 append (idempotent).

### D3: Grouping 발동 시점 — shadow append 직후 동기

**선택:** `appendMistakeSummaryShadow()` 호출 후 바로 candidate grouping 실행

**대안:**
- (A) session.idle에서 배치 처리 → 실시간성이 떨어짐
- (B) 별도 타이머/스케줄러 → 플러그인 아키텍처에 맞지 않음

**근거:** shadow 데이터가 이미 메모리에 로드된 상태에서 후처리하는 게 가장 간단. JSONL 파일이 작을 때는 I/O 비용도 무시 가능.

### D4: 반복 임계값 — 설정 가능, 기본 3

**선택:** `harness.jsonc`에서 `candidate_threshold`로 설정 가능, 기본값 3

**근거:** 1~2회는 우연일 수 있고, 3회 이상이면 패턴으로 볼 근거가 생김. 프로젝트 규모에 따라 조정 필요할 수 있으므로 설정 가능하게.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Pattern identity가 너무 관대해서 다른 버그를 같은 패턴으로 묶음 | 키워드 + 디렉토리 조합으로 충분히 구분. candidate는 어차피 수동 검토 대상 |
| JSONL 파일이 커지면 grouping 성능 저하 | shadow 파일은 fix 커밋 수준이라 극단적으로 커지지 않음. 추후 배치 처리로 전환 가능 |
| 임계값 3이 프로젝트마다 안 맞을 수 있음 | 설정 가능. 초기값은 보수적으로 |
| candidate가 무한정 쌓임 | candidate 상태에 `status: pending/accepted/rejected` 추가하여 관리. 추후 5c prune 인프라와 연동 가능 |

## Open Questions

- candidate `accepted` 처리를 위한 UI/인터페이스는 별도 change에서 다룰지, 이 change에서 최소한의 CLI/파일 기반 승인까지만 구현할지
