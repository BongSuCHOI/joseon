import { createDelegateTaskRetryHook } from './delegate-task-retry.js';
import { createJsonErrorRecoveryHook } from './json-error-recovery.js';
import { createPostFileToolNudgeHook } from './post-file-tool-nudge.js';
import { createPostReadNudgeHook } from './post-read-nudge.js';
import { createPhaseReminderHook } from './phase-reminder.js';

export function createAllHooks(): Record<string, (...args: unknown[]) => Promise<void>> {
    const hooks = [
        createDelegateTaskRetryHook(),
        createJsonErrorRecoveryHook(),
        createPostFileToolNudgeHook(),
        createPostReadNudgeHook(),
        createPhaseReminderHook(),
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
