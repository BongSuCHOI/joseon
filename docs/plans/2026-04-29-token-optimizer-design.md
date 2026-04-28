# Token Optimizer Design v2 — 하네스 토큰 최적화 모듈 최종 설계안

> **날짜:** 2026-04-29
> **버전:** v2 (advisor 리뷰 반영)
> **상태:** 설계 확정
> **출처:** codex-surgeon 분석 → 하네스 흡수 → advisor 리뷰 → 수정
> **핵심 원칙:** 사후 잘라내기 절대 금지, 사전 차단 + 설정 제한 + 컴팩션 커스터마이징

---

## 0. 한 줄 정의

하네스 플러그인에 토큰 최적화 모듈을 추가하여, 큰 출력 명령 사전 차단, 반복 탐색 루프 중단, 같은 파일 반복 읽기 차단, 컴팩션 프롬프트 커스터마이징을 수행한다.

---

## 1. 배경

### 1.1 동기

- Token Robin Hood(TRH)가 "컨텍스트 블로팅, 중복 호출, 시끄러운 리서치 루프"를 줄인다고 주장
- TRH는 `~/.claude/sessions` jsonl 분석 + hooks 자동 설치 + 설정 주입 조합일 가능성이 높음
- 하네스에는 이미 observer의 낭비 탐지기(tool_loop, retry_storm, excessive_read)와 컴팩션 시스템이 구현되어 있음
- 별도 도구(codex-surgeon)를 만드는 대신, 기존 하네스에 흡수하는 것이 아키텍처적으로 우수

### 1.2 왜 별도 도구가 아닌가

| 기준 | 별도 도구 (codex-surgeon) | 하네스 흡수 |
|------|--------------------------|-----------|
| 런타임 의존성 | Python + sqlite | 0개 (숔수 TS) |
| 기존 인프라 활용 | 중복 구현 | observer/enforcer/improver 재사용 |
| 설정 위치 | `~/.codex/` 별도 | `.opencode/harness.jsonc` 통합 |
| 관측 파이프라인 | 신규 | 기존 Signal→Rule 파이프라인 확장 |
| 컴팩션 | 별도 파일 | 기존 `experimental.session.compacting` 확장 |

---

## 2. 핵심 설계 원칙

### 원칙 1: 사후 잘라내기 절대 금지, 사전 차단

```
❌ 절대 금지: 큰 출력이 터진 뒤 자름
   cat huge.log → 10000줄 → 200줄로 truncate
   → 에이전트가 9800줄을 못 봄 → 잘못된 판단 → 악순환

✅ 유일한 접근: 큰 출력이 터지기 전에 막음
   cat huge.log → deny + "tail -200 또는 rg를 사용하세요" 제안
   → 에이전트가 좁은 명령으로 재실행 → 200줄 전부 완전히 읽음 → 정확한 판단
```

**이유:** 출력을 중간에 자르면 에이전트가 잃은 정보 위에서 결정을 내려야 한다. 토큰은 줄어도 작업 품질은 깎인다. 이건 v1에서도 마찬가지다. output_limiter, semantic compactor, 어떤 이름으로든 사후 잘라내기는 허용하지 않는다.

### 원칙 2: 행동량 줄이기, 말투 줄이기 말고

"모델 말투 줄이기"는 5~15% 절감에 그친다. "모델 행동량 줄이기"(어떤 도구를 쓸지, 몇 번 탐색할지, 어디까지 읽을지)가 15~70% 절감의 핵심이다.

### 원칙 3: 설정 기반 제한이 훅 기반 잘라내기보다 안전

OpenCode의 자동 pruning/compaction이 이미 있다. 우리는 그 위에서 작동한다. OpenCode가 자체적으로 출력을 제한하도록 두고, 플러그인은 사전 차단에만 관여한다.

### 원칙 4: 기존 파이프라인 위에 얹기

새 감지기는 observer의 Signal 생성으로, 새 차단은 enforcer의 규칙으로, 새 컴팩션 전략은 improver의 compacting 훅으로. 각각의 담당 모듈이 명확하다.

### 원칙 5: v0는 4개 기능, 나머지는 실전 데이터 후 v1

advisor 리뷰 결론: pre_tool_guard + loop_budget + file_deduper + compact_override만으로 기대 효과의 70~80%를 달성한다. 나머지는 실제 사용 데이터를 보고 판단한다.

---

## 3. v0 기능 목록 (4개)

