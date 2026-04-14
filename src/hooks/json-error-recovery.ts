import { logger } from '../shared/logger.js';

const JSON_ERROR_TOOL_EXCLUDE_LIST = new Set(['bash', 'read', 'glob', 'webfetch', 'grep_app_searchgithub', 'websearch_web_search_exa']);

const JSON_ERROR_PATTERNS: RegExp[] = [
    /unexpected token/i,
    /is not valid JSON/i,
    /JSON\.parse/i,
    /unexpected end of JSON/i,
    /unexpected character/i,
    /expected.*but got/i,
    /invalid JSON/i,
    /cannot read properties of undefined/i,
];

const JSON_ERROR_REMINDER = `[JSON PARSE ERROR - IMMEDIATE ACTION REQUIRED]

You sent invalid JSON arguments. The system could not parse your tool call.
STOP and do this NOW:

1. LOOK at the error message above to see what was expected vs what you sent.
2. CORRECT your JSON syntax (missing braces, unescaped quotes, trailing commas, etc).
3. RETRY the tool call with valid JSON.

DO NOT repeat the exact same invalid call.`;

export function createJsonErrorRecoveryHook() {
    let pendingReminder: string | null = null;

    return {
        'tool.execute.after': async (input: { tool: string }, output?: { output?: unknown }) => {
            if (JSON_ERROR_TOOL_EXCLUDE_LIST.has(input.tool)) return;
            if (!output?.output) return;

            const outputStr = typeof output.output === 'string' ? output.output : JSON.stringify(output.output);
            if (!outputStr) return;

            const hasJsonError = JSON_ERROR_PATTERNS.some((p) => p.test(outputStr));
            if (hasJsonError) {
                pendingReminder = JSON_ERROR_REMINDER;
                logger.warn('json-error-recovery', 'JSON parse error detected', { tool: input.tool });
            }
        },

        'experimental.chat.system.transform': async (_input: Record<string, never>, output: { system: string[] }) => {
            if (pendingReminder) {
                output.system.push(pendingReminder);
                pendingReminder = null;
            }
        },
    };
}
