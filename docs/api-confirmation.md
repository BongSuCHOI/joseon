# OpenCode Plugin API 확인 문서

> **목적:** v3-final 가이드에 `⚠️ API 확인 필요`로 표시된 모든 필드의 실제 구조를 정리.
> **출처:** OpenCode 공식 소스코드 직접 확인 (`packages/plugin/src/index.ts`, `packages/sdk/js/src/gen/types.gen.ts`, `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/session/compaction.ts`)
> **확인일:** 2026-04-11 (PluginModule 구조는 2026-04-14 업데이트)
> **상태:** 전체 CONFIRMED (디버그 플러그인 불필요)

---

## 0. PluginModule vs Hooks 구조 (핵심)

OpenCode SDK의 타입 구조상, `PluginModule`은 `{ id, server, tui }`만 인식한다.
`config`, `event`, `tool`, `tool.execute.before` 등 **모든 훅은 `server()`가 반환하는 Hooks 객체의 프로퍼티**여야 한다.

```typescript
// SDK 타입 정의 (packages/plugin/src/index.ts)
export type PluginModule = {
    id?: string;
    server: Plugin;   // Plugin = (input) => Promise<Hooks>
    tui?: never;
    // ← config, event, tool 등은 여기에 올 수 없음!
};

export type Hooks = {
    event?: ...;
    config?: (input: Config) => Promise<void>;  // ← 여기!
    tool?: { [key: string]: ToolDefinition };
    "tool.execute.before"?: ...;
    "tool.execute.after"?: ...;
    // ... 모든 훅은 Hooks 안에
};
```

**실제 버그 사례:** `config`를 `PluginModule` 최상위에 두면 OpenCode가 아예 호출하지 않음.
에이전트 등록, default_agent 설정이 전혀 실행되지 않는 치명적 버그 발생.

---

## 1. `tool.execute.before`

### 시그니처

```typescript
"tool.execute.before"?: (
  input: {
    tool: string       // 툴 이름 ("bash", "read", "edit", "write", "glob" 등)
    sessionID: string  // 현재 세션 ID
    callID: string     // 이 툴 호출의 고유 ID
  },
  output: {
    args: any          // 툴별 파라미터 (수정 가능 — 실제 실행에 반영됨)
  }
) => Promise<void>
```

### 소스코드 위치

`packages/opencode/src/session/prompt.ts` line 448-455:
```typescript
yield* plugin.trigger(
  "tool.execute.before",
  { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
  { args },
)
```

### `output.args` — 툴별 필드 구조

| 툴 이름 | `output.args` 필드 | 타입 |
|---------|-------------------|------|
| `read` | `filePath`, `offset?`, `limit?` | `string`, `number?`, `number?` |
| `edit` | `filePath`, `oldString`, `newString`, `replaceAll?` | `string`, `string`, `string`, `boolean?` |
| `write` | `filePath`, `content` | `string`, `string` |
| `bash` | `command`, `timeout?`, `workdir?` | `string`, `number?`, `string?` |
| `glob` | `pattern`, `path?` | `string`, `string?` |
| `grep` | `pattern`, `path?`, `include?` | `string`, `string?`, `string?` |
| `multiedit` | `filePath`, `edits[]` | `string`, `{filePath, oldString, newString, replaceAll?}[]` |
| `task` | `description`, `prompt`, `subagent_type`, `task_id?` | `string`, `string`, `string`, `string?` |
| `todo` | `todos[]` | `Todo.Info[]` |

### 주의사항

- `output.args` 수정 시 원본 타입을 유지해야 함. Zod validation이 툴 실행 전에 다시 실행됨
- `throw new Error(...)`로 툴 실행을 완전히 차단 가능

---

## 2. `tool.execute.after`

### 시그니처

```typescript
"tool.execute.after"?: (
  input: {
    tool: string       // 툴 이름
    sessionID: string  // 세션 ID
    callID: string     // 호출 ID
    args: any          // 툴에 전달된 원본 인자 (before와 동일)
  },
  output: {
    title: string      // 툴 실행 결과의 제목
    output: string     // 툴 실행 결과의 텍스트 출력
    metadata: any      // 툴 실행 메타데이터 (구조는 툴마다 다름)
  }
) => Promise<void>
```

### 소스코드 위치

`packages/opencode/src/session/prompt.ts` line 460-463:
```typescript
yield* plugin.trigger(
  "tool.execute.after",
  { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args },
  output,   // { title, output, metadata }
)
```

### `output.metadata` — 툴별 구조

