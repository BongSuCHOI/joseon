// src/__tests__/unit-step5d-release-ops.ts — focused Step 5d unit-style coverage
// 실행: ./node_modules/.bin/tsx src/__tests__/unit-step5d-release-ops.ts

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { getPluginMetadata, runAutoUpdateCheck } from '../hooks/auto-update-checker.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
    if (condition) {
        passed++;
        console.log(`  ✓ ${msg}`);
    } else {
        failed++;
        console.error(`  ✗ ${msg}`);
    }
}

function readJson(filePath: string): Record<string, unknown> | undefined {
    if (!existsSync(filePath)) return undefined;
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
}

async function main(): Promise<void> {
    const tempRoot = join(tmpdir(), `step5d-unit-${Date.now()}`);
    mkdirSync(tempRoot, { recursive: true });
    const statePath = join(tempRoot, 'auto-update-checker.json');

    const metadata = { name: 'my-harness', version: '0.1.0' };
    const warnings: Array<{ module: string; message: string; data?: Record<string, unknown> }> = [];
    let fetchCount = 0;

    try {
        console.log('\n=== Step 5d Release Ops Unit Tests ===\n');

        const metadataRoot = join(tempRoot, 'metadata-search');
        const hookDir = join(metadataRoot, '.opencode', 'plugins', 'harness', 'hooks');
        mkdirSync(hookDir, { recursive: true });
        mkdirSync(join(metadataRoot, '.opencode'), { recursive: true });
        writeFileSync(join(metadataRoot, '.opencode', 'package.json'), JSON.stringify({ version: '0.0.0' }));
        writeFileSync(join(metadataRoot, 'package.json'), JSON.stringify({ name: 'my-harness', version: '0.1.0' }));
        const discoveredMetadata = getPluginMetadata(hookDir);
        assert(discoveredMetadata?.name === 'my-harness' && discoveredMetadata.version === '0.1.0', 'metadata lookup walks past invalid .opencode package metadata');

        await runAutoUpdateCheck({ harness: { auto_update_checker_enabled: false } }, {
            statePath,
            packageMetadata: metadata,
            fetchLatestVersion: async () => {
                fetchCount++;
                return '0.2.0';
            },
            logger: { warn: (module: string, message: string, data?: Record<string, unknown>) => warnings.push({ module, message, data }) },
        });
        assert(fetchCount === 0, 'default-off skips registry lookup');
        assert(warnings.length === 0, 'default-off stays silent');
        assert(!existsSync(statePath), 'default-off does not write cooldown state');

        await runAutoUpdateCheck({ harness: { auto_update_checker_enabled: true } }, {
            statePath,
            packageMetadata: metadata,
            fetchLatestVersion: async () => {
                fetchCount++;
                return '0.2.0';
            },
            logger: { warn: (module: string, message: string, data?: Record<string, unknown>) => warnings.push({ module, message, data }) },
            now: () => Date.now(),
        });
        assert(fetchCount === 1, 'enabled path queries registry once');
        assert(warnings.some((entry) => entry.message === 'new version available'), 'newer version emits warn-only notice');
        const stateAfterNewVersion = readJson(statePath);
        assert(typeof stateAfterNewVersion?.last_checked_at === 'string', 'new version writes global cooldown state');

        warnings.length = 0;
        fetchCount = 0;
        const fixedNow = Date.now();
        await runAutoUpdateCheck({ harness: { auto_update_checker_enabled: true } }, {
            statePath,
            packageMetadata: metadata,
            fetchLatestVersion: async () => {
                fetchCount++;
                return '0.1.0';
            },
            logger: { warn: (module: string, message: string, data?: Record<string, unknown>) => warnings.push({ module, message, data }) },
            now: () => fixedNow,
        });
        assert(fetchCount === 0, 'cooldown suppresses repeated lookup');
        assert(warnings.length === 0, 'cooldown suppresses repeated warning');

        rmSync(statePath, { force: true });
        warnings.length = 0;
        fetchCount = 0;
        await runAutoUpdateCheck({ harness: { auto_update_checker_enabled: true } }, {
            statePath,
            packageMetadata: metadata,
            fetchLatestVersion: async () => {
                fetchCount++;
                throw new Error('registry offline');
            },
            logger: { warn: (module: string, message: string, data?: Record<string, unknown>) => warnings.push({ module, message, data }) },
            now: () => Date.now(),
        });
        assert(fetchCount === 1, 'failure path still attempts registry lookup once');
        assert(warnings.some((entry) => entry.message === 'registry lookup failed'), 'failure path is warn-only');
        assert(typeof readJson(statePath)?.last_checked_at === 'string', 'failure path still records cooldown state');

        warnings.length = 0;
        fetchCount = 0;
        rmSync(statePath, { force: true });
        await runAutoUpdateCheck({ harness: { auto_update_checker_enabled: true } }, {
            statePath,
            packageMetadata: metadata,
            fetchLatestVersion: async () => {
                fetchCount++;
                return '0.1.0';
            },
            logger: { warn: (module: string, message: string, data?: Record<string, unknown>) => warnings.push({ module, message, data }) },
            now: () => Date.now(),
        });
        assert(fetchCount === 1, 'same-version path still queries once');
        assert(warnings.length === 0, 'same-version path stays silent');

        console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
    } finally {
        rmSync(tempRoot, { recursive: true, force: true });
    }

    process.exit(failed > 0 ? 1 : 0);
}

void main().catch((err) => {
    console.error(err);
    process.exit(1);
});
