import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { HarnessConfig } from './schema.js';
import { logger } from '../shared/logger.js';

function stripJsonc(content: string): string {
    let result = '';
    let inString = false;
    for (let i = 0; i < content.length; i++) {
        const ch = content[i];
        const next = content[i + 1];
        if (inString) {
            result += ch;
            if (ch === '\\' && next) {
                result += next;
                i++;
            } else if (ch === '"') {
                inString = false;
            }
        } else {
            if (ch === '"') {
                inString = true;
                result += ch;
            } else if (ch === '/' && next === '/') {
                while (i < content.length && content[i] !== '\n') i++;
                result += '\n';
            } else {
                result += ch;
            }
        }
    }
    result = result.replace(/,\s*([}\]])/g, '$1');
    return result;
}

function loadJsoncFile(filePath: string): Record<string, unknown> | null {
    if (!existsSync(filePath)) return null;
    try {
        const raw = readFileSync(filePath, 'utf-8');
        return JSON.parse(stripJsonc(raw)) as Record<string, unknown>;
    } catch (err) {
        logger.warn('config', 'failed to parse config file', { path: filePath, error: String(err) });
        return null;
    }
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result = { ...target };
    for (const [key, value] of Object.entries(source)) {
        if (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            result[key] !== null &&
            typeof result[key] === 'object' &&
            !Array.isArray(result[key])
        ) {
            result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
        } else {
            result[key] = value;
        }
    }
    return result;
}

export function loadConfig(directory: string): HarnessConfig {
    const globalPath = join(process.env.HOME!, '.config/opencode/harness.jsonc');
    const globalFallback = join(process.env.HOME!, '.config/opencode/harness.json');
    const projectPath = join(directory, '.opencode/harness.jsonc');
    const projectFallback = join(directory, '.opencode/harness.json');

    const global = loadJsoncFile(globalPath) || loadJsoncFile(globalFallback) || {};
    const project = loadJsoncFile(projectPath) || loadJsoncFile(projectFallback) || {};

    if (Object.keys(global).length === 0 && Object.keys(project).length === 0) {
        return {};
    }

    const merged = deepMerge(global, project);
    return merged as unknown as HarnessConfig;
}
