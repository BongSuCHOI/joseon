// src/__tests__/smoke-step5a-foundation.ts — Step 5a shadow/guard smoke test
// 실행: npx tsx src/__tests__/smoke-step5a-foundation.ts

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { HarnessObserver } from '../harness/observer.js';
import { HarnessImprover, appendMistakeSummaryShadow } from '../harness/improver.js';
import { HARNESS_DIR, getProjectKey } from '../shared/index.js';

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

function readJsonl(filePath: string): Array<Record<string, unknown>> {
    if (!existsSync(filePath)) return [];
    return readFileSync(filePath, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function removeProjectSignals(dir: string, targetProjectKey: string): void {
    if (!existsSync(dir)) return;

    for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        const filePath = join(dir, file);
        try {
            const signal = JSON.parse(readFileSync(filePath, 'utf-8')) as { project_key?: string };
            if (signal.project_key === targetProjectKey) {
                rmSync(filePath, { force: true });
            }
        } catch {
            // ignore unrelated/corrupt files in shared harness storage
        }
    }
}

const testDir = join(tmpdir(), `step5a-test-${Date.now()}`);
const opencodeDir = join(testDir, '.opencode');
const pendingDir = join(HARNESS_DIR, 'signals', 'pending');
const ackDir = join(HARNESS_DIR, 'signals', 'ack');
const validSignalFile = join(pendingDir, 'step5a-valid.json');
const invalidSignalFile = join(pendingDir, 'step5a-invalid.json');
const defaultSignalFile = join(pendingDir, 'step5a-default.json');
const validAckFile = join(ackDir, 'step5a-valid.json');
const invalidAckFile = join(ackDir, 'step5a-invalid.json');
const defaultAckFile = join(ackDir, 'step5a-default.json');

let projectKey = 'unknown';
let projectHarnessDir = '';
let shadowPath = '';
let mistakePath = '';
let ackStatusPath = '';

async function main(): Promise<void> {
    mkdirSync(opencodeDir, { recursive: true });
    projectKey = getProjectKey(testDir);
    projectHarnessDir = join(HARNESS_DIR, 'projects', projectKey);
    shadowPath = join(projectHarnessDir, 'phase-signal-shadow.jsonl');
    mistakePath = join(projectHarnessDir, 'mistake-pattern-shadow.jsonl');
    ackStatusPath = join(projectHarnessDir, 'ack-status.jsonl');
    rmSync(projectHarnessDir, { recursive: true, force: true });
    rmSync(validSignalFile, { force: true });
    rmSync(invalidSignalFile, { force: true });
    rmSync(defaultSignalFile, { force: true });
    rmSync(validAckFile, { force: true });
    rmSync(invalidAckFile, { force: true });
    rmSync(defaultAckFile, { force: true });

    try {
        console.log('\n=== Step 5a Shadow Foundation Smoke Tests ===\n');

        const observer = await HarnessObserver({ worktree: testDir });
        const event = observer.event as (input: { event: { type: string; properties?: Record<string, unknown> } }) => Promise<void>;

        console.log('[1] signal shadow logging keeps deterministic emission path');
        await event({ event: { type: 'session.error', properties: { sessionID: 'sess-1', error: new Error('TypeError: boom') } } });
        let shadowRecords = readJsonl(shadowPath);
        assert(shadowRecords.length === 1, 'first signal candidate appended to shadow log');
        assert(shadowRecords[0].kind === 'signal', 'shadow record kind === signal');
        assert((shadowRecords[0].deterministic as { emitted?: boolean }).emitted === false, 'shadow log records non-emitting baseline');

        await event({ event: { type: 'session.error', properties: { sessionID: 'sess-1', error: new Error('TypeError: boom') } } });
        await event({ event: { type: 'session.error', properties: { sessionID: 'sess-1', error: new Error('TypeError: boom') } } });
        assert(existsSync(join(pendingDir, 'step5a-valid.json')) === false, 'existing fixture file is still absent before manual setup');
        const emittedPendingSignals = readdirSync(pendingDir)
            .filter((file) => file.endsWith('.json'))
            .map((file) => join(pendingDir, file))
            .map((file) => {
                try {
                    return JSON.parse(readFileSync(file, 'utf-8')) as { project_key?: string; type?: string };
                } catch {
                    return undefined;
                }
            })
            .filter((signal): signal is { project_key?: string; type?: string } => Boolean(signal))
            .filter((signal) => signal.project_key === projectKey && signal.type === 'error_repeat');
        assert(emittedPendingSignals.length >= 1, 'deterministic pending signal still emitted on third repeat');

        await event({ event: { type: 'message.part.updated', properties: { part: { type: 'text', text: '이거 또 안돼', messageID: 'msg-1' } } } });
        shadowRecords = readJsonl(shadowPath);
        assert(shadowRecords.some((record) => (record.deterministic as { signal_type?: string }).signal_type === 'user_feedback'), 'user feedback candidate logged to shadow file');

        console.log('\n[2] guarded ack writes written+accepted only when acceptance passes');
        writeFileSync(validSignalFile, JSON.stringify({
            id: 'step5a-valid',
            type: 'error_repeat',
            project_key: projectKey,
            timestamp: new Date().toISOString(),
            status: 'pending',
            payload: {
                description: 'Repeated boom error',
                pattern: 'TypeError: boom',
                recurrence_count: 3,
            },
        }, null, 2));
        writeFileSync(invalidSignalFile, JSON.stringify({
            id: 'step5a-invalid',
            type: 'error_repeat',
            project_key: projectKey,
            timestamp: new Date().toISOString(),
            status: 'pending',
            payload: {
                description: 'Too broad pattern',
                pattern: '...',
                recurrence_count: 1,
            },
        }, null, 2));

        const guardedImprover = await HarnessImprover({ worktree: testDir }, { harness: { ack_guard_enabled: true } });
        const guardedEvent = guardedImprover.event as (input: { event: { type: string; properties?: Record<string, unknown> } }) => Promise<void>;
        await guardedEvent({ event: { type: 'session.idle', properties: { sessionID: 'sess-guarded' } } });

        assert(existsSync(validAckFile), 'valid signal moved to written ack path');
        assert(existsSync(invalidAckFile), 'invalid signal still moved to written ack path');
        const ackRecords = readJsonl(ackStatusPath);
        assert(ackRecords.some((record) => record.signal_id === 'step5a-valid' && record.state === 'written'), 'written ack recorded for valid signal');
        assert(ackRecords.some((record) => record.signal_id === 'step5a-valid' && record.state === 'accepted'), 'accepted ack recorded when guard passes');
        assert(ackRecords.some((record) => record.signal_id === 'step5a-invalid' && record.state === 'written' && record.accepted === false), 'invalid signal stays in written state under guard');
        assert(!ackRecords.some((record) => record.signal_id === 'step5a-invalid' && record.state === 'accepted'), 'invalid signal is not promoted to accepted');

        console.log('\n[3] guard disabled preserves written-only flow');
        writeFileSync(defaultSignalFile, JSON.stringify({
            id: 'step5a-default',
            type: 'error_repeat',
            project_key: projectKey,
            timestamp: new Date().toISOString(),
            status: 'pending',
            payload: {
                description: 'Another repeated boom error',
                pattern: 'TypeError: another boom',
                recurrence_count: 3,
            },
        }, null, 2));

        const defaultImprover = await HarnessImprover({ worktree: testDir });
        const defaultEvent = defaultImprover.event as (input: { event: { type: string; properties?: Record<string, unknown> } }) => Promise<void>;
        await defaultEvent({ event: { type: 'session.idle', properties: { sessionID: 'sess-default' } } });

        const ackRecordsAfterDefault = readJsonl(ackStatusPath);
        assert(existsSync(defaultAckFile), 'default path still writes ack file');
        assert(ackRecordsAfterDefault.some((record) => record.signal_id === 'step5a-default' && record.state === 'written' && record.guard_enabled === false), 'guard disabled keeps written ack only');
        assert(!ackRecordsAfterDefault.some((record) => record.signal_id === 'step5a-default' && record.state === 'accepted'), 'guard disabled does not create accepted ack');

        console.log('\n[4] diff mistake summaries stay append-only shadow logs');
        appendMistakeSummaryShadow(projectKey, 'abcdef1', 'fix: trim shadow noise', ['src/example.ts'], [
            'diff --git a/src/example.ts b/src/example.ts',
            '--- a/src/example.ts',
            '+++ b/src/example.ts',
            '@@',
            '-const noisy = true;',
            '+const noisy = false;',
        ].join('\n'));
        appendMistakeSummaryShadow(projectKey, 'abcdef1', 'fix: trim shadow noise', ['src/example.ts'], [
            'diff --git a/src/example.ts b/src/example.ts',
            '--- a/src/example.ts',
            '+++ b/src/example.ts',
            '@@',
            '-const noisy = true;',
            '+const noisy = false;',
        ].join('\n'));
        const mistakeRecords = readJsonl(mistakePath);
        const latestMistake = mistakeRecords[mistakeRecords.length - 1];
        assert(mistakeRecords.filter((record) => record.commit_hash === 'abcdef1').length === 1, 'same fix commit hash is deduped across repeated shadow runs');
        assert(latestMistake.mistake_summary === 'Fix diff shadow: fix: trim shadow noise; files=src/example.ts; added_lines=1; removed_lines=1', 'mistake summary redacts raw diff text');
        assert(latestMistake.ambiguous === false, 'compact diff remains a non-ambiguous shadow summary');

        console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
    } finally {
        rmSync(testDir, { recursive: true, force: true });
        rmSync(projectHarnessDir, { recursive: true, force: true });
        removeProjectSignals(pendingDir, projectKey);
        removeProjectSignals(ackDir, projectKey);
        rmSync(validSignalFile, { force: true });
        rmSync(invalidSignalFile, { force: true });
        rmSync(defaultSignalFile, { force: true });
        rmSync(validAckFile, { force: true });
        rmSync(invalidAckFile, { force: true });
        rmSync(defaultAckFile, { force: true });
    }

    process.exit(failed > 0 ? 1 : 0);
}

void main().catch((err) => {
    console.error(err);
    process.exit(1);
});