| 툴 | metadata 필드 |
|-----|-------------|
| `write` | `{ diagnostics, filepath, exists }` |
| `read` | `{ preview: string[], truncated: boolean, loaded: string[] }` |
| `grep` | `{ matches: number, truncated: boolean }` |
| `todo` | `{ todos: Todo.Info[] }` |
| `webfetch` | `{}` (빈 객체) |
| `websearch` / `codesearch` | `{}` (빈 객체) |
| 커스텀 툴 | `{ truncated: boolean, outputPath?: string }` |

### 중요: `metadata.error`는 존재하지 않음

- 툴이 에러를 throw하면 `tool.execute.after` 훅이 **호출되지 않을 가능성이 높음**
- 에러는 상위 try/catch에서 처리 → `session.error` 이벤트 발생
- **`metadata.error`로 에러를 감지하는 코드는 작동하지 않음.** `session.error` 이벤트로 대체 필요

---

## 3. `event` 핸들러

### 시그니처

```typescript
event?: (input: { event: Event }) => Promise<void>
```

### 프로젝트에서 사용하는 이벤트별 구조

| 이벤트 | `properties` 필드 | 상태 |
|--------|------------------|------|
| `session.idle` | `{ sessionID: string }` | ✅ CONFIRMED |
| `session.created` | `{ sessionID: string; info: Session }` | ✅ CONFIRMED |
| `session.error` | `{ sessionID?: string; error?: ProviderAuthError \| UnknownError \| ... }` | ✅ CONFIRMED |
| `file.edited` | `{ file: string }` | ✅ CONFIRMED |
| `message.updated` | `{ info: Message }` | ✅ CONFIRMED |
| `message.part.updated` | `{ part: Part; delta?: string }` | ✅ CONFIRMED |

### Message 타입 상세 (텍스트 없음 — 메타데이터만)

`Message`는 `UserMessage | AssistantMessage` 유니온이며, **텍스트 내용은 포함하지 않음.**

```typescript
type UserMessage = {
  id: string; sessionID: string; role: "user";
  time: { created: number };
  summary?: { title?: string; body?: string; diffs: Array<FileDiff> };
  agent: string; model: { providerID: string; modelID: string };
  system?: string; tools?: { [key: string]: boolean };
};

type AssistantMessage = {
  id: string; sessionID: string; role: "assistant";
  time: { created: number; completed?: number };
  error?: ProviderAuthError | UnknownError | ...;
  parentID: string; modelID: string; providerID: string;
  mode: string; path: { cwd: string; root: string };
  cost: number; tokens: { input: number; output: number; ... };
  finish?: string;
};

type Message = UserMessage | AssistantMessage;
```

### 실제 텍스트 획득 방법: `message.part.updated`

텍스트는 `message.part.updated` 이벤트에서 `part.type === "text"`인 Part로 전달됨.

```typescript
// TextPart 구조
type TextPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";
  text: string;           // ← 실제 텍스트 내용
  synthetic?: boolean;
  ignored?: boolean;
  time?: { start: number; end?: number };
  metadata?: { [key: string]: unknown };
};
```

**불만 키워드 감지 구현 예시:**
```typescript
if (event.type === 'message.part.updated') {
    const { part } = event.properties;
    if (part.type === 'text') {
        const content = (part as { type: 'text'; text: string }).text;
        const frustrationKeywords = ['왜이래', '안돼', '또', '이상해', '뭐야', '아까', '다시'];
        const found = frustrationKeywords.filter((kw) => content.includes(kw));
        if (found.length > 0) {
            emitSignal({ type: 'user_feedback', ... });
        }
    }
}
```

| 목적 | 이벤트 | 접근 경로 |
|------|--------|----------|
| user/assistant 구분 | `message.updated` | `event.properties.info.role` |
| 모델 정보 | `message.updated` | `event.properties.info.modelID` |
| 토큰/비용 | `message.updated` | `event.properties.info.tokens` (assistant only) |
| **실제 텍스트** | `message.part.updated` | `event.properties.part.text` (when `part.type === "text"`) |
| 스트리밍 델타 | `message.part.updated` | `event.properties.delta` |

### 전체 이벤트 타입 목록

<details>
<summary>펼쳐보기</summary>

```
installation.updated, installation.update-available
server.instance.disposed, server.connected
lsp.client.diagnostics, lsp.updated
message.updated, message.removed, message.part.updated, message.part.removed, message.part.delta
permission.asked, permission.replied
session.created, session.updated, session.deleted, session.diff, session.error, session.status, session.idle, session.compacted
file.edited, file.watcher.updated
todo.updated
command.executed
tui.prompt.append
vcs.branch.updated
```