| # | 기능 | 담당 | OpenCode 훅 | 설명 | 예상 효과 |
|---|------|------|-------------|------|----------|
| 1 | **pre_tool_guard** | enforcer 확장 | `tool.execute.before` | 큰 출력 명령 사전 차단 | 20~40% |
| 2 | **loop_budget** | observer 확장 | `tool.execute.before` | 세션 전체 도구 유형별 예산 초과 시 차단 | 20~40% |
| 3 | **file_deduper** | observer 확장 | `tool.execute.before` | 같은 파일 mtime/size 기반 반복 읽기 차단 | 10~20% |
| 4 | **compact_override** | improver 확장 | `experimental.session.compacting` | 컴팩션 프롬프트 커스터마이징 | 30~60% |

**누적 기대 효과:** 4개 조합으로 세션당 토큰 사용량의 40~70% 절감 가능 (가장 큰 낭비 원인인 큰 출력, 반복 탐색, 반복 읽기, 긴 세션 컴팩션 품질을 직접 공략).

---

## 4. v1 이후 검토 기능

| 기능 | 보류 이유 | 재검토 조건 |
|------|----------|------------|
| **session_pressure** (세션 압력 행동량 제한) | 압력 휴리스틱 보정에 실전 데이터 필요. `experimental.chat.system.transform` 훅 존재 및 동작 확인 필요 | v0 메트릭 수집 후 압력 분포 확인 시 |
| **output_meter** (도구 출력 길이 측정 전용) | 사후 잘라내기는 원칙 위반. 측정만 하는 버전은 observer의 `tool.execute.after`에 10줄 추가로 끝나서 v0.5 수준에서 가능 | pre_tool_guard 효과 측정 후 보조 필요 시 |
| **capsule** (세션 상태 캡슐) | compact_override로 비슷한 효과 달성. capsule은 신규 모듈 + JSONL 파싱 + 커스텀 툴 + 디렉토리 관리로 구현 비용이 높음 | compact_override로 충분한지 1개월 사용 후 판단 |
| **profile_router** (cheap/normal/deep 권장) | 자동 모델 전환은 사용자 맥락을 깰 위험 | |
| **fork_guard** (실패 세션 분기) | OpenCode에 codex fork 동등 기능 매핑 불명확 | |
| **semantic compactor** (PostToolUse 요약) | 플러그인에서 LLM 호출 불가 + 사후 잘라내기 원칙 위반 | |

---

## 5. 기능 상세 설계

### 5.1 pre_tool_guard — 큰 출력 명령 사전 차단

**트리거:** `tool.execute.before`
**담당:** enforcer.ts 확장

**차단 방식:** `throw new Error()` — 에이전트에게 에러 메시지가 전달되고, 에이전트가 대안 명령으로 재시도.

**위험 패턴 테이블:**

| 패턴 | 매칭 regex | 대안 제안 | 비고 |
|------|-----------|----------|------|
| `cat <file>` | `\bcat\s+\S+` (플래그 허용) | `tail -200 <file>` 또는 `rg "패턴" <file> -n \| head -200` | `cat -n` 등 플래그 포함 감지 |
| `ls -R` | `\bls\s+.*-R` | `ls` 또는 `find . -maxdepth 2` | |
| `find .` (깊이 제한 없음) | `\bfind\s+\.\s*$` 또는 `find\s+\.\s*[^|]*$` (파이프 없음) | `find . -maxdepth 3 -type f` | |
| `grep -R .` (제외 없음) | `\bgrep\s+-[rR].*\.\s*$` | `rg "패턴" --glob '!node_modules' --glob '!dist'` | |
| `docker logs` (tail 없음) | `\bdocker\s+logs\s+\S+` (단 `--tail` 미포함) | `docker logs --tail 200 <container>` | |
| `git log` (제한 없음) | `\bgit\s+log\s*$` | `git log --oneline -20` | **세션당 1회까진 허용** (아래 참조) |

**중요: `npm test`는 v0 패턴에서 제외**

advisor 리뷰에서 지적: `npm test`를 무조건 차단하면 정상 작업이 막힌다. 프로젝트에 따라 출력이 작을 수도 있고, `--reporter=minimal`이 모든 프레임워크에 적용되지 않는다.

대안: `npm test` 차단은 v1에서 휴리스틱 기반으로 검토. 예: 프로젝트에 테스트 파일 > 50개이고 이전 출력이 임계값 초과한 적이 있을 때만 차단.

