import { logger } from '../shared/logger.js';

const READ_NUDGE = '\n[HARNESS] Consider delegating implementation to a specialist subagent instead of doing it yourself.';

export function createPostReadNudgeHook() {
    return {
        'tool.execute.after': async (input: { tool: string; sessionID?: string }, output?: { output: unknown }) => {
            if (input.tool !== 'read') return;

            if (typeof output?.output === 'string') {
                output.output += READ_NUDGE;
                logger.debug('post-read-nudge', 'read nudge appended');
            }
        },
    };
}