</details>

---

## 4. `experimental.session.compacting`

### 시그니처

```typescript
"experimental.session.compacting"?: (
  input: {
    sessionID: string
  },
  output: {
    context: string[]     // 문자열 배열. .push()로 추가
    prompt?: string       // 설정하면 기본 프롬프트를 완전히 대체
  }
) => Promise<void>
```

### 소스코드 위치

`packages/opencode/src/session/compaction.ts` line 180-183:
```typescript
const compacting = yield* plugin.trigger(
  "experimental.session.compacting",
  { sessionID: input.sessionID },
  { context: [], prompt: undefined },
)
```

### 확인 사항

- `output.context`는 `string[]` 타입. `.push()`로 문자열 추가 가능
- 기본값은 빈 배열 `[]`
- `output.prompt`를 설정하면 기본 프롬프트를 완전히 대체 (이때 context는 무시됨)

---

## 5. v3-final API 항목별 판정 결과

> **참고:** 아래는 원본 v3-final의 `⚠️ API 확인 필요` 항목 전체에 대한 판정 결과다.
> v3-final 문서는 형님이 직접 수정하여 모든 이슈가 해결된 상태다.
> 각 항목의 **수정후 v3 코드**는 현재 v3-final 문서에 반영되어 있다.

### 5.1 observer.ts (`src/harness/observer.ts`)

#### `tool.execute.after` 훅

| 항목 | 원본 코드 | API 판정 | 수정후 v3 코드 | 상태 |
|------|----------|----------|---------------|------|
| args 접근 | `output.args` | 🔴 `tool.execute.after`에서 args는 `input.args`에 있음 | `input.args` | ✅ 해결 |
| title | `output.title` | ✅ CONFIRMED | `output.title` | ✅ |
| output 텍스트 | `output.output` | ✅ CONFIRMED | `typeof output.output === 'string' ? output.output.slice(0, 500) : undefined` | ✅ |
| metadata | `output.metadata` | ✅ CONFIRMED (툴별로 구조 다름) | 로깅에서 제거됨 (순수 로깅만 담당으로 변경) | ✅ |
| 에러 감지 | `output.metadata?.error` | 🔴 `metadata.error` 존재하지 않음. 에러 시 after 훅 자체가 호출 안 될 수 있음 | `session.error` 이벤트로 이관 | ✅ 해결 |

**구조 개선:** observer의 `tool.execute.after`는 **순수 로깅만** 담당하도록 단순화. 에러 감지는 전부 `session.error` 이벤트에서 처리.

#### `event` 핸들러

| 이벤트 | 원본 접근 경로 | API 판정 | 수정후 v3 코드 | 상태 |
|--------|-------------|----------|---------------|------|
| `session.idle` | `event.properties?.sessionID` | ✅ CONFIRMED — `{ sessionID: string }` | `event.properties?.sessionID` | ✅ |
| `session.error` | (원본에 없었음) | ✅ CONFIRMED — `{ sessionID?: string; error?: ... }` | 신규 추가. `event.properties?.error?.message \|\| String(error) \|\| 'unknown'` | ✅ 해결 |
| `file.edited` | `event.properties?.filePath` | 🟡 `properties.file`이 정확함 (`filePath` 아님) | `event.properties?.file` | ✅ 해결 |
| `message.updated` | `event.properties?.content` | 🔴 `Message`에 텍스트 없음. 메타데이터만 있음 | `message.part.updated` 이벤트로 변경 | ✅ 해결 |
| `message.part.updated` | (원본에 없었음) | ✅ CONFIRMED — `part.type === 'text'`에서 `part.text`로 텍스트 접근 | 신규 추가. `(part as { type: 'text'; text: string }).text` | ✅ 해결 |

**핵심 변경:** 불만 키워드 감지를 `message.updated` → `message.part.updated`로 이관. `Message`는 메타데이터만 있고 실제 텍스트는 `Part`에 있음.

### 5.2 enforcer.ts (`src/enforcer.ts`)

#### `tool.execute.before` 훅

