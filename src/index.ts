// src/index.ts — OpenCode Plugin 진입점
// export default { id, server() } 패턴 (OpenCode v1 플러그인 형식)

import { HarnessObserver } from './harness/observer.js';
import { HarnessEnforcer } from './harness/enforcer.js';
import { HarnessImprover } from './harness/improver.js';
import { mergeEventHandlers } from './shared/index.js';

export default {
  id: "my-harness",
  server: async (input: { project: unknown; client: unknown; $: unknown; directory: string; worktree: string }) => {
    const ctx = { worktree: input.worktree };
    const observerHooks = await HarnessObserver(ctx);
    const enforcerHooks = await HarnessEnforcer(ctx);
    const improverHooks = await HarnessImprover(ctx);

    // v3 버그 C1 수정: 스프레드 대신 mergeEventHandlers로 event 훅 병합
    // (스프레드 연산자는 나중 것이 앞의 것을 덮어씀)
    const allHooks = [observerHooks, enforcerHooks, improverHooks];
    const merged = mergeEventHandlers(...allHooks);

    // non-event 훅은 스프레드로 안전하게 합치고, event는 병합된 것 사용
    const result: Record<string, unknown> = { ...observerHooks, ...enforcerHooks, ...improverHooks };
    // 병합된 event 훅으로 덮어쓰기
    for (const [key, handler] of Object.entries(merged)) {
      result[key] = handler;
    }
    return result;
  }
};
