import { logger } from '../shared/logger.js';

interface DelegateTaskErrorPattern {
    pattern: RegExp;
    errorType: string;
    fixHint: string;
}

const DELEGATE_TASK_ERROR_PATTERNS: DelegateTaskErrorPattern[] = [
    { pattern: /could not find agent/i, errorType: 'agent_not_found', fixHint: 'Check the agent name. Use @mention with an exact current agent name (orchestrator, frontend, backend, tester, reviewer, designer, explorer, librarian, coder, advisor).' },
    { pattern: /no agent named/i, errorType: 'agent_not_found', fixHint: 'The agent name is incorrect. Available agents: orchestrator, frontend, backend, tester, reviewer, designer, explorer, librarian, coder, advisor.' },
    { pattern: /agent not available/i, errorType: 'agent_not_available', fixHint: 'The agent exists but may not be loaded. Verify the plugin is properly configured.' },
    { pattern: /failed to delegate/i, errorType: 'delegation_failed', fixHint: 'Delegation failed. Try again with a clearer, more specific task description.' },
    { pattern: /subagent.*error/i, errorType: 'subagent_error', fixHint: 'The subagent encountered an error. Review the task and simplify or break it down.' },
    { pattern: /task.*rejected/i, errorType: 'task_rejected', fixHint: 'The subagent rejected the task. Provide more context or a different approach.' },
];

interface DetectedError {
    errorType: string;
    originalOutput: string;
    fixHint: string;
}

function detectDelegateTaskError(output: string): DetectedError | null {
    for (const { pattern, errorType, fixHint } of DELEGATE_TASK_ERROR_PATTERNS) {
        if (pattern.test(output)) {
            return { errorType, originalOutput: output, fixHint };
        }
    }
    return null;
}

export function createDelegateTaskRetryHook() {
    let pendingGuidance: string | null = null;

    return {
        'tool.execute.after': async (input: { tool: string }, output?: { output?: unknown }) => {
            if (!output?.output) return;

            const outputStr = typeof output.output === 'string' ? output.output : JSON.stringify(output.output);
            if (!outputStr) return;

            const detected = detectDelegateTaskError(outputStr);
            if (detected) {
                pendingGuidance = `[DELEGATION ERROR RECOVERY]\nError type: ${detected.errorType}\n${detected.fixHint}\nDo NOT repeat the exact same delegation call. Adjust your approach based on the error.`;
                logger.warn('delegate-task-retry', 'delegation error detected', { errorType: detected.errorType });
            }
        },

        'experimental.chat.system.transform': async (_input: Record<string, never>, output: { system: string[] }) => {
            if (pendingGuidance) {
                output.system.push(pendingGuidance);
                pendingGuidance = null;
            }
        },
    };
}