**중요: `git log`는 세션당 1회 허용**

에이전트가 세션에서 처음으로 `git log`를 실행하는 건 정상적인 작업 맥탁 파악이다. 두 번째부터 제한 없는 `git log`를 차단한다.

```typescript
// session-scoped Set으로 추적
const gitLogUsed = new Set<string>(); // sessionID

function checkGitLog(sessionID: string, cmd: string): boolean {
  if (GIT_LOG_REGEX.test(cmd)) {
    if (!gitLogUsed.has(sessionID)) {
      gitLogUsed.add(sessionID);
      return false; // 첫 호출은 통과
    }
    return true; // 두 번째부터 차단
  }
  return false;
}
```

**동작:**

```typescript
// tool.execute.before 훅 내 (enforcer.ts)
if (settings.token_optimizer_enabled && settings.pre_tool_guard_enabled) {
  if (tool === 'bash') {
    const cmd = output.args.command as string;
    const danger = matchDangerPattern(cmd, sessionID);
    if (danger) {
      throw new Error(
        `[TOKEN GUARD] "${danger.matched}"은(는) 큰 출력을 만들 가능성이 높습니다.\n` +
        `대안: ${danger.alternative}\n` +
        `(이 차단은 .opencode/harness.jsonc에서 pre_tool_guard_enabled: false로 비활성화할 수 있습니다.)`
      );
    }
  }
}
```

**설정:** 마스터 토글 + 기능 토글만. 임계값은 하드코딩.

```jsonc
{
  "harness": {
    "token_optimizer_enabled": true,
    "pre_tool_guard_enabled": true
  }
}
```

---

### 5.2 loop_budget — 세션 전체 도구 유형별 예산 차단

**트리거:** `tool.execute.before`
**담당:** observer.ts 확장

**v0 설계 결정: 세션 전체 추적**

advisor 리뷰에서 지적: 턴 단위 추적은 턴 경계 감지 메커니즘에 의존하는데, `message.part.updated`는 모든 텍스트 델타에 발생하므로 신뢰할 수 있는 턴 경계 신호가 아니다. 턴 기반은 v1에서 검증 후 도입.

v0에서는 기존 observer의 `toolCallCounts` Map을 확장하여 **도구 유형별 예산**을 추가한다.

**기존 상태와 차이:**

| 항목 | 현재 `tool_loop` | 새 `loop_budget` |
|------|-----------------|------------------|
| 범위 | 세션 전체 (동일 tool + args 지문) | 세션 전체 (**도구 유형별**) |
| 임계값 | 5회 (단일) | 도구 유형별 차등 (하드코딩) |
| 동작 | Signal 생성 (사후) | **즉시 차단** (사전) |
| 추적 | `toolCallCounts` Map | **같은 Map 확장** |

**도구 유형 분류:**

```typescript
type ToolCategory = 'search' | 'read' | 'test' | 'write' | 'other';

function classifyToolCall(tool: string, args: Record<string, unknown>): ToolCategory {
  if (tool === 'read') return 'read';
  if (tool === 'write' || tool === 'edit') return 'write';
  if (tool === 'bash') {
    const cmd = (args.command as string) ?? '';
    if (/\b(npm test|vitest|jest|pytest)\b/.test(cmd)) return 'test';
    if (/\b(grep|rg|find|glob|ag|ack)\b/.test(cmd)) return 'search';
    if (/\b(cat|head|tail|less|more)\b/.test(cmd)) return 'read';
    if (/\b(write|patch|sed|awk)\b/.test(cmd)) return 'write';
  }
  return 'other';
}
```

**도구 유형별 예산 (하드코딩, v1에서 설정화):**

| 도구 유형 | 세션당 한계 | 근거 |
|-----------|----------|------|
| search | 20 | 20회 이상 탐색은 루프일 가능성 높음 |
| read | 30 | 파일 읽기는 다소 관대하게 |
| test | 10 | 테스트 반복은 실패 루프 신호 |
| write | 20 | 쓰기는 탐색보다 제한적 |
| other | 50 | 안전망 |

**동작:**