| 항목 | 원본/수정 코드 | API 판정 | 상태 |
|------|--------------|----------|------|
| `output.args` (before 훅) | `output.args` | ✅ CONFIRMED — before에서 `output.args`가 올바른 위치 | ✅ |
| 파일 경로 접근 | `output.args?.filePath \|\| output.args?.file` | ✅ CONFIRMED — write는 `filePath`, 일부 툴은 `file`. 둘 다 체크하는 방식은 양호 | ✅ |
| 콘텐츠 접근 | `output.args?.content \|\| output.args?.newString` | ✅ CONFIRMED — write는 `.content`, edit은 `.newString` | ✅ 해결 (원본 `.newText`에서 수정) |
| bash 명령어 | `output.args?.command` | ✅ CONFIRMED | ✅ |
| throw Error로 차단 | `throw new Error(...)` | ✅ CONFIRMED — before 훅에서 에러 throw 시 도구 실행 차단 | ✅ |

#### `event` 핸들러

| 항목 | 코드 | API 판정 | 상태 |
|------|-----|----------|------|
| `session.created`에서 규칙 리로드 | `event.type === 'session.created'` | ✅ CONFIRMED — `{ sessionID: string; info: Session }` | ✅ |

### 5.3 improver.ts (`src/improver.ts`)

#### `event` 핸들러 (session.idle)

| 항목 | 코드 | API 판정 | 상태 |
|------|-----|----------|------|
| `session.idle`에서 signal 처리 | `event.type !== 'session.idle'` 가드 | ✅ CONFIRMED — `{ sessionID: string }` | ✅ |

#### `experimental.session.compacting` 훅

| 항목 | 코드 | API 판정 | 상태 |
|------|-----|----------|------|
| `(input, output)` 시그니처 | `async (input, output)` | ✅ CONFIRMED — `input: { sessionID: string }`, `output: { context: string[]; prompt?: string }` | ✅ |
| `output.context.push(...)` | `output.context.push(...)` | ✅ CONFIRMED — `string[]` 타입, `.push()` 가능 | ✅ |

### 5.4 해결된 BREAKING 변경 요약

| # | 문제 | 원인 | 해결 방법 | 해결 상태 |
|---|------|------|----------|----------|
| 1 | observer `output.args` 접근 | `tool.execute.after`에서 args는 input에 있음 | `input.args`로 변경 | ✅ v3 반영 완료 |
| 2 | observer `metadata.error`로 에러 감지 | `metadata.error` 필드 미존재. 에러 시 after 훅 호출 불가 | `session.error` 이벤트로 에러 감지 이관 | ✅ v3 반영 완료 |
| 3 | observer `message.updated`에서 텍스트 접근 | `Message`에 텍스트 없음. 메타데이터만 존재 | `message.part.updated` 이벤트 + `part.text`로 변경 | ✅ v3 반영 완료 |
| 4 | observer `file.edited`에서 `filePath` | `properties.file`이 정확한 필드명 | `.filePath` → `.file` | ✅ v3 반영 완료 |
| 5 | enforcer `newText` | edit 툴의 실제 필드는 `newString` | `.newText` → `.newString` | ✅ v3 반영 완료 |

---

## 6. 추가로 발견한 유용한 훅들

향후 확장을 위해 참고:

```typescript
// 채팅 파라미터 수정 (temperature, topP 등)
"chat.params"?: (
  input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
  output: { temperature: number; topP: number; topK: number; maxOutputTokens: number | undefined; options: Record<string, any> }
) => Promise<void>

// 시스템 프롬프트 변환
"experimental.chat.system.transform"?: (
  input: { sessionID?: string; model: Model },
  output: { system: string[] }
) => Promise<void>

// 메시지 수신 시
"chat.message"?: (
  input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string }; messageID?: string; variant?: string },
  output: { message: UserMessage; parts: Part[] }
) => Promise<void>

// 셸 환경변수 주입
"shell.env"?: (
  input: { cwd: string; sessionID?: string; callID?: string },
  output: { env: Record<string, string> }
) => Promise<void>

// 툴 정의 수정
"tool.definition"?: (
  input: { toolID: string },
  output: { description: string; parameters: any }
) => Promise<void>
```

---

## 7. 소스코드 출처

| 정보 | 파일 | 라인 |
|------|------|------|
| 핵심 훅 타입 | `packages/plugin/src/index.ts` | line 221-268 |
| 툴 정의 | `packages/opencode/src/tool/tool.ts` | line 31-41 |
| Event 타입 | `packages/sdk/js/src/gen/types.gen.ts` | line 699-730 |
| 훅 실행 로직 | `packages/opencode/src/session/prompt.ts` | line 445-465 |
| Compaction 훅 | `packages/opencode/src/session/compaction.ts` | line 180-183 |
