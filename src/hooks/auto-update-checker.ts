import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { HARNESS_DIR, logger, readJsonFile } from '../shared/index.js';
import { getHarnessSettings, type HarnessConfig } from '../config/index.js';

type PluginMetadata = {
    name: string;
    version: string;
};

type AutoUpdateCheckerState = {
    last_checked_at?: string;
    last_notified_version?: string;
};

type AutoUpdateCheckerDeps = {
    now?: () => number;
    statePath?: string;
    logger?: Pick<typeof logger, 'warn'>;
    packageMetadata?: PluginMetadata;
    fetchLatestVersion?: (packageName: string) => Promise<string | null>;
};

const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const PACKAGE_JSON_SEARCH_DEPTH = 8;
const cachedMetadataByDir = new Map<string, PluginMetadata | null>();
const moduleDir = dirname(fileURLToPath(import.meta.url));

function getStatePath(): string {
    return join(HARNESS_DIR, 'projects', 'global', 'auto-update-checker.json');
}

function getPluginMetadata(startDir: string = moduleDir): PluginMetadata | null {
    const cachedMetadata = cachedMetadataByDir.get(startDir);
    if (cachedMetadata !== undefined) return cachedMetadata;

    let currentDir = startDir;
    for (let depth = 0; depth < PACKAGE_JSON_SEARCH_DEPTH; depth++) {
        const packageJsonPath = join(currentDir, 'package.json');
        try {
            const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { name?: unknown; version?: unknown };
            if (typeof parsed.name === 'string' && typeof parsed.version === 'string') {
                const metadata = { name: parsed.name, version: parsed.version };
                cachedMetadataByDir.set(startDir, metadata);
                return metadata;
            }
        } catch {
            // Continue walking upward.
        }

        const parentDir = dirname(currentDir);
        if (parentDir === currentDir) break;
        currentDir = parentDir;
    }

    cachedMetadataByDir.set(startDir, null);
    return null;
}

function loadState(statePath: string): AutoUpdateCheckerState {
    return readJsonFile<AutoUpdateCheckerState & object>(statePath, {});
}

function saveState(statePath: string, state: AutoUpdateCheckerState): void {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function isWithinCooldown(lastCheckedAt: string | undefined, nowMs: number): boolean {
    if (!lastCheckedAt) return false;
    const last = Date.parse(lastCheckedAt);
    return Number.isFinite(last) && nowMs - last < COOLDOWN_MS;
}

function parseVersion(version: string): number[] {
    return version.split('.').map((part) => {
        const parsed = Number.parseInt(part, 10);
        return Number.isFinite(parsed) ? parsed : 0;
    });
}

function isNewerVersion(latest: string, current: string): boolean {
    const latestParts = parseVersion(latest);
    const currentParts = parseVersion(current);
    for (let i = 0; i < 3; i++) {
        const latestPart = latestParts[i] ?? 0;
        const currentPart = currentParts[i] ?? 0;
        if (latestPart > currentPart) return true;
        if (latestPart < currentPart) return false;
    }
    return false;
}

export async function queryRegistryLatestVersion(packageName: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
        const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, { signal: controller.signal });
        if (!response.ok) return null;

        const body = await response.json() as { ['dist-tags']?: { latest?: unknown }; version?: unknown };
        const latest = body['dist-tags']?.latest;
        if (typeof latest === 'string' && latest.length > 0) return latest;
        if (typeof body.version === 'string' && body.version.length > 0) return body.version;
        return null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

export async function runAutoUpdateCheck(config: HarnessConfig | undefined, deps: AutoUpdateCheckerDeps = {}): Promise<void> {
    const settings = getHarnessSettings(config);
    if (!settings.auto_update_checker_enabled) return;

    const metadata = deps.packageMetadata ?? getPluginMetadata();
    if (!metadata) {
        (deps.logger ?? logger).warn('auto-update-checker', 'package metadata unavailable');
        return;
    }

    const statePath = deps.statePath ?? getStatePath();
    const nowMs = deps.now?.() ?? Date.now();
    const state = loadState(statePath);
    if (isWithinCooldown(state.last_checked_at, nowMs)) return;

    try {
        const latestVersion = await (deps.fetchLatestVersion ?? queryRegistryLatestVersion)(metadata.name);
        if (!latestVersion) {
            (deps.logger ?? logger).warn('auto-update-checker', 'registry lookup failed', { package_name: metadata.name });
        } else if (isNewerVersion(latestVersion, metadata.version)) {
            (deps.logger ?? logger).warn('auto-update-checker', 'new version available', {
                package_name: metadata.name,
                current_version: metadata.version,
                latest_version: latestVersion,
            });
            saveState(statePath, { last_checked_at: new Date(nowMs).toISOString(), last_notified_version: latestVersion });
            return;
        }
    } catch {
        (deps.logger ?? logger).warn('auto-update-checker', 'registry lookup failed', { package_name: metadata.name });
        saveState(statePath, { last_checked_at: new Date(nowMs).toISOString(), last_notified_version: state.last_notified_version });
        return;
    }

    saveState(statePath, { last_checked_at: new Date(nowMs).toISOString(), last_notified_version: state.last_notified_version });
}

export function createAutoUpdateCheckerHook(options: { harnessConfig?: HarnessConfig; statePath?: string; logger?: Pick<typeof logger, 'warn'>; packageMetadata?: PluginMetadata; fetchLatestVersion?: (packageName: string) => Promise<string | null>; now?: () => number } = {}) {
    return {
        event: async ({ event }: { event: { type: string } }) => {
            if (event.type !== 'session.created') return;

            try {
                await runAutoUpdateCheck(options.harnessConfig, {
                    statePath: options.statePath,
                    logger: options.logger,
                    packageMetadata: options.packageMetadata,
                    fetchLatestVersion: options.fetchLatestVersion,
                    now: options.now,
                });
            } catch {
                (options.logger ?? logger).warn('auto-update-checker', 'auto-update check aborted');
            }
        },
    };
}

export { getPluginMetadata };