```typescript
// tool.execute.before 훅 내 (observer.ts 확장)
if (settings.token_optimizer_enabled && settings.loop_budget_enabled) {
  const category = classifyToolCall(tool, output.args);
  const key = `${sessionID}::budget::${category}`;
  const current = toolBudgetCounts.get(key) ?? 0;
  const limit = BUDGET_LIMITS[category];

  if (current >= limit) {
    throw new Error(
      `[LOOP BUDGET] 이 세션에서 ${category} 도구를 ${current}회 호출했습니다 (한계: ${limit}).\n` +
      `지금까지 얻은 정보로 가설을 세우세요.\n` +
      `필요한 경우 사용자에게 선택지를 제시하세요.`
    );
  }

  toolBudgetCounts.set(key, current + 1);
}
```

**Map 정리:** 기존 observer의 `session.created` / `session.deleted` 정리 로직에 `toolBudgetCounts`도 포함.

**설정:**

```jsonc
{
  "harness": {
    "loop_budget_enabled": true
  }
}
```

---

### 5.3 file_deduper — 같은 파일 반복 읽기 차단

**트리거:** `tool.execute.before`
**담당:** observer.ts 확장

**성능 최적화:** 기존 observer의 `fileReadCounts` Map을 재사용한다. mtime/size 검사는 **임계값 도달 시에만** 수행하여, 매 파일 읽기마다 stat 호출하는 오버헤드를 피한다.

**동작:**

```typescript
// tool.execute.before 훅 내 (observer.ts 확장)
if (settings.token_optimizer_enabled && settings.file_deduper_enabled) {
  const filePath = extractFilePath(tool, output.args);
  if (filePath && isReadTool(tool, output.args)) {
    const key = `${sessionID}::${filePath}`;
    const currentCount = fileReadCounts.get(key) ?? 0;
    const threshold = 3; // 하드코딩

    // 임계값 도달 전: 카운트만 증가 (stat 호출 없음)
    if (currentCount < threshold) {
      fileReadCounts.set(key, currentCount + 1);
      return; // 통과
    }

    // 임계값 도달: mtime + size 확인
    try {
      const stat = fs.statSync(filePath);
      const fingerprint = `${stat.mtimeMs}:${stat.size}`;
      const prevFingerprint = fileFingerprints.get(key);

      // 파일이 변경됨 → 카운터 리셋, 통과
      if (prevFingerprint && prevFingerprint !== fingerprint) {
        fileReadCounts.set(key, 1);
        fileFingerprints.set(key, fingerprint);
        return;
      }

      // 파일이 변경되지 않음 → 차단
      fileFingerprints.set(key, fingerprint);
      fileReadCounts.set(key, currentCount + 1);

      throw new Error(
        `[FILE DEDUPER] "${filePath}"를 이미 ${currentCount}회 읽었습니다 (변경 없음).\n` +
        `파일이 수정되지 않았습니다. 기존 정보를 활용하세요.\n` +
        `특정 함수나 줄 범위만 필요하면 offset/limit을 지정하세요.`
      );
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('[FILE DEDUPER]')) throw e;
      // stat 실패 (파일 삭제 등) → 통과
    }
  }
}
```

**핑거프린트 방식:** `mtimeMs:size` 문자열. mtime만으로도 충분하지만, 같은 초에 수정되고 크기도 같은 에지 케이스(예: 같은 길이의 import 교체)를 size로 보완. 1초 해상도 파일시스템에서 같은 초 + 같은 크기 변경은 극히 드물어 문서화만 하고 무시.

**Map 정리:** 기존 observer의 `session.created` / `session.deleted` 정리 로직에 `fileFingerprints`도 포함.

**설정:**

```jsonc
{
  "harness": {
    "file_deduper_enabled": true
  }
}
```

---

### 5.4 compact_override — 컴팩션 프롬프트 커스터마이징

**트리거:** `experimental.session.compacting`
**담당:** improver.ts 확장

**현재 상태:** improver는 이미 compacting 훅에서 context 문자열 배열을 push하고 있다.
**추가:** `output.prompt`를 오버라이드하여 컴팩션 시 보존/폐기 우선순위를 명시.

**이게 capsule을 대신하는 이유:** advisor 리뷰에서 지적한 대로, compact_override로 좋은 컴팩션 프롬프트를 제공하면 컴팩션 결과 자체가 곧 capsule 역할을 한다. 세션 전체를 요약해서 이어가는 게 capsule의 본질인데, 컴팩션 프롬프트가 "무엇을 보존하고 무엇을 버릴지"를 명확히 지시하면 결과물이 capsule과 같아진다.

**오버라이드 프롬프트:**

