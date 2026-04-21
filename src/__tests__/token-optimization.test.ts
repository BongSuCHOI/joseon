// src/__tests__/token-optimization.test.ts — Tests for token-optimization-absorption change (7.1–7.7)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { MemoryFact } from '../types.js';

// ─── Mock HARNESS_DIR to use a temp directory ───────────
let tempHarnessDir: string;

vi.mock('../shared/index.js', async (importOriginal) => {
    const original = await importOriginal<typeof import('../shared/index.js')>();
    return {
        ...original,
        get HARNESS_DIR() { return tempHarnessDir; },
        ensureHarnessDirs: () => {
            const dirs = [
                'signals/pending', 'signals/ack', 'rules/soft', 'rules/hard',
                'memory/facts', 'memory/archive', 'logs/sessions', 'projects',
                'scaffold', 'shadow', 'metrics/effectiveness', 'logs/tools', 'logs/errors',
            ];
            for (const dir of dirs) {
                mkdirSync(join(tempHarnessDir, dir), { recursive: true });
            }
        },
    };
});

// ─── Helpers ─────────────────────────────────────────────

function countSignalsOfType(type: string): number {
    const pendingDir = join(tempHarnessDir, 'signals/pending');
    if (!existsSync(pendingDir)) return 0;
    let count = 0;
    for (const file of readdirSync(pendingDir)) {
        if (!file.endsWith('.json')) continue;
        try {
            const signal = JSON.parse(readFileSync(join(pendingDir, file), 'utf-8'));
            if (signal.type === type) count++;
        } catch { /* skip malformed */ }
    }
    return count;
}

async function createObserver() {
    const { HarnessObserver } = await import('../harness/observer.js');
    return HarnessObserver({ worktree: '/test/project' });
}

// ─── Test Suite ──────────────────────────────────────────

