## 1. 타입 정의

- [x] 1.1 `src/types.ts`에 `MistakePatternCandidate` 인터페이스 추가 (`id`, `project_key`, `timestamp`, `pattern_identity`, `pattern_keyword`, `pattern_paths`, `source_shadow_ids`, `repetition_count`, `candidate_threshold`, `status`, `mistake_summary_samples`)

## 2. Pattern Identity 함수

- [x] 2.1 `src/harness/improver.ts`에 `computePatternIdentity()` 함수 구현: commit message에서 키워드 추출 (conventional commit prefix 제거 후 첫 의미 단어) + affected_files를 상위 2단계 디렉토리로 정규화하여 결합
- [x] 2.2 `computePatternIdentity()` 단위 테스트: 동일 입력 → 동일 출력, prefix 제거, 경로 정규화, 빈 입력 처리

## 3. Candidate Grouping 로직

- [x] 3.1 `src/harness/improver.ts`에 `getMistakeCandidatePath()` 함수 추가: `projects/{key}/mistake-pattern-candidates.jsonl` 경로 반환
- [x] 3.2 `readMistakeCandidateRecords()` 함수 추가: 기존 candidate JSONL 읽기
- [x] 3.3 `findOrCreateCandidate()` 함수 구현: pattern identity로 기존 candidate 검색 → 있으면 업데이트(source_shadow_ids 추가, count 증가) → 없으면 threshold 충족 시 새 candidate 생성
- [x] 3.4 `groupMistakeCandidates()` 메인 함수 구현: shadow 레코드 전체 읽기 → ambiguous 제외 → pattern identity별 그룹핑 → threshold 이상만 candidate 생성/업데이트

## 4. Shadow append 후 Grouping 연동

- [x] 4.1 `appendMistakeSummaryShadow()` 내에서 ambiguous가 아닌 레코드 append 후 `groupMistakeCandidates()` 호출 추가 (동기)
- [x] 4.2 기존 smoke 테스트가 통과하는지 확인 (regression check)

## 5. 설정 지원

- [x] 5.1 `src/config/schema.ts`의 `HarnessSettings`에 `candidate_threshold` 선택 필드 추가 (기본값 3)
- [x] 5.2 `getHarnessSettings()`에서 기본값 병합 확인

## 6. 테스트

- [x] 6.1 Smoke 테스트 `src/__tests__/smoke-step5e-candidates.ts` 작성: (a) threshold 미만 → candidate 생성 안 됨, (b) threshold 도달 → candidate 생성, (c) ambiguous 제외, (d) 기존 candidate 업데이트, (e) pattern identity 결정성
- [x] 6.2 빌드 통과 확인 (`npm run build`)
- [x] 6.3 기존 전체 테스트 통과 확인
