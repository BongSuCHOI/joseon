# Development Guide

> OpenCode 플러그인 개발, 로컬 로드, 테스트, 배포 절차.

---

## 1. Plugin Load Methods

### Development: Local Plugin

`.opencode/plugins/` 디렉토리에 빌드된 ESM 산출물을 배치. 소스 수정은 `src/`에서.

**핵심 규칙:**
- `package.json`에 `"type": "module"` 필수
- `src/index.ts`는 `export default { id, server() }` 패턴 사용
- OpenCode 재시작 시 자동 로드됨

**설정 파일:**
- 프로젝트: `.opencode/harness.jsonc` — 에이전트 model/temperature/hidden + 하네스 임계값 오버라이드
- 글로벌: `~/.config/opencode/harness.jsonc` — 모든 프로젝트에 적용 (프로젝트 설정이 우선)

### Production: npm Package

```json
{ "plugin": ["my-harness"] }
```

OpenCode가 자동 `bun install` 후 캐싱.

---

## 2. Development Workflow

```bash
# src/ 수정 후 빌드 + 로컬 플러그인 동기화
npm run deploy

# 또는 수동
npm run build
rsync -av --delete dist/ .opencode/plugins/harness/

# OpenCode 재시작
```

---

## 3. Build

```bash
npm run build    # tsc → dist/
npm publish      # npm 레지스트리에 배포
```

---

## 4. Testing

### Test Execution

Smoke 테스트는 개별 실행:

```bash
# harness smoke
./node_modules/.bin/tsx src/__tests__/smoke-session-lock.ts
./node_modules/.bin/tsx src/__tests__/smoke-step5a-foundation.ts
./node_modules/.bin/tsx src/__tests__/smoke-step5b-memory-relevance.ts
./node_modules/.bin/tsx src/__tests__/smoke-step5c-rule-lifecycle.ts
./node_modules/.bin/tsx src/__tests__/smoke-step5d-release-ops.ts
./node_modules/.bin/tsx src/__tests__/smoke-step5e-candidates.ts
./node_modules/.bin/tsx src/__tests__/smoke-step5f-canary.ts
./node_modules/.bin/tsx src/__tests__/smoke-step5g-compacting-canary.ts
./node_modules/.bin/tsx src/__tests__/smoke-step5h-ack-acceptance.ts

# unit tests
./node_modules/.bin/tsx src/__tests__/unit-step5c-rule-lifecycle.ts
./node_modules/.bin/tsx src/__tests__/unit-step5d-release-ops.ts

# integration smoke
./node_modules/.bin/tsx test/smoke-test.ts
./node_modules/.bin/tsx test/smoke-test-step3.ts
./node_modules/.bin/tsx test/smoke-test-step4.ts
```

### Test Files (14개, 564 assertions)

| 파일 | Assertions |
|------|-----------|
| smoke-session-lock.ts | 9 |
| smoke-step5a-foundation.ts | 18 |
| smoke-step5b-memory-relevance.ts | 22 |
| smoke-step5c-rule-lifecycle.ts | 26 |
| smoke-step5d-release-ops.ts | 6 |
| smoke-step5e-candidates.ts | 13 |
| smoke-step5f-canary.ts | 42 |
| smoke-step5g-compacting-canary.ts | 74 |
| smoke-step5h-ack-acceptance.ts | 41 |
| unit-step5c-rule-lifecycle.ts | 14 |
| unit-step5d-release-ops.ts | 14 |
| test/smoke-test.ts | 46 |
| test/smoke-test-step3.ts | 50 |
| test/smoke-test-step4.ts | 189 |

### Test History

| 일시 | 내용 | 결과 |
|------|------|------|
| Step 1 | harness 초안 | 29/29 |
| Step 2 | improver 추가 | 통과 |
| Step 3 | 브릿지 | 통과 |
| Step 4 | 오케스트레이션 | 통과 |
| Step 5a~5h | shadow/guarded 기능 | 통과 |
| Simplify + consolidate/relate | readability + Phase 제거 + error-recovery 제거 + 메모리 병합/관계 | 564/564 |

---

## 5. OpenSpec Workflow

이 프로젝트는 OpenSpec을 사용하여 Spec-Driven Development 방식으로 개발한다.

### Commands

| 명령 | 용도 |
|------|------|
| `/opsx-explore` | 탐색 모드. 아이디어 구상, 문제 조사. 코드 작성 금지 |
| `/opsx-propose` | 새 Change 생성 + 모든 아티팩트 한 번에 생성 |
| `/opsx-apply` | tasks.md의 체크리스트를 순서대로 구현 |
| `/opsx-archive` | 완료된 Change를 아카이브. Delta Spec을 메인 Spec에 병합 |

### Basic Flow

```
/opsx-explore (탐색) → /opsx-propose (계획) → /opsx-apply (구현) → /opsx-archive (완료)
```

### Implementation Rules

- **구현 전:** 각 단계 작업 시작 전, v3-final.md 내 작업 범위를 반드시 완독
- **구현 후:** MOCK/SMOKE 테스트 + 가벼운 실제 요청/응답으로 빌드 신뢰도와 실동작 검증

### OpenSpec Directory

```
openspec/
├── config.yaml          # 프로젝트 설정
├── specs/               # Source of Truth (현재 시스템 동작)
└── changes/             # 활성/완료된 변경사항
    ├── {change-name}/   # 활성 Change
    └── archive/         # 완료된 Changes
```

### Session Resume

세션이 꺼지거나 바뀌어도:
- `openspec/changes/{name}/tasks.md`의 체크박스로 진행률 파악
- `/opsx-apply` 실행 시 체크 안 된 항목부터 자동 재개

---

## 6. Debugging

```bash
# 로그 레벨 설정
export HARNESS_LOG_LEVEL=debug  # debug | info | warn | error

# 로그 확인
cat ~/.config/opencode/harness/harness.jsonl

# 프로젝트 상태 확인
cat ~/.config/opencode/harness/projects/{key}/state.json
```

---

## 7. Runtime Data

런타임 데이터는 `~/.config/opencode/harness/`에 자동 생성.
`.gitignore`에 포함. 환경 간 동기화가 필요하면 선택적으로 git repo로 관리.

## 8. API Reference

OpenCode Plugin API 필드 상세: [`docs/api-confirmation.md`](api-confirmation.md)