describe('token-optimization-absorption', () => {

    beforeEach(() => {
        tempHarnessDir = join(tmpdir(), `harness-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        mkdirSync(tempHarnessDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(tempHarnessDir, { recursive: true, force: true });
    });

    // ─── Test 7.1 — tool_loop ──────────────────────────────
    describe('7.1 tool_loop detection', () => {
        it('emits tool_loop signal when same tool+args called 5 times', async () => {
            const observer = await createObserver();
            const args = { filePath: '/test/file.ts' };

            // Call 4 times — should NOT emit
            for (let i = 0; i < 4; i++) {
                await observer['tool.execute.after']({ tool: 'Read', sessionID: 's1', callID: `c${i}`, args });
            }
            expect(countSignalsOfType('tool_loop')).toBe(0);

            // 5th call — should emit
            await observer['tool.execute.after']({ tool: 'Read', sessionID: 's1', callID: 'c5', args });
            expect(countSignalsOfType('tool_loop')).toBe(1);
        });

        it('does NOT emit tool_loop when different args are used', async () => {
            const observer = await createObserver();

            // 5 calls with different args — should NOT emit
            for (let i = 0; i < 5; i++) {
                await observer['tool.execute.after']({ tool: 'Read', sessionID: 's1', callID: `c${i}`, args: { filePath: `/test/file${i}.ts` } });
            }
            expect(countSignalsOfType('tool_loop')).toBe(0);
        });
    });

    // ─── Test 7.2 — retry_storm ────────────────────────────
    describe('7.2 retry_storm detection', () => {
        it('emits retry_storm signal after 3 consecutive errors', async () => {
            const observer = await createObserver();

            // 2 error outputs — should NOT emit
            for (let i = 0; i < 2; i++) {
                await observer['tool.execute.after'](
                    { tool: 'Bash', sessionID: 's1', callID: `c${i}`, args: {} },
                    { output: 'Error: command failed' },
                );
            }
            expect(countSignalsOfType('retry_storm')).toBe(0);

            // 3rd error — should emit
            await observer['tool.execute.after'](
                { tool: 'Bash', sessionID: 's1', callID: 'c3', args: {} },
                { output: 'Error: command failed again' },
            );
            expect(countSignalsOfType('retry_storm')).toBe(1);
        });

        it('resets retry counter on successful output', async () => {
            const observer = await createObserver();

            // 2 errors
            for (let i = 0; i < 2; i++) {
                await observer['tool.execute.after'](
                    { tool: 'Bash', sessionID: 's1', callID: `c${i}`, args: {} },
                    { output: 'Error: failed' },
                );
            }

            // 1 success — resets counter
            await observer['tool.execute.after'](
                { tool: 'Bash', sessionID: 's1', callID: 'c3', args: {} },
                { output: 'success' },
            );

            // 2 more errors — should NOT emit (counter restarted)
            for (let i = 0; i < 2; i++) {
                await observer['tool.execute.after'](
                    { tool: 'Bash', sessionID: 's1', callID: `c${4 + i}`, args: {} },
                    { output: 'Error: failed' },
                );
            }
            expect(countSignalsOfType('retry_storm')).toBe(0);
        });
    });

    // ─── Test 7.3 — excessive_read ─────────────────────────
    describe('7.3 excessive_read detection', () => {
        it('emits excessive_read signal when same file read 4 times', async () => {
            const observer = await createObserver();
            const args = { filePath: '/test/same-file.ts' };

            // 3 reads — should NOT emit
            for (let i = 0; i < 3; i++) {
                await observer['tool.execute.after']({ tool: 'Read', sessionID: 's1', callID: `c${i}`, args });
            }
            expect(countSignalsOfType('excessive_read')).toBe(0);

            // 4th read — should emit
            await observer['tool.execute.after']({ tool: 'Read', sessionID: 's1', callID: 'c4', args });
            expect(countSignalsOfType('excessive_read')).toBe(1);
        });

        it('does not emit excessive_read for different files', async () => {
            const observer = await createObserver();

            // Read 4 different files — should NOT emit
            for (let i = 0; i < 4; i++) {
                await observer['tool.execute.after']({ tool: 'Read', sessionID: 's1', callID: `c${i}`, args: { filePath: `/test/file${i}.ts` } });
            }
            expect(countSignalsOfType('excessive_read')).toBe(0);
        });
    });

    // ─── Test 7.4 — mapSignalTypeToScope ───────────────────
    describe('7.4 mapSignalTypeToScope — new signals map to tool scope', () => {
        it('maps tool_loop to tool scope', async () => {
            const { mapSignalTypeToScope } = await import('../harness/improver.js');
            expect(mapSignalTypeToScope('tool_loop')).toBe('tool');
        });
        it('maps retry_storm to tool scope', async () => {
            const { mapSignalTypeToScope } = await import('../harness/improver.js');
            expect(mapSignalTypeToScope('retry_storm')).toBe('tool');
        });
        it('maps excessive_read to tool scope', async () => {
            const { mapSignalTypeToScope } = await import('../harness/improver.js');
            expect(mapSignalTypeToScope('excessive_read')).toBe('tool');
        });
    });

    // ─── Test 7.5 — Fact access tracking ──────────────────
    describe('7.5 trackFactAccess', () => {
        it('increments access_count and updates last_accessed_at', async () => {
            const { trackFactAccess } = await import('../harness/improver.js');

            const fact: MemoryFact = {
                id: 'test-fact-1',
                project_key: 'test',
                keywords: ['test'],
                content: 'test content for tracking',
                source_session: 'session1.jsonl',
                created_at: new Date().toISOString(),
            };

            // Write fact to temp harness dir
            const factsDir = join(tempHarnessDir, 'memory/facts');
            mkdirSync(factsDir, { recursive: true });
            writeFileSync(join(factsDir, `${fact.id}.json`), JSON.stringify(fact));

            const before = Date.now();
            trackFactAccess([fact]);

            const updated = JSON.parse(readFileSync(join(factsDir, `${fact.id}.json`), 'utf-8'));
            expect(updated.access_count).toBe(1);
            expect(updated.last_accessed_at).toBeGreaterThanOrEqual(before);
        });

        it('does not throw for facts not on disk', async () => {
            const { trackFactAccess } = await import('../harness/improver.js');
            const fact: MemoryFact = {
                id: 'nonexistent-fact',
                keywords: [],
                content: '',
                source_session: '',
                created_at: new Date().toISOString(),
            };
            // Should not throw
            expect(() => trackFactAccess([fact])).not.toThrow();
        });
    });

    // ─── Test 7.6 — TTL prune ─────────────────────────────
    describe('7.6 markFactPruneCandidates', () => {
        it('prunes facts with access_count=0 and age > TTL', async () => {
            const { markFactPruneCandidates } = await import('../harness/improver.js');

            const factsDir = join(tempHarnessDir, 'memory/facts');
            mkdirSync(factsDir, { recursive: true });

            // Create a fact that's 31 days old with access_count=0
            const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
            const oldFact: MemoryFact = {
                id: 'old-fact-1',
                project_key: 'test-project',
                keywords: ['old'],
                content: 'old content',
                source_session: 'session1.jsonl',
                created_at: oldDate,
                access_count: 0,
                last_accessed_at: Date.parse(oldDate),
            };
            writeFileSync(join(factsDir, `${oldFact.id}.json`), JSON.stringify(oldFact));

            markFactPruneCandidates('test-project', 30, 5);

            // Fact should be moved to archive
            expect(existsSync(join(factsDir, `${oldFact.id}.json`))).toBe(false);
            expect(existsSync(join(tempHarnessDir, 'memory/archive', `${oldFact.id}.json`))).toBe(true);
        });

        it('extends TTL for facts with access_count >= threshold', async () => {
            const { markFactPruneCandidates } = await import('../harness/improver.js');

            const factsDir = join(tempHarnessDir, 'memory/facts');
            mkdirSync(factsDir, { recursive: true });

            // Create a fact that's 35 days old with access_count=5 (should get 2x TTL = 60 days)
            const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
            const accessedFact: MemoryFact = {
                id: 'accessed-fact-1',
                project_key: 'test-project',
                keywords: ['accessed'],
                content: 'accessed content',
                source_session: 'session1.jsonl',
                created_at: oldDate,
                access_count: 5,
                last_accessed_at: Date.now(),
            };
            writeFileSync(join(factsDir, `${accessedFact.id}.json`), JSON.stringify(accessedFact));

            markFactPruneCandidates('test-project', 30, 5);

            // Fact should NOT be pruned (35 days < 60 days extended TTL)
            expect(existsSync(join(factsDir, `${accessedFact.id}.json`))).toBe(true);
        });
    });

    // ─── Test 7.7 — 3-layer progressive disclosure ────────
    describe('7.7 formatFactLayer — progressive disclosure', () => {
        const fact: MemoryFact = {
            id: 'abcdefgh12345678',
            keywords: ['typescript', 'interface'],
            content: 'Always use strict mode. It prevents common mistakes.',
            source_session: 'session1.jsonl',
            created_at: new Date().toISOString(),
        };

        it('Layer 1: id prefix + keywords only', async () => {
            const { formatFactLayer } = await import('../harness/improver.js');
            const result = formatFactLayer(fact, 1);
            expect(result).toContain('abcdefgh');
            expect(result).toContain('typescript, interface');
            expect(result).toContain('keywords:');
            expect(result).not.toContain('strict mode');
        });

        it('Layer 2: keywords + first sentence', async () => {
            const { formatFactLayer } = await import('../harness/improver.js');
            const result = formatFactLayer(fact, 2);
            expect(result).toContain('abcdefgh');
            expect(result).toContain('typescript, interface');
            expect(result).toContain('Always use strict mode');
        });

        it('Layer 3: full content with source session', async () => {
            const { formatFactLayer } = await import('../harness/improver.js');
            const result = formatFactLayer(fact, 3);
            expect(result).toContain('session1.jsonl');
            expect(result).toContain('Always use strict mode. It prevents common mistakes.');
            expect(result).toContain('typescript, interface');
        });
    });
});
