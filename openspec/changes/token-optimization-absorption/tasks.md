## 1. 타입 및 설정 기반 작업

- [x] 1.1 `src/types.ts` — `Signal.type` 유니온에 `'tool_loop' | 'retry_storm' | 'excessive_read'` 추가
- [x] 1.2 `src/types.ts` — `MemoryFact` 인터페이스에 `last_accessed_at?: number`, `access_count?: number` 필드 추가
- [x] 1.3 `src/config/schema.ts` — `HarnessSettings`에 `tool_loop_threshold`(기본 5), `retry_storm_threshold`(기본 3), `excessive_read_threshold`(기본 4), `fact_ttl_days`(기본 30), `fact_ttl_extend_threshold`(기본 5) 설정 추가

## 2. Observer 낭비 탐지기 구현

- [x] 2.1 `src/harness/observer.ts` — `tool.execute.after` 핸들러에 세션별 인메모리 추적 맵(`toolCallCounts`, `retryCycles`, `fileReadCounts`) 추가 및 세션 생성/삭제 시 초기화 로직 구현
- [x] 2.2 `src/harness/observer.ts` — tool_loop 감지: 동일 툴+args_fingerprint 카운트가 `tool_loop_threshold` 도달 시 `tool_loop` signal 생성 로직 구현
- [x] 2.3 `src/harness/observer.ts` — retry_storm 감지: 에러→재시도 사이클 카운트가 `retry_storm_threshold` 도달 시 `retry_storm` signal 생성 로직 구현
- [x] 2.4 `src/harness/observer.ts` — excessive_read 감지: Read 툴의 동일 파일 카운트가 `excessive_read_threshold` 도달 시 `excessive_read` signal 생성 로직 구현
- [x] 2.5 `src/harness/observer.ts` — 3개 신호 모두 기존 `writeSignal()` 호출로 `pending/`에 기록, `project_key` 포함 확인

## 3. Improver 맵핑 확장

- [x] 3.1 `src/harness/improver.ts` — `mapSignalTypeToScope()`에 `tool_loop`, `retry_storm`, `excessive_read` → `scope: 'tool'` 매핑 추가
- [x] 3.2 `src/harness/improver.ts` — `signalToRule()`에서 새 신호 타입의 description 생성 로직 추가 (tool_name, args_fingerprint 등 payload 활용)

## 4. Memory Fact 접근 추적 및 TTL

- [x] 4.1 `src/harness/improver.ts` — `indexSessionFacts()`에서 새 fact 생성 시 `last_accessed_at=Date.now()`, `access_count=0` 초기화
- [x] 4.2 `src/harness/improver.ts` — 기존 fact 로드 시 `last_accessed_at`/`access_count` 누락 시 기본값 적용 (`last_accessed_at=created_at 타임스탬프`, `access_count=0`)
- [x] 4.3 `src/harness/improver.ts` — `session.idle` 처리에 fact 접근 추적 로직 추가: compacting 시 주입된 fact의 `access_count++`, `last_accessed_at` 업데이트
- [x] 4.4 `src/harness/improver.ts` — TTL 기반 prune 후보 마킹: `access_count=0` & 생성 후 `fact_ttl_days` 경과 → `prune_candidate` 마킹 (기존 `markPruneCandidates()`에 병합)
- [x] 4.5 `src/harness/improver.ts` — TTL 연장: `access_count >= fact_ttl_extend_threshold`인 fact는 TTL 2배 적용

## 5. 3계층 점진적 공개 (Memory Recall)

- [x] 5.1 `src/harness/improver.ts` — `formatFactLayer()` 헬퍼 구현: Layer 1(id+keywords), Layer 2(keywords+첫문장), Layer 3(전체내용) 포맷 반환
- [x] 5.2 `src/harness/improver.ts` — `buildCompactionContext()` 수정: semantic compacting 활성화 시 fact를 점수 기준으로 3계층 분할 (상위 30%→L3, 중간 40%→L2, 하위 30%→L1)
- [x] 5.3 `src/harness/improver.ts` — semantic compacting 비활성화 시 또는 fact ≤ 2개 시 기존 방식(L3 전체) 유지
- [x] 5.4 `src/harness/improver.ts` — shadow record에 각 fact의 `layer` 필드 추가

## 6. Canary 확장

- [x] 6.1 `src/harness/canary.ts` — `mapSignalTypeToCanaryCategory()`에 새 신호 타입 매핑 추가 (tool_loop, retry_storm, excessive_read → 'waste_detector' 카테고리)

## 7. 테스트

- [x] 7.1 Observer 낭비 탐지기 단위 테스트: tool_loop 5회 누적 → signal 생성, 4회 → 미생성
- [x] 7.2 Observer 낭비 탐지기 단위 테스트: retry_storm 3사이클 → signal 생성, 성공적 재시도 → 미생성
- [x] 7.3 Observer 낭비 탐지기 단위 테스트: excessive_read 4회 → signal 생성, 다른 파일 → 미생성
- [x] 7.4 Improver 맵핑 테스트: 새 신호 타입 → scope:'tool' 매핑 확인
- [x] 7.5 Fact 접근 추적 테스트: compacting 주입 시 access_count 증가, 미주입 시 불변 확인
- [x] 7.6 TTL prune 테스트: 30일 미접속 → prune_candidate 마킹, 5회 이상 접근 → TTL 연장 확인
- [x] 7.7 3계층 공개 테스트: 상위/중간/하위 점수 fact의 주입 포맷 검증, 비활성화 시 전체 주입 확인
