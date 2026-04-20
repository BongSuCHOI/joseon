// src/orchestrator/orchestrator.ts — Plugin 4: 오케스트레이션 통제
// QA 추적, agent_id 주입을 통합하는 플러그인 진입점
import { ensureHarnessDirs, getProjectKey } from '../shared/index.js';
import { trackQAFailure } from './qa-tracker.js';
import type { HarnessConfig } from '../config/index.js';

// --- Test failure detection patterns (jest, vitest, pytest, go test, etc.) ---
const FAIL_PATTERNS = [
    /FAIL\s+\d+ test/i,
    /(\d+)\s+failed/i,
    /Tests:\s*\d+\s+failed/i,
    /FAILED\s*\(/i,
    /--- FAIL/i,
];

// --- Scenario ID extraction patterns ---
const SCENARIO_PATTERNS = [
    // jest/vitest describe/it block: "✕ should do X" or "✗ should do X" or "× should do X"
    /[✕✗×]\s+(.+)/,
    // FAIL block header: "FAIL src/path/to/test.ts - suite name"
    /FAIL\s+(.+\.test\.\w+)/,
    // pytest: "FAILED test_file.py::TestClass::test_method"
    /FAILED\s+([\w./:]+)/,
    // go test: "--- FAIL: TestName"
    /--- FAIL:\s+(\S+)/,
    // Generic file path from test output
    /((?:src|test|tests|lib)\/[^\s:]+\.test\.\w+)/,
];

/**
 * Extract a meaningful scenario identifier from test output.
 * Falls back to a hash of the first non-empty failure line.
 */
function extractScenarioId(output: string): string | null {
    // Try pattern-based extraction first
    for (const pattern of SCENARIO_PATTERNS) {
        const match = pattern.exec(output);
        if (match?.[1]) {
            return match[1].trim().slice(0, 120);
        }
    }

    // Fallback: hash of first non-empty line that looks like a failure
    const lines = output.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0 && (trimmed.includes('fail') || trimmed.includes('FAIL') || trimmed.includes('Error'))) {
            // Simple hash from string
            let hash = 0;
            for (let i = 0; i < trimmed.length; i++) {
                const ch = trimmed.charCodeAt(i);
                hash = ((hash << 5) - hash + ch) | 0;
            }
            return `failure_${Math.abs(hash).toString(36)}`;
        }
    }

    return null;
}

export const HarnessOrchestrator = async (
    ctx: { worktree: string; config?: HarnessConfig; sessionAgents?: Map<string, string> },
) => {
    ensureHarnessDirs();
    const projectKey = getProjectKey(ctx.worktree);

    // Pending QA escalation injection queue
    let pendingQAEscalation: { scenarioId: string; count: number; verdict: string } | null = null;

    return {
        // Detect test failures from bash tool output
        'tool.execute.after': async (input: { tool?: string; output?: string }, _output: unknown) => {
            if (input.tool !== 'bash' || !input.output) return;

            const output = typeof input.output === 'string' ? input.output : '';

            const scenarioId = extractScenarioId(output);
            if (!scenarioId) return;

            const isFailure = FAIL_PATTERNS.some(p => p.test(output));
            if (!isFailure) return;

            const verdict = trackQAFailure(projectKey, scenarioId, output.slice(0, 200), ctx.config?.harness);
            pendingQAEscalation = { scenarioId, count: verdict.count, verdict: verdict.verdict };
        },

        // Inject QA escalation guidance into system prompt
        'experimental.chat.system.transform': async (_input: unknown, output: { system: string[] }) => {
            if (!pendingQAEscalation) return;
            const { scenarioId, count, verdict } = pendingQAEscalation;
            pendingQAEscalation = null;

            if (verdict === 'escalate') {
                output.system.push(
                    `[HARNESS QA ESCALATION] Scenario "${scenarioId}" has failed ${count} times. ESCALATE TO USER. Do not retry. Present the failure details and ask for guidance.`,
                );
            } else {
                output.system.push(
                    `[HARNESS QA TRACKER] Scenario "${scenarioId}" has failed ${count} time(s). Retry with a fix. If this reaches the escalation threshold, you must escalate to the user.`,
                );
            }
        },

        // Event hook: agent_id is tagged via sessionAgents map passed to observer.
        // This hook is reserved for orchestrator-level event tracking if needed.
        'event': async (_input: unknown) => {
            // Placeholder: sessionAgents is passed through context for observer to use
        },
    };
};
