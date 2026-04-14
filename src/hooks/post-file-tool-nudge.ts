import { logger } from '../shared/logger.js';

const FILE_TOOLS = new Set(['write', 'edit', 'patch']);

const DELEGATION_NUDGE = `[HARNESS NUDGE] You just modified a file directly.
As the orchestrator, you should DELEGATE implementation to specialist subagents whenever possible.
Use @frontend, @backend, @designer, or @tester for their respective tasks.
Only implement directly for trivial changes (1-2 lines, config fixes).`;

export function createPostFileToolNudgeHook() {
    const nudgedSessions = new Set<string>();

    return {
        'tool.execute.after': async (input: { tool: string; sessionID?: string }) => {
            if (!FILE_TOOLS.has(input.tool)) return;
            if (!input.sessionID) return;

            if (!nudgedSessions.has(input.sessionID)) {
                nudgedSessions.add(input.sessionID);
                logger.debug('post-file-tool-nudge', 'delegation nudge queued', { tool: input.tool });
            }
        },

        'experimental.chat.system.transform': async (input: { sessionID?: string }, output: { system: string[] }) => {
            if (input.sessionID && nudgedSessions.has(input.sessionID)) {
                output.system.push(DELEGATION_NUDGE);
                nudgedSessions.delete(input.sessionID);
            }
        },

        event: async (input: { event: { type: string } }) => {
            if (input.event.type === 'session.created') {
                nudgedSessions.clear();
            }
        },
    };
}