```markdown
## Compaction Directive

보존 최우선순위 (절대 버리지 마):
1. 사용자의 원래 목표와 현재 작업 상태
2. 현재 수정 중인 파일 경로와 수정 의도
3. 이미 내린 설계 결정과 그 이유
4. 실패한 시도와 실패 이유
5. 통과한 테스트 결과
6. 다음 한 단계 (구체적으로)

폐기 가능 (컨텍스트 압력이 높으면 과감히 버려):
1. 긴 로그 원문 (요약으로 대체)
2. 중복 탐색 과정 (결론만 유지)
3. 이미 확인 완료된 파일 목록
4. 장황한 설명과 전제 조건 나열
5. 실패한 가설의 세부 출력 (실패 이유만 유지)
6. 이미 반영된 규칙의 전문 (존재 여부만 유지)

작업 상태 캡슐:
- goal: 사용자의 원래 목표
- changed_files: 수정한 파일과 수정 내용 요약
- decisions: 내린 결정 목록
- failed_attempts: 실패한 접근과 원인
- verified: 확인 완료된 것들
- next_step: 다음에 해야 할 한 가지
```

**동작:**

```typescript
// experimental.session.compacting 훅 내 (기존 코드 확장)
if (settings.token_optimizer_enabled && settings.compact_override_enabled) {
  output.prompt = COMPACT_OVERRIDE_PROMPT;
}
// 기존 context.push() 로직은 그대로 유지
```

**OpenCode 자체 compaction과의 관계:** OpenCode는 내장 compaction agent로 대화를 요약한다. `output.prompt` 오버라이드는 이 agent에게 줄 프롬프트를 우리가 제어하는 것이다. 충돌이 아니라 협력. `output.context`는 기존처럼 push하고, `output.prompt`만 우리가 커스터마이징.

**설정:**

```jsonc
{
  "harness": {
    "compact_override_enabled": true
  }
}
```

---

## 6. 기능 간 상호작용 매트릭스

advisor 리뷰에서 요청: 여러 기능이 동시에 발동할 때의 동작을 명시.

| 시나리오 | 발동 순서 | 결과 | 비고 |
|----------|----------|------|------|
| pre_tool_guard 차단 + loop_budget 카운트 | pre_tool_guard가 먼저 실행되어 throw → **도구 실행 안 됨** | loop_budget 카운트 증가 **없음** | 차단된 호출은 예산을 소모하지 않음 |
| file_deduper 차단 + loop_budget 카운트 | file_deduper가 throw → **도구 실행 안 됨** | loop_budget 카운트 증가 **없음** | 같은 원칙 |
| loop_budget search 20회 도달 + 같은 턴에서 다른 category는 여유 | search만 차단 | read/write/other는 계속 가능 | 카테고리별 독립 예산 |
| loop_budget 모든 카테고리 소진 | 전체 도구 차단 | 에이전트는 "사용자에게 선택지를 제시" 안내를 받음 | 세션 재시작 또는 /compact 권장 시점 |
| pre_tool_guard가 `cat` 차단 → 에이전트가 `tail`로 재시도 | tail은 위험 패턴이 아님 | **통과** | 에이전트가 스스로 좁은 명령 선택 |
| file_deduper가 파일 A 차단 → 에이전트가 파일 B 읽기 | 파일 B는 카운트 1 | **통과** | 파일별 독립 추적 |
| compact_override + 기존 context.push | prompt 교체 + context 그대로 push | **둘 다 적용** | prompt는 요약 지시, context는 추가 정보 |

**핵심 규칙:** `throw Error()`로 차단된 도구 호출은 loop_budget 카운트에 포함되지 않는다. 실행 자체가 안 됐으므로 예산도 소모하지 않는다.

---

## 7. 설정 스키마

`src/config/schema.ts`의 `HarnessSettings`에 추가:

```typescript
// Token Optimizer 설정 — v0는 토글만, 임계값은 하드코딩
token_optimizer_enabled?: boolean;       // 마스터 토글 (default: false)
pre_tool_guard_enabled?: boolean;        // 큰 출력 명령 사전 차단 (default: true)
loop_budget_enabled?: boolean;           // 도구 유형별 예산 차단 (default: true)
file_deduper_enabled?: boolean;          // 같은 파일 반복 읽기 차단 (default: true)
compact_override_enabled?: boolean;      // 컴팩션 프롬프트 커스텀 (default: true)
```

