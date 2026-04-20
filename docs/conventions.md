# Code Conventions

## File Structure

```
src/
├── index.ts                     # 플러그인 진입점 (모듈 병합 + config 로드 + hooks 통합)
│
├── harness/                     # 하네스 레이어 (Step 1~2, 5f)
│   ├── observer.ts              # L1 관측 + L2 신호 변환
│   ├── enforcer.ts              # L4 HARD 차단 + SOFT 위반 추적
│   ├── improver.ts              # L5 자가개선 + L6 폐루프 + Memory consolidate/relate
│   └── canary.ts                # metadata-based canary evaluation
│
├── orchestrator/                # 오케스트레이션 레이어 (Step 4)
│   ├── orchestrator.ts          # session.idle 기반 이벤트 처리
│   ├── error-recovery.ts        # 에러 복구 5단계 에스컬레이션
│   ├── qa-tracker.ts            # QA 시나리오별 실패 추적
│   └── subagent-depth.ts        # 서브에이전트 깊이 추적 + 초과 차단
│
├── agents/                      # 에이전트 정의
│   ├── agents.ts                # 에이전트 정의 + config 오버라이드 적용
│   └── prompts/                 # 10개 에이전트 프롬프트 (orchestrator, frontend, backend, tester, reviewer, designer, explorer, librarian, coder, advisor)
│
├── hooks/                       # 훅 모듈 (7개)
│   ├── index.ts                 # createAllHooks() + 다중 핸들러 병합
│   ├── delegate-task-retry.ts   # 서브에이전트 위임 실패 감지 + 재시도
│   ├── json-error-recovery.ts   # JSON 파싱 에러 감지 + 수정
│   ├── post-file-tool-nudge.ts  # 파일 조작 후 위임 넛지
│   ├── post-read-nudge.ts       # 파일 읽기 후 위임 넛지
│   ├── foreground-fallback.ts   # same-session reactive fallback
│   ├── filter-available-skills.ts # 에이전트별 스킬 필터
│   └── auto-update-checker.ts   # npm 버전 확인 (default-off)
│
├── shared/                      # 공통 유틸리티
│   ├── index.ts                 # 배럴 export
│   ├── utils.ts                 # getProjectKey, ensureHarnessDirs, generateId, parseList, mergeEventHandlers, rotateHistoryIfNeeded, isPluginSource, readJsonFile, readJsonlFile, safeErrorMessage
│   ├── logger.ts                # 4레벨 로깅 (debug/info/warn/error + HARNESS_LOG_LEVEL)
│   └── constants.ts             # HARNESS_DIR, HOME, THIRTY_DAYS_MS, MAX_ERROR_SUMMARY_LENGTH
│
├── config/                      # 설정 시스템
│   ├── index.ts                 # 배럴 export
│   ├── schema.ts                # HarnessConfig, AgentOverrideConfig, HarnessSettings
│   └── loader.ts                # JSONC/JSON 로더 + 글로벌/프로젝트 병합
│
└── types.ts                     # 전체 타입 정의 (Signal, Rule, ProjectState 등)
```

## Coding Rules

1. **스키마는 types.ts에만 정의.** 플러그인별 축소 버전 재정의 금지. import해서 사용.
2. **공통 함수는 utils.ts에서만 정의.** 복붙하면 서로 다른 project_key가 생성되어 치명적 버그 발생.
3. **각 플러그인은 초기화 시 `ensureHarnessDirs()` 호출.** observer만 호출하는 것이 아니라 모든 플러그인이 idempotently 자기 디렉토리를 보장.
4. **`import { randomUUID } from 'crypto'` 사용.** 전역 `crypto.randomUUID()` 대신 명시적 import.
5. **모든 `new RegExp()` 호출은 `safeRegexTest()`로 감싸기.** 잘못된 패턴이 들어오면 플러그인 전체가 멈춤.
6. **플러그인 export는 `export default { id, server() }` 패턴 사용.** (아래 참조)

## Plugin Export Pattern (v1 — 필수)

OpenCode는 `export default { id, server() }` 패턴(v1)을 사용한다.

**⚠️ 핵심:** SDK의 `PluginModule`은 `{ id, server, tui }`만 인식한다. `config`, `event`, `tool` 등 **모든 훅은 `server()`가 반환하는 Hooks 객체 안에** 있어야 한다. `PluginModule` 최상위에 두면 OpenCode가 호출하지 않는다.

```typescript
// ✅ 올바른 패턴 (v1)
export default {
  id: "my-harness",
  server: async (input) => {
    // ... hooks 생성 ...
    const result = { ...merged };
    // config는 server() 반환값 안에 넣는다
    result.config = async (opencodeConfig) => {
      // 에이전트 등록
    };
    return result;
  },
};

// ❌ config를 PluginModule 최상위에 두면 OpenCode가 무시함
export default {
  id: "my-harness",
  server: async (input) => { return { event: ... }; },
  config: (cfg) => { ... },  // ← 절대 여기에!
};
```

**핵심:** 로컬(file) 플러그인은 `id` 필드가 필수. npm 패키지는 `package.json`의 `name`을 사용.

## Import Conventions

- `shared/`에서만 공통 유틸리티 import. `import { ... } from './shared/index.js'`
- barrel export(`shared/index.ts`)를 통해 import
- 절대 다른 플러그인의 내부 유틸리티를 직접 import하지 않음
