import { logger } from '../shared/logger.js';
import { parseList } from '../shared/utils.js';
import type { HarnessConfig } from '../config/index.js';

type FilterSkillsContext = {
    harnessConfig?: HarnessConfig;
    sessionAgents: Map<string, string>;
};

const AVAILABLE_SKILLS_BLOCK = /<available_skills>([\s\S]*?)<\/available_skills>/i;

function extractSkillEntries(body: string): string[] {
    const tagged = body.match(/<skill\b[\s\S]*?<\/skill>/gi);
    if (tagged && tagged.length > 0) return tagged;

    return body
        .split(/\n{2,}/)
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.length > 0 && /skill/i.test(chunk));
}

function extractSkillName(entry: string): string | null {
    const nameAttr = entry.match(/name\s*=\s*["']([^"']+)["']/i);
    if (nameAttr?.[1]) return nameAttr[1].trim();

    const nameTag = entry.match(/<name>\s*([^<]+?)\s*<\/name>/i);
    if (nameTag?.[1]) return nameTag[1].trim();

    const bullet = entry.match(/^\s*[-*]\s*(?:\*\*)?([A-Za-z0-9_.-]+)(?:\*\*)?/m);
    if (bullet?.[1]) return bullet[1].trim();

    return null;
}

function extractSkillNames(systemPrompt: string): string[] {
    const match = systemPrompt.match(AVAILABLE_SKILLS_BLOCK);
    const body = match?.[1] ?? systemPrompt;
    const entries = extractSkillEntries(body);
    const names = new Set<string>();

    for (const entry of entries) {
        const name = extractSkillName(entry);
        if (name) names.add(name);
    }

    return [...names];
}

export function filterAvailableSkillsBlock(systemPrompt: string, allowedSkills: string[] | undefined, allSkillNames: string[]): string {
    const match = systemPrompt.match(AVAILABLE_SKILLS_BLOCK);
    if (!match) return systemPrompt;

    const resolvedAllowed = parseList(allowedSkills ?? [], allSkillNames);
    if (resolvedAllowed.length === 0) {
        return systemPrompt.replace(match[0], '<available_skills>\n<!-- filtered: no allowed skills -->\n</available_skills>');
    }

    if (resolvedAllowed.length === allSkillNames.length) {
        return systemPrompt;
    }

    const allowedSet = new Set(resolvedAllowed);
    const entries = extractSkillEntries(match[1] ?? '');
    const filtered = entries.filter((entry) => {
        const name = extractSkillName(entry);
        return name ? allowedSet.has(name) : false;
    });

    const nextBlock = filtered.length > 0
        ? `<available_skills>\n${filtered.join('\n\n')}\n</available_skills>`
        : '<available_skills>\n<!-- filtered: no allowed skills -->\n</available_skills>';

    return systemPrompt.replace(match[0], nextBlock);
}

export function createFilterAvailableSkillsHook(context: FilterSkillsContext) {
    return {
        'chat.params': async (input: { sessionID: string; agent: string }) => {
            context.sessionAgents.set(input.sessionID, input.agent);
        },

        event: async (input: { event: { type: string; properties?: Record<string, unknown> } }) => {
            if (input.event.type !== 'session.idle' && input.event.type !== 'session.deleted') {
                return;
            }

            const sessionID = String((input.event.properties as { sessionID?: string } | undefined)?.sessionID ?? '');
            if (sessionID) {
                context.sessionAgents.delete(sessionID);
            }
        },

        'experimental.chat.system.transform': async (input: { sessionID?: string }, output: { system: string[] }) => {
            if (!input.sessionID) return;

            const agent = context.sessionAgents.get(input.sessionID);
            if (!agent) return;

            const allowedSkills = context.harnessConfig?.agents?.[agent]?.skills;

            const mergedPrompt = output.system.join('\n');
            const skillNames = extractSkillNames(mergedPrompt);
            if (skillNames.length === 0) return;

            const filteredPrompt = filterAvailableSkillsBlock(mergedPrompt, allowedSkills, skillNames);
            if (filteredPrompt !== mergedPrompt) {
                output.system.splice(0, output.system.length, filteredPrompt);
                logger.debug('filter-available-skills', 'available skills filtered', {
                    sessionID: input.sessionID,
                    agent,
                });
            }
        },
    };
}