**v0 원칙:** 마스터 토글 1개 + 기능별 토글 4개 = 총 5개. 임계값은 모두 하드코딩.

v1에서 실전 데이터로 기본값 검증 후, 필요한 임계값만 설정에 노출.

**기본값:**

```typescript
token_optimizer_enabled: false,   // 명시적 활성화 필요
pre_tool_guard_enabled: true,     // 마스터 켜지면 기본 활성
loop_budget_enabled: true,
file_deduper_enabled: true,
compact_override_enabled: true,
```

---

## 8. 파일 구조 변경

```
src/
├── harness/
│   ├── observer.ts           # ← 수정: loop_budget 카테고리 분류 + file_deduper mtime/size 지문 추적
│   ├── enforcer.ts           # ← 수정: pre_tool_guard 위험 명령 패턴 매칭
│   └── improver.ts           # ← 수정: compact_override prompt 오버라이드
├── types.ts                  # ← 수정: ToolCategory, DangerPattern 타입 추가
├── config/
│   └── schema.ts             # ← 수정: token_optimizer 설정 5개 추가
└── shared/
    └── constants.ts          # ← 수정: 위험 명령 패턴 테이블 + 컴팩션 프롬프트 + 예산 한계 상수 추가
```

**새 파일 없음. 수정 파일 6개.**

---

## 9. 의존성

- **런타임 의존성 추가:** 없음. 기존 0개 유지.
- **신규 외부 API 호출:** 없음. 플러그인 훅 콜백만 사용.
- **신규 디렉토리:** 없음.
- **신규 npm 패키지:** 없음.

---

## 10. 기존 기능과의 관계

### 10.1 기존 observer 낭비 탐지기와의 관계

| 기존 | 새 기능 | 관계 |
|------|--------|------|
| `tool_loop` (세션 전체, 동일 tool+args, Signal 생성) | `loop_budget` (세션 전체, 도구 유형별, 즉시 차단) | **보완.** tool_loop는 동일 명령 반복 탐지, loop_budget은 유형별 총량 제한. 둘 다 유지. |
| `excessive_read` (경로만 카운트, Signal 생성) | `file_deduper` (mtime/size 인식, 즉시 차단) | **강화.** excessive_read는 파일 변경 무시, file_deduper는 변경 시 자동 통과. 둘 다 유지. |
| `retry_storm` (에러 사이클, Signal 생성) | (변경 없음) | 유지 |

### 10.2 기존 enforcer 규칙과의 관계

- pre_tool_guard는 enforcer의 `tool.execute.before` 훅 내에서 **별도 체인**으로 동작
- 기존 HARD/SOFT 규칙 매칭보다 **먼저** 실행 (위험 명령은 규칙 매칭 전에 차단)
- 나중에 Signal→Rule 파이프라인을 통해 자동 생성된 규칙으로 확장 가능

### 10.3 기존 improver compacting과의 관계

- 기존: `output.context.push()`로 컨텍스트 주입
- 새: `output.prompt` 오버라이드로 컴팩션 프롬프트 자체 커스터마이징
- 독립적으로 동작. compact_override가 켜지면 prompt가 교체되고, context.push는 그대로 작동

---

## 11. 구현 순서

```
Phase 1: 인프라 (설정 + 타입 + 상수) ✅
├── config/schema.ts에 token_optimizer 설정 5개 추가
├── types.ts에 ToolCategory, DangerPattern 타입 추가
└── shared/constants.ts에 위험 명령 패턴 테이블 + 컴팩션 프롬프트 + 예산 한계 추가
   → verify: tsc 통과 ✅

Phase 2: 사전 차단 (가장 즉각적 효과) ✅
├── enforcer.ts에 pre_tool_guard 로직 추가
│   → verify: cat huge.log 차단, tail -200 통과, git log 1회 허용 테스트 ✅
├── observer.ts에 loop_budget 카테고리 분류 + 예산 체크 추가
│   → verify: search 21회 차단, read 통과 테스트 ✅
└── observer.ts에 file_deduper mtime/size 지문 추적 + 차단 추가
   → verify: 같은 파일 4회 차단, 파일 수정 후 통과 테스트 ✅

Phase 3: 컴팩션 ✅
└── improver.ts에 compact_override 추가
   → verify: output.prompt가 커스텀 프롬프트로 교체되는지 테스트 ✅

Phase 4: 테스트 ✅
└── __tests__/token-optimizer-v2.test.ts 신규 작성
   → verify: vitest 전체 통과 ✅
```

