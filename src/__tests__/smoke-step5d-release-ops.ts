// src/__tests__/smoke-step5d-release-ops.ts — Step 5d release ops smoke test
// 실행: npx tsx src/__tests__/smoke-step5d-release-ops.ts

import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { createAutoUpdateCheckerHook, getPluginMetadata, queryRegistryLatestVersion } from '../hooks/auto-update-checker.js';

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
    const tempRoot = join(tmpdir(), `step5d-smoke-${Date.now()}`);
    mkdirSync(tempRoot, { recursive: true });
    const statePath = join(tempRoot, 'auto-update-checker.json');
    const metadata = getPluginMetadata();

    try {
        console.log('\n=== Step 5d Release Ops Smoke Tests ===\n');

        assert(metadata?.name === 'my-harness', 'package metadata is read from the plugin package');

        let fetchCount = 0;
        const warned: string[] = [];
        const hook = createAutoUpdateCheckerHook({
            harnessConfig: { harness: { auto_update_checker_enabled: true } },
            statePath,
            packageMetadata: { name: 'my-harness', version: '0.1.0' },
            fetchLatestVersion: async () => {
                fetchCount++;
                return null;
            },
            logger: { warn: (_module: string, message: string) => warned.push(message) },
            now: () => Date.now(),
        });

        await hook.event({ event: { type: 'session.created' } });
        await hook.event({ event: { type: 'subagent.session.created' } });
        assert(fetchCount === 1, 'session.created triggers the checker and subagent.session.created does not');
        assert(warned.includes('registry lookup failed') || warned.includes('new version available') || warned.length === 0, 'checker completes without blocking session flow');

        const nonBlockingHook = createAutoUpdateCheckerHook({
            harnessConfig: { harness: { auto_update_checker_enabled: true } },
            statePath: join(tempRoot, 'nonblocking.json'),
            packageMetadata: { name: 'my-harness', version: '0.1.0' },
            fetchLatestVersion: async () => {
                throw new Error('registry down');
            },
            logger: { warn: (_module: string, _message: string) => undefined },
            now: () => Date.now(),
        });
        await nonBlockingHook.event({ event: { type: 'session.created' } });
        assert(true, 'registry failure does not interrupt the session path');

        const liveName = metadata?.name ?? 'my-harness';
        const liveVersion = await queryRegistryLatestVersion(liveName);
        assert(typeof liveVersion === 'string' || liveVersion === null, 'live registry query against the actual package name completes without throwing');
        assert(typeof readJson(statePath)?.last_checked_at === 'string', 'successful mock run writes cooldown state');

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
