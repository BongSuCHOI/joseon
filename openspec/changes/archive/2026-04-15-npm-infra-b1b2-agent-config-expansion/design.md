## Context

현재 `src/config/schema.ts`의 `AgentOverrideConfig`는 model(단일 문자열), temperature, hidden 3개 필드만 지원한다. omOs(oh-my-opencode-slim)는 variant, skills, mcps, options, model 배열(체인), 커스텀 프롬프트 오버라이드 등 9개 에이전트별 설정을 제공한다.

OpenCode SDK 1.4.3의 `AgentConfig`는 `variant`, `permission`, `options`, `[key: string]: unknown` 인덱스 시그니처를 지원한다. `mcps` 필드는 공식 타입에 없으나 인덱스 시그니처로 설정 가능하며, omOs는 이를 읽어 `permission.{mcpName}_*`을 자동 생성하는 방식으로 처리한다.

**현재 파일 구조:**
- `src/config/schema.ts` — AgentOverrideConfig (3필드), HarnessSettings, HarnessConfig
- `src/agents/agents.ts` — AgentDefinition, applyOverrides (3필드만 처리), 9개 create*Def()
- `src/index.ts` — config 콜백 (에이전트 병합만, 권한 처리 없음)
- `src/shared/utils.ts` — 공통 유틸리티 (parseList 없음)

**제약:**
- 런타임 의존성 0 유지 (Zod 불가, 수동 검증)
- 단일 모델 환경에서도 동작해야 함 (FallbackChain은 다중 모델 환경에서만 활성화)
- 기존 harness.jsonc 설정과 하위 호환

## Goals / Non-Goals

**Goals:**
- AgentOverrideConfig를 omOs 수준으로 확장 (variant, skills, mcps, options, prompt, append_prompt, model 배열)
- `*`/`!name` 글로브 문법으로 skills, mcps 배열 파싱
- 에이전트별 MCP 접근 제어 → permission 자동 생성
- 에이전트별 Skills 접근 제어 → skill permission 자동 생성
- FallbackChain 인터페이스 정의 (model 배열 + fallback.chains 병합)
- 커스텀 프롬프트 오버라이드 (전체 교체 + append)
- 기존 247개 테스트 회귀 없음

**Non-Goals:**
- `ForegroundFallbackManager` 전체 구현 (rate limit 감지 + 자동 모델 전환). 다중 모델 환경 구축 후 구현
- MCP 서버 자체 등록 (omOs처럼 websearch, context7 제공 안 함). 사용자가 opencode.json에 이미 설정한 MCP를 제어만 함
- Preset 시스템 (omOs의 presets 기능)
- `tools` 필드 (SDK에서 deprecated, `permission` 사용)

## Decisions

### D1: AgentOverrideConfig 확장 필드 구성

**결정:** omOs의 `AgentOverrideConfigSchema`를 기반으로 필요 필드만 채택.

```typescript
export interface ModelEntry {
    id: string;
    variant?: string;
}

export interface AgentOverrideConfig {
    model?: string | Array<string | ModelEntry>;
    temperature?: number;
    hidden?: boolean;
    variant?: string;
    skills?: string[];
    mcps?: string[];
    options?: Record<string, unknown>;
    prompt?: string;
    append_prompt?: string;
}

export interface FallbackConfig {
    enabled?: boolean;
    chains?: Record<string, string[]>;
}
```

**근거:**
- `model` 배열: FallbackChain의 기반이 됨. 단일 문자열은 기존과 동일하게 동작
- `variant`: SDK가 공식 지원 ("high"/"medium"/"low")
- `skills`/`mcps`: parseList()로 처리 → permission 자동 생성
- `options`: SDK에 직접 전달 (key-value)
- `prompt`/`append_prompt`: 파일 경로 or 인라인 텍스트
- `FallbackConfig`: 최상위 `fallback` 키에 배치

**대안 검토:**
- Zod 스키마 → 의존성 추가되므로 기각 (D1 = 수동 검증)
- `tools` 필드 → SDK deprecated, `permission`이 대체

### D2: parseList() 유틸리티 배치

**결정:** `src/shared/utils.ts`에 `parseList()` 함수 추가.

```typescript
export function parseList(items: string[], allAvailable: string[]): string[] {
    if (!items || items.length === 0) return [];
    const allow = items.filter(i => !i.startsWith('!'));
    const deny = items.filter(i => i.startsWith('!')).map(i => i.slice(1));
    if (deny.includes('*')) return [];
    if (allow.includes('*')) return allAvailable.filter(item => !deny.includes(item));
    return allow.filter(item => !deny.includes(item) && allAvailable.includes(item));
}
```

**근거:** omOs와 동일한 로직. `*` = 전부 허용, `!name` = 제외, 나열 = 명시적 허용.

### D3: MCP permission 자동 생성 방식

**결정:** config 콜백에서 에이전트의 mcps 배열을 읽어 `permission.{mcpName}_*`을 `allow`/`deny`로 설정.

```
mcps: ["websearch", "context7"]
→ permission.websearch_* = "allow"
→ permission.context7_* = "allow"
→ permission.{다른MCP}_* = "deny"
```

**근거:** omOs와 동일한 패턴. OpenCode가 MCP 툴을 `{mcpName}_{toolName}` 형태로 노출하므로, `{mcpName}_*` 와일드카드로 전체 툴을 제어.

### D4: 커스텀 프롬프트 로드 방식

**결정:** `prompt`와 `append_prompt`는 파일 경로(문자열)로 지정. `applyOverrides`에서 `readFileSync`로 로드.

**근거:** omOs는 설정 디렉토리에서 자동 탐색하지만, 우리는 명시적 경로 지정 방식이 더 명확. 파일이 존재하지 않으면 경고 로그 후 기본 프롬프트 유지.

### D5: FallbackChain 구성 로직

**결정:** omOs의 A+B 결합 방식 채택.

```
1. agents.{name}.model이 배열 → _modelArray → 이게 체인
2. agents.{name}.model이 단일 → fallback.chains.{name}에서 체인 찾음
3. 둘 다 없으면 → fallback 없음 (현재와 동일)
```

**근거:** 단일 모델 환경에서는 영향 없음. 설정만 추가하면 다중 모델 환경에서 즉시 작동.

## Risks / Trade-offs

- **[SDK mcps 필드 비공식]** → 인덱스 시그니처로 동작은 하지만 SDK 업데이트 시 변경 가능성. 완화: permission 자동 생성이 핵심이고, mcps 필드 자체는 보조적
- **[prompt 파일 경로 검증]** → 존재하지 않는 경로 지정 시 조용히 무시. 완화: logger.warn으로 경고
- **[기존 설정 호환성]** → 새 필드 추가는 optional이므로 기존 harness.jsonc 그대로 동작. 완화: 스키마 확장만, 기존 필드 변경 없음
- **[단일 모델 환경에서 FallbackChain 무용]** → 설정 없으면 아무 동작 안 함. 완화: 코드가 실행되지 않으므로 오버헤드 제로