---

## 12. 테스트 계획

| # | 테스트 케이스 | 대상 | 검증 |
|---|-------------|------|------|
| 1 | `cat huge.log` 차단 | pre_tool_guard | throw Error + 대안 제안 포함 |
| 2 | `cat -n huge.log` 차단 | pre_tool_guard | 플래그 포함해도 감지 |
| 3 | `tail -200 huge.log` 통과 | pre_tool_guard | 정상 실행 (위험 패턴 아님) |
| 4 | `git log` 첫 호출 통과 | pre_tool_guard | 세션당 1회 허용 |
| 5 | `git log` 두 번째 차단 | pre_tool_guard | 대안 제안 포함 |
| 6 | `npm test` 통과 | pre_tool_guard | v0에서는 npm test 차단 안 함 |
| 7 | `docker logs app` 차단 | pre_tool_guard | `--tail` 없으면 차단 |
| 8 | `docker logs --tail 200 app` 통과 | pre_tool_guard | `--tail` 있으면 통과 |
| 9 | search 20회까지 통과, 21회 차단 | loop_budget | 카테고리별 독립 예산 |
| 10 | search 20회 도달해도 read 통과 | loop_budget | 카테고리 독립성 |
| 11 | 차단된 호출은 예산 미소모 | loop_budget | throw 후 카운트 불변 |
| 12 | session.created에서 Map 초기화 | loop_budget | 세션 전환 시 클린 |
| 13 | 같은 파일 unchanged 3회 통과, 4회 차단 | file_deduper | 임계값 3 |
| 14 | 파일 수정 후 재읽기 통과 | file_deduper | mtime/size 변경 시 카운터 리셋 |
| 15 | 임계값 전에는 stat 호출 없음 | file_deduper | 카운트 < 3이면 fs.statSync 미호출 |
| 16 | compact prompt 오버라이드 | compact_override | output.prompt가 커스텀 프롬프트로 교체 |
| 17 | compact override 꺼져있으면 기본 prompt | compact_override | output.prompt 변경 없음 |
| 18 | 마스터 토글 false 시 전체 비활성 | 전체 | 아무 기능도 동작하지 않음 |

---

## 13. 리스크

| 리스크 | 확률 | 영향 | 완화 |
|--------|------|------|------|
| 위험 명령이 정상 작업을 차단 | 중간 | 높음 | default-off + npm test 제외 + git log 1회 허용 + 차단 메시지에 비활성화 안내 |
| loop_budget이 타당한 작업을 차단 | 낮음 | 중간 | 세션 전체 한계를 관대하게 설정(search 20, read 30) + default-off |
| file_deduper가 파일 변경을 놓침 | 극히 낮음 | 중간 | mtimeMs + size 결합. 같은 초 + 같은 크기 변경은 극히 드묾 |
| compact_override가 컴팩션 품질 저하 | 낮음 | 중간 | 기존 context.push() 유지 + prompt만 교체 + default-off |
| regex가 변형 명령을 놓침 | 중간 | 낮음 | `\bcat\s+\S+`로 플래그 포함 감지. 놓치면 pre_tool_guard 통과 → OpenCode 자체 pruning이 안전망 |

---

## 14. v0 범위 확정

**포함 (4개):**
- pre_tool_guard — 큰 출력 명령 사전 차단
- loop_budget — 세션 전체 도구 유형별 예산 차단
- file_deduper — 같은 파일 반복 읽기 차단
- compact_override — 컴팩션 프롬프트 커스터마이징

**명시적 제외:**
- session_pressure — 실전 데이터로 압력 휴리스틱 보정 필요
- output_meter — observer에 10줄 추가 수준이지만 원칙 위반 소지
- capsule — compact_override로 충분. 신규 모듈 + JSONL 파싱 비용 불필요
- profile_router — 자동 모델 전환 위험
- fork_guard — OpenCode fork 매핑 불명확
- semantic compactor — LLM 호출 불가 + 원칙 위반
- 크로스 세션 패턴 학습기 — v1 이후
- 턴 단위 loop_budget — 턴 경계 감지 검증 필요

---

## 15. v0.5 → v1 분기 조건 및 임계값 조정 기준

### 15.1 v0.5: 지표 자동 산출

v0에서 이미 `harness.jsonl`에 차단/실행 기록이 남는다. v0.5에서 `session.idle` 시 다음 4개 지표를 자동 산출하여 `token-optimizer-metrics.jsonl`에 append한다.

