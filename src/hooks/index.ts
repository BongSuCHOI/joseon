import { createDelegateTaskRetryHook } from './delegate-task-retry.js';
import { createJsonErrorRecoveryHook } from './json-error-recovery.js';
import { createFilterAvailableSkillsHook } from './filter-available-skills.js';
import { createForegroundFallbackController, createForegroundFallbackHook } from './foreground-fallback.js';
import { createAutoUpdateCheckerHook } from './auto-update-checker.js';
import { createPostFileToolNudgeHook } from './post-file-tool-nudge.js';
import { createPostReadNudgeHook } from './post-read-nudge.js';

import type { HarnessConfig } from '../config/index.js';
import type { AgentDefinition } from '../agents/agents.js';

export type HookContext = {
    worktree: string;
    harnessConfig?: HarnessConfig;
    agentsByName: Record<string, AgentDefinition>;
    foregroundFallback: ReturnType<typeof createForegroundFallbackController>;
    sessionAgents: Map<string, string>;
    fallbackEnabled: boolean;
    client?: unknown;
};

export { createForegroundFallbackController, isRetryableModelFailure } from './foreground-fallback.js';
export { filterAvailableSkillsBlock } from './filter-available-skills.js';

export function createAllHooks(context: HookContext): Record<string, (...args: unknown[]) => Promise<void>> {
    const hooks = [
        createDelegateTaskRetryHook(),
        createJsonErrorRecoveryHook(),
        createPostFileToolNudgeHook(),
        createPostReadNudgeHook(),

        createAutoUpdateCheckerHook({ harnessConfig: context.harnessConfig }),
        createFilterAvailableSkillsHook({ harnessConfig: context.harnessConfig, sessionAgents: context.sessionAgents }),
        createForegroundFallbackHook({ worktree: context.worktree, agentsByName: context.agentsByName, fallbackEnabled: context.fallbackEnabled, client: context.client }, context.foregroundFallback),
    ];

    const merged: Record<string, Array<(...args: unknown[]) => Promise<void>>> = {};
    for (const hookObj of hooks) {
        for (const [key, handler] of Object.entries(hookObj)) {
            if (!merged[key]) merged[key] = [];
            merged[key].push(handler as (...args: unknown[]) => Promise<void>);
        }
    }

    const result: Record<string, (...args: unknown[]) => Promise<void>> = {};
    for (const [key, handlers] of Object.entries(merged)) {
        if (handlers.length === 1) {
            result[key] = handlers[0];
        } else {
            result[key] = async (...args: unknown[]) => {
                for (const handler of handlers) {
                    try {
                        await handler(...args);
                    } catch (err) {
                        // hook errors are not fatal
                    }
                }
            };
        }
    }
    return result;
}
