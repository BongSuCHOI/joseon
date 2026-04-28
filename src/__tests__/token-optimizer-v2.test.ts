// src/__tests__/token-optimizer-v2.test.ts — Token Optimizer v0 tests (design §12)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

async function createEnforcer(config?: Record<string, unknown>) {
    const { HarnessEnforcer } = await import('../harness/enforcer.js');
    return HarnessEnforcer({ worktree: '/test/project' }, { harness: { token_optimizer_enabled: true, ...config } });
}

async function createObserver(config?: Record<string, unknown>) {
    const { HarnessObserver } = await import('../harness/observer.js');
    return HarnessObserver({ worktree: '/test/project', config: { harness: { token_optimizer_enabled: true, ...config } } });
}

async function createImprover(config?: Record<string, unknown>) {
    const { HarnessImprover } = await import('../harness/improver.js');
    return HarnessImprover({ worktree: '/test/project' }, { harness: { token_optimizer_enabled: true, ...config } });
}

// ─── Test Suite ──────────────────────────────────────────

describe('Token Optimizer v2', () => {

    beforeEach(() => {
        tempHarnessDir = join(tmpdir(), `harness-test-v2-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        mkdirSync(tempHarnessDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(tempHarnessDir, { recursive: true, force: true });
    });

    // ─── pre_tool_guard (enforcer) ──────────────────────

    describe('pre_tool_guard', () => {
        // Test 1: cat huge.log blocked
        it('blocks "cat huge.log" with alternative suggestion', async () => {
            const enforcer = await createEnforcer();
            await expect(
                enforcer['tool.execute.before'](
                    { tool: 'bash', sessionID: 's1', callID: 'c1' },
                    { args: { command: 'cat huge.log' } },
                ),
            ).rejects.toThrow('[TOKEN GUARD]');
            await expect(
                enforcer['tool.execute.before'](
                    { tool: 'bash', sessionID: 's1', callID: 'c1' },
                    { args: { command: 'cat huge.log' } },
                ),
            ).rejects.toThrow('tail -200');
        });

        // Test 2: cat -n huge.log blocked (flags included)
        it('blocks "cat -n huge.log" (flags included)', async () => {
            const enforcer = await createEnforcer();
            await expect(
                enforcer['tool.execute.before'](
                    { tool: 'bash', sessionID: 's1', callID: 'c1' },
                    { args: { command: 'cat -n huge.log' } },
                ),
            ).rejects.toThrow('[TOKEN GUARD]');
        });

        // Test 3: tail -200 huge.log passes
        it('passes "tail -200 huge.log" (safe command)', async () => {
            const enforcer = await createEnforcer();
            await expect(
                enforcer['tool.execute.before'](
                    { tool: 'bash', sessionID: 's1', callID: 'c1' },
                    { args: { command: 'tail -200 huge.log' } },
                ),
            ).resolves.toBeUndefined();
        });

        // Test 4: git log first call passes (session-scoped)
        it('passes first "git log" in session', async () => {
            const enforcer = await createEnforcer();
            await expect(
                enforcer['tool.execute.before'](
                    { tool: 'bash', sessionID: 'git-test-1', callID: 'c1' },
                    { args: { command: 'git log' } },
                ),
            ).resolves.toBeUndefined();
        });

        // Test 5: git log second call blocked
        it('blocks second "git log" in same session', async () => {
            const enforcer = await createEnforcer();
            // First call passes
            await enforcer['tool.execute.before'](
                { tool: 'bash', sessionID: 'git-test-2', callID: 'c1' },
                { args: { command: 'git log' } },
            );
            // Second call blocked (same enforcer instance, same sessionID)
            await expect(
                enforcer['tool.execute.before'](
                    { tool: 'bash', sessionID: 'git-test-2', callID: 'c2' },
                    { args: { command: 'git log' } },
                ),
            ).rejects.toThrow('[TOKEN GUARD]');
        });

        // Test 6: npm test NOT blocked in v0
        it('passes "npm test" (not blocked in v0)', async () => {
            const enforcer = await createEnforcer();
            await expect(
                enforcer['tool.execute.before'](
                    { tool: 'bash', sessionID: 's1', callID: 'c1' },
                    { args: { command: 'npm test' } },
                ),
            ).resolves.toBeUndefined();
        });

        // Test 7: docker logs without --tail blocked
        it('blocks "docker logs app" (no --tail)', async () => {
            const enforcer = await createEnforcer();
            await expect(
                enforcer['tool.execute.before'](
                    { tool: 'bash', sessionID: 's1', callID: 'c1' },
                    { args: { command: 'docker logs app' } },
                ),
            ).rejects.toThrow('[TOKEN GUARD]');
        });

        // Test 8: docker logs --tail 200 app passes
        it('passes "docker logs --tail 200 app"', async () => {
            const enforcer = await createEnforcer();
            await expect(
                enforcer['tool.execute.before'](
                    { tool: 'bash', sessionID: 's1', callID: 'c1' },
                    { args: { command: 'docker logs --tail 200 app' } },
                ),
            ).resolves.toBeUndefined();
        });
    });

    // ─── loop_budget (observer) ─────────────────────────

    describe('loop_budget', () => {
        // Test 9: search 20 calls pass, 21st blocked
        it('passes 20 search calls, blocks 21st', async () => {
            const observer = await createObserver();

            // 20 search calls should pass
            for (let i = 0; i < 20; i++) {
                await observer['tool.execute.before'](
                    { tool: 'bash', sessionID: 's1', callID: `c${i}` },
                    { args: { command: `rg "pattern" file${i}.ts` } },
                );
            }

            // 21st search call should be blocked
            await expect(
                observer['tool.execute.before'](
                    { tool: 'bash', sessionID: 's1', callID: 'c21' },
                    { args: { command: 'rg "pattern" another.ts' } },
                ),
            ).rejects.toThrow('[LOOP BUDGET]');
        });

        // Test 10: search exhausted but read still passes
        it('allows read calls even after search budget exhausted', async () => {
            const observer = await createObserver();

            // Exhaust search budget
            for (let i = 0; i < 20; i++) {
                await observer['tool.execute.before'](
                    { tool: 'bash', sessionID: 's1', callID: `c${i}` },
                    { args: { command: `rg "pattern" file${i}.ts` } },
                );
            }

            // Read call should still pass
            await expect(
                observer['tool.execute.before'](
                    { tool: 'read', sessionID: 's1', callID: 'r1' },
                    { args: { filePath: '/test/file.ts' } },
                ),
            ).resolves.toBeUndefined();
        });

        // Test 11: blocked calls do not consume budget
        it('does not count blocked pre_tool_guard calls toward budget', async () => {
            const observer = await createObserver();
            const enforcer = await createEnforcer();

            // Block a cat call via pre_tool_guard (enforcer)
            await expect(
                enforcer['tool.execute.before'](
                    { tool: 'bash', sessionID: 's1', callID: 'c1' },
                    { args: { command: 'cat bigfile.log' } },
                ),
            ).rejects.toThrow('[TOKEN GUARD]');

            // The observer budget for 'read' category should still be 0
            // (cat would classify as 'read' but was blocked before execution)
            // So 30 read calls should still work
            for (let i = 0; i < 30; i++) {
                await observer['tool.execute.before'](
                    { tool: 'read', sessionID: 's1', callID: `r${i}` },
                    { args: { filePath: `/test/file${i}.ts` } },
                );
            }
        });

        // Test 12: session.created resets budget maps
        it('resets budget on session.created', async () => {
            const observer = await createObserver();

            // Exhaust search budget
            for (let i = 0; i < 20; i++) {
                await observer['tool.execute.before'](
                    { tool: 'bash', sessionID: 's-reset-test', callID: `c${i}` },
                    { args: { command: `rg "pattern" file${i}.ts` } },
                );
            }

            // Ensure all possible project dirs exist for session lock
            mkdirSync(join(tempHarnessDir, 'projects', 'unknown'), { recursive: true });
            mkdirSync(join(tempHarnessDir, 'projects', 'test-project'), { recursive: true });
            mkdirSync(join(tempHarnessDir, 'logs', 'sessions'), { recursive: true });

            // New session should reset
            await observer.event({ event: { type: 'session.created', properties: { sessionID: 's-reset-test' } } });

            // Search should work again in same session
            await expect(
                observer['tool.execute.before'](
                    { tool: 'bash', sessionID: 's-reset-test', callID: 'c-new' },
                    { args: { command: 'rg "pattern" new.ts' } },
                ),
            ).resolves.toBeUndefined();
        });
    });

    // ─── file_deduper (observer) ────────────────────────

    describe('file_deduper', () => {
        // Test 13: same file unchanged — 3 passes, 4th blocked
        it('passes 3 reads of unchanged file, blocks 4th', async () => {
            const observer = await createObserver();
            const testDir = join(tmpdir(), `deduper-test-${Date.now()}`);
            const filePath = join(testDir, 'unchanged.txt');

            mkdirSync(testDir, { recursive: true });
            writeFileSync(filePath, 'content');

            // 3 reads should pass
            for (let i = 0; i < 3; i++) {
                await observer['tool.execute.before'](
                    { tool: 'read', sessionID: 's1', callID: `c${i}` },
                    { args: { filePath } },
                );
            }

            // 4th read should be blocked
            await expect(
                observer['tool.execute.before'](
                    { tool: 'read', sessionID: 's1', callID: 'c4' },
                    { args: { filePath } },
                ),
            ).rejects.toThrow('[FILE DEDUPER]');
        });

        // Test 14: file modified after threshold → allowed
        it('allows read after file is modified following initial block', async () => {
            const observer = await createObserver();
            const testDir = join(tmpdir(), `deduper-mutable-${Date.now()}`);
            const filePath = join(testDir, 'mutable.txt');

            mkdirSync(testDir, { recursive: true });
            writeFileSync(filePath, 'original');

            // 3 reads pass (below threshold)
            for (let i = 0; i < 3; i++) {
                await observer['tool.execute.before'](
                    { tool: 'read', sessionID: 's1', callID: `c${i}` },
                    { args: { filePath } },
                );
            }

            // 4th read: threshold reached, first fingerprint captured, blocked
            await expect(
                observer['tool.execute.before'](
                    { tool: 'read', sessionID: 's1', callID: 'c4' },
                    { args: { filePath } },
                ),
            ).rejects.toThrow('[FILE DEDUPER]');

            // Modify file with significantly different content to change both mtime and size
            const newContent = 'x'.repeat(1000);
            writeFileSync(filePath, newContent);

            // 5th read should pass (file changed → fingerprint differs)
            await expect(
                observer['tool.execute.before'](
                    { tool: 'read', sessionID: 's1', callID: 'c5' },
                    { args: { filePath } },
                ),
            ).resolves.toBeUndefined();
        });

        // Test 15: no stat call below threshold (performance)
        it('does not call stat below threshold', async () => {
            const observer = await createObserver();

            // Even with nonexistent file, below-threshold reads pass (no stat)
            for (let i = 0; i < 3; i++) {
                await expect(
                    observer['tool.execute.before'](
                        { tool: 'read', sessionID: 's1', callID: `c${i}` },
                        { args: { filePath: `/nonexistent/file${i}.ts` } },
                    ),
                ).resolves.toBeUndefined();
            }
        });
    });

    // ─── compact_override (improver) ────────────────────

    describe('compact_override', () => {
        // Test 16: prompt overridden when enabled
        it('overrides output.prompt with custom compaction prompt', async () => {
            const improver = await createImprover();
            type CompactingOutput = { context: string[]; prompt?: string };
            const output: CompactingOutput = { context: [] };

            const compactingHook = (improver as Record<string, (_input: unknown, output: CompactingOutput) => Promise<void>>)['experimental.session.compacting'];
            await compactingHook({}, output);

            expect(output.prompt).toBeDefined();
            expect(output.prompt).toContain('Compaction Directive');
            expect(output.prompt).toContain('보존 최우선순위');
        });

        // Test 17: prompt NOT overridden when compact_override disabled
        it('does not override prompt when compact_override disabled', async () => {
            const improver = await createImprover({ compact_override_enabled: false });
            type CompactingOutput = { context: string[]; prompt?: string };
            const output: CompactingOutput = { context: [] };

            const compactingHook = (improver as Record<string, (_input: unknown, output: CompactingOutput) => Promise<void>>)['experimental.session.compacting'];
            await compactingHook({}, output);

            expect(output.prompt).toBeUndefined();
        });
    });

    // ─── master toggle ──────────────────────────────────

    describe('master toggle', () => {
        // Test 18: master toggle false disables everything
        it('disables all features when token_optimizer_enabled is false', async () => {
            const enforcer = await createEnforcer({ token_optimizer_enabled: false });
            const observer = await createObserver({ token_optimizer_enabled: false });

            // cat should pass (pre_tool_guard disabled)
            await expect(
                enforcer['tool.execute.before'](
                    { tool: 'bash', sessionID: 's1', callID: 'c1' },
                    { args: { command: 'cat huge.log' } },
                ),
            ).resolves.toBeUndefined();

            // loop_budget should pass (disabled)
            for (let i = 0; i < 25; i++) {
                await observer['tool.execute.before'](
                    { tool: 'bash', sessionID: 's1', callID: `c${i}` },
                    { args: { command: `rg "x" file${i}.ts` } },
                );
            }

            // file_deduper should pass (disabled)
            for (let i = 0; i < 5; i++) {
                await observer['tool.execute.before'](
                    { tool: 'read', sessionID: 's1', callID: `r${i}` },
                    { args: { filePath: '/test/same-file.ts' } },
                );
            }
        });
    });
});