| 지표 | 계산법 | 의미 |
|------|--------|------|
| **차단율** (block rate) | 차단 횟수 / (차단 + 실행) × 100 | 높으면 과도, 낮으면 무의미 |
| **카테고리별 사용률** | 각 카테고리 실제 호출 수 / 예산 × 100 | 100%면 예산 부족, 25%면 과잉 |
| **차단 후 재시도율** | 차단 → 같은 카테고리 재시도 / 차단 | 높으면 진짜 필요한 걸 막은 것 |
| **세션 완료율** | 차단으로 인한 작업 중단 / 전체 세션 | 0%가 이상적 |

### 15.2 3-세션 규칙 (조정 타이밍)

같은 패턴이 **3개 세션 이상 연속**으로 관측되면 조정을 검토한다.

**예산 상향 조건 (너무 공격적):**
- 차단율 > 30% (정상 작업의 1/3을 막고 있음)
- 차단 후 재시도율 > 80% (진짜 필요했는데 막은 거)
- 3세션 연속 동일 패턴

**예산 하향 조건 (너무 관대):**
- 차단율 < 5% + 토큰 절감 효과 미감지
- 카테고리 평균 사용률 < 25%

### 15.3 구체적 조정 기준표

| 상황 | 신호 | 조정 방향 |
|------|------|-----------|
| search 예산 부족 | search 20/20 도달 + 차단 후 바로 재시도 | 20 → 30 |
| search 예산 과잉 | search 평균 5/20 | 20 → 12 |
| read 예산 부족 | 30/30 + 대형 리팩토링 세션 | 30 → 40 |
| read 예산 과잉 | read 평균 8/30 | 30 → 20 |
| test 예산 부족 | 10/10 + TDD 사이클 세션 | 10 → 15 |
| write 예산 과잉 | write 평균 3/20 | 20 → 12 |
| file_deduper 공격적 | 3회 차단 후 "파일 변경됨" 재시도 빈번 | 임계값 3 → 5 |
| file_deduper 관대 | 동일 파일 6회+ 읽기가 빈번 | 임계값 3 → 2 |
| git log 1회 부족 | 세션 2시간+ + 커밋 많이 발생 | 허용 1 → 2 |
| 카테고리 분류 오류 | bash 명령이 other로만 분류 | `classifyToolCall()` regex 보완 |

### 15.4 v1 마이그레이션 계획

```
v0 (현재):    하드코딩 + 데이터 수집 (harness.jsonl에 이미 기록 중)
v0.5 (다음):  session.idle에서 지표 자동 산출
              → token-optimizer-metrics.jsonl에 append
              → "최근 10개 세션 search 사용률 95% → 예산 상향 권장" 출력
v1 (이후):    임계값을 harness.jsonc에서 설정 가능하게
              → 지표 기반으로 조정 제안 (사람이 확인 후 수동 변경)
              → 자동 조정은 하지 않음
```

**원칙: 측정은 자동, 판단은 수동.** 임계값이 낮아지면 규칙처럼 오탐 문제가 생기므로, 자동 조정은 v1에서도 금지.

### 15.5 v1 기능 도입 조건

v0.5 지표를 2주간 수집 후 다음 기준으로 v1 기능을 결정한다:

| 지표 | v1 판단 기준 |
|------|------------|
| pre_tool_guard 오탐율 | 차단 후 대안 성공 < 80%면 패턴 조정 |
| loop_budget 도달 빈도 | 예산 소진 > 30%면 한계 상향 |
| file_deduper 오탐율 | 차단 후 파일 실제 변경 > 5%면 핑거프린트 개선 |
| compact_override 만족도 | 컴팩션 후 세션 연속 성공 < 70%면 프롬프트 개선 |
| 세션 압력 분포 | medium/high > 30%면 session_pressure v1 도입 |

---

## 16. 구현 결과

| 항목 | 내용 |
|------|------|
| Date | 2026-04-29 |
| Status | 구현 완료 + 실전 검증 완료 |
| Modified files | 6 (schema.ts, types.ts, constants.ts, enforcer.ts, observer.ts, improver.ts) |
| New files | 0 |
| Runtime dependencies | 0 |
| Tests | 34/34 passed (18 new + 16 existing) |
| E2E verification | cat blocked, git log blocked (2nd call), tail passed, agent auto-selected alternatives |
