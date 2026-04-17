// src/__tests__/unit-step5c-rule-lifecycle.ts — focused Step 5c unit-style coverage
// 실행: ./node_modules/.bin/tsx src/__tests__/unit-step5c-rule-lifecycle.ts

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { tmpdir } from 'os';

import type { Rule } from '../types.js';
import { HarnessImprover } from '../harness/improver.js';
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

function readJsonl<T>(filePath: string): T[] {
    if (!existsSync(filePath)) return [];
    return readFileSync(filePath, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as T);
}

function rewriteJsonlExcept(filePath: string, keep: (record: Record<string, unknown>) => boolean): void {
    if (!existsSync(filePath)) return;

    const records = readJsonl<Record<string, unknown>>(filePath).filter(keep);
    if (records.length === 0) {
        rmSync(filePath, { force: true });
        return;
    }

    writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
}

function writeRule(rule: Rule): void {
    const rulePath = join(HARNESS_DIR, rule.type === 'soft' ? 'rules/soft' : 'rules/hard', `${rule.id}.json`);
    writeFileSync(rulePath, JSON.stringify(rule, null, 2));
}

function cleanupRuleFiles(ruleIds: string[]): void {
    for (const ruleId of ruleIds) {
        rmSync(join(HARNESS_DIR, 'rules/soft', `${ruleId}.json`), { force: true });
        rmSync(join(HARNESS_DIR, 'rules/hard', `${ruleId}.json`), { force: true });
    }
}

async function runIdle(worktree: string): Promise<void> {
    const improver = await HarnessImprover(
        { worktree },
        {
            harness: {
                prune_guard_enabled: true,
                cross_project_promotion_guard_enabled: true,
            },
        },
    );

    const event = improver.event as (input: { event: { type: string; properties?: Record<string, unknown> } }) => Promise<void>;
    await event({ event: { type: 'session.idle', properties: { sessionID: `idle-${basename(worktree)}` } } });
}

async function main(): Promise<void> {
    const worktreeA = join(tmpdir(), `step5c-unit-a-${Date.now()}`);
    const worktreeB = join(tmpdir(), `step5c-unit-b-${Date.now()}`);
    mkdirSync(worktreeA, { recursive: true });
    mkdirSync(worktreeB, { recursive: true });

    const projectKeyA = getProjectKey(worktreeA);
    const projectKeyB = getProjectKey(worktreeB);
    const projectDirA = join(HARNESS_DIR, 'projects', projectKeyA);
    const projectDirB = join(HARNESS_DIR, 'projects', projectKeyB);
    const prunePathA = join(projectDirA, 'rule-prune-candidates.jsonl');
    const prunePathB = join(projectDirB, 'rule-prune-candidates.jsonl');
    const globalCandidatePath = join(HARNESS_DIR, 'projects', 'global', 'cross-project-promotion-candidates.jsonl');

    const oldCreatedAt = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const recentCreatedAt = new Date().toISOString();
    const sharedMatch = `step5c-shared-${Date.now()}`;
    const promptMatch = `step5c-prompt-${Date.now()}`;
    const recentMatch = `step5c-recent-${Date.now()}`;
    const hardMatch = `step5c-hard-${Date.now()}`;
    const violatedMatch = `step5c-violated-${Date.now()}`;

    const eligibleRuleA: Rule = {
        id: `step5c-eligible-a-${projectKeyA}`,
        type: 'soft',
        project_key: projectKeyA,
        created_at: oldCreatedAt,
        source_signal_id: `signal-eligible-a-${projectKeyA}`,
        pattern: { type: 'code', match: sharedMatch, scope: 'file' },
        description: 'Eligible prune candidate',
        violation_count: 0,
    };

    const eligibleRuleB: Rule = {
        id: `step5c-eligible-b-${projectKeyB}`,
        type: 'soft',
        project_key: projectKeyB,
        created_at: oldCreatedAt,
        source_signal_id: `signal-eligible-b-${projectKeyB}`,
        pattern: { type: 'code', match: sharedMatch, scope: 'file' },
        description: 'Cross-project eligible candidate',
        violation_count: 0,
    };

    const promptRule: Rule = {
        id: `step5c-prompt-${projectKeyA}`,
        type: 'soft',
        project_key: projectKeyA,
        created_at: oldCreatedAt,
        source_signal_id: `signal-prompt-${projectKeyA}`,
        pattern: { type: 'behavior', match: promptMatch, scope: 'prompt' },
        description: 'Prompt scope stays protected',
        violation_count: 0,
    };

    const recentRule: Rule = {
        id: `step5c-recent-${projectKeyA}`,
        type: 'soft',
        project_key: projectKeyA,
        created_at: recentCreatedAt,
        source_signal_id: `signal-recent-${projectKeyA}`,
        pattern: { type: 'code', match: recentMatch, scope: 'file' },
        description: 'Recent rule is not stale enough',
        violation_count: 0,
    };

    const hardRule: Rule = {
        id: `step5c-hard-${projectKeyA}`,
        type: 'hard',
        project_key: projectKeyA,
        created_at: oldCreatedAt,
        source_signal_id: `signal-hard-${projectKeyA}`,
        pattern: { type: 'code', match: hardMatch, scope: 'file' },
        description: 'Hard rule is outside prune scan',
        violation_count: 0,
    };

    const violatedRule: Rule = {
        id: `step5c-violated-${projectKeyA}`,
        type: 'soft',
        project_key: projectKeyA,
        created_at: oldCreatedAt,
        source_signal_id: `signal-violated-${projectKeyA}`,
        pattern: { type: 'code', match: violatedMatch, scope: 'file' },
        description: 'Violated rule is not eligible',
        violation_count: 1,
    };

    const sameMatchDifferentScope: Rule = {
        id: `step5c-different-${projectKeyB}`,
        type: 'soft',
        project_key: projectKeyB,
        created_at: oldCreatedAt,
        source_signal_id: `signal-different-${projectKeyB}`,
        pattern: { type: 'behavior', match: sharedMatch, scope: 'prompt' },
        description: 'Same match but different key stays local',
        violation_count: 0,
    };

    const ruleIds = [
        eligibleRuleA.id,
        eligibleRuleB.id,
        promptRule.id,
        recentRule.id,
        hardRule.id,
        violatedRule.id,
        sameMatchDifferentScope.id,
    ];

    try {
        console.log('\n=== Step 5c Rule Lifecycle Unit Tests ===\n');

        mkdirSync(join(HARNESS_DIR, 'rules/soft'), { recursive: true });
        mkdirSync(join(HARNESS_DIR, 'rules/hard'), { recursive: true });
        mkdirSync(projectDirA, { recursive: true });
        mkdirSync(projectDirB, { recursive: true });

        cleanupRuleFiles(ruleIds);
        rewriteJsonlExcept(prunePathA, (record) => !ruleIds.includes(String(record.rule_id)));
        rewriteJsonlExcept(prunePathB, (record) => !ruleIds.includes(String(record.rule_id)));
        rewriteJsonlExcept(globalCandidatePath, (record) =>
            record.candidate_key !== `soft::code::file::${sharedMatch}` &&
            record.candidate_key !== `soft::behavior::prompt::${sharedMatch}`,
        );

        writeRule(eligibleRuleA);
        writeRule(eligibleRuleB);
        writeRule(promptRule);
        writeRule(recentRule);
        writeRule(hardRule);
        writeRule(violatedRule);
        writeRule(sameMatchDifferentScope);

        await runIdle(worktreeA);
        await runIdle(worktreeB);

        const eligibleAAfter = JSON.parse(readFileSync(join(HARNESS_DIR, 'rules/soft', `${eligibleRuleA.id}.json`), 'utf-8')) as Rule;
        const eligibleBAfter = JSON.parse(readFileSync(join(HARNESS_DIR, 'rules/soft', `${eligibleRuleB.id}.json`), 'utf-8')) as Rule;
        const promptAfter = JSON.parse(readFileSync(join(HARNESS_DIR, 'rules/soft', `${promptRule.id}.json`), 'utf-8')) as Rule;
        const recentAfter = JSON.parse(readFileSync(join(HARNESS_DIR, 'rules/soft', `${recentRule.id}.json`), 'utf-8')) as Rule;
        const violatedAfter = JSON.parse(readFileSync(join(HARNESS_DIR, 'rules/soft', `${violatedRule.id}.json`), 'utf-8')) as Rule;
        const hardAfter = JSON.parse(readFileSync(join(HARNESS_DIR, 'rules/hard', `${hardRule.id}.json`), 'utf-8')) as Rule;

        assert(eligibleAAfter.prune_candidate?.reason === 'stale_unused_rule', 'eligible old local SOFT rule is marked');
        assert(eligibleAAfter.prune_candidate?.guard_enabled === true, 'eligible prune candidate observes guard_enabled true');
        assert(eligibleBAfter.prune_candidate?.reason === 'stale_unused_rule', 'cross-project eligible rule is marked too');
        assert(promptAfter.prune_candidate === undefined, 'prompt scope is excluded from pruning');
        assert(recentAfter.prune_candidate === undefined, 'recent rule is excluded from pruning');
        assert(violatedAfter.prune_candidate === undefined, 'violated rule is excluded from pruning');
        assert(hardAfter.prune_candidate === undefined, 'hard rule is excluded from pruning');

        const globalCandidates = readJsonl<Record<string, unknown>>(globalCandidatePath);
        const sharedCandidate = globalCandidates.find((record) => record.candidate_key === `soft::code::file::${sharedMatch}`);
        const differentCandidate = globalCandidates.find((record) => record.candidate_key === `soft::behavior::prompt::${sharedMatch}`);

        assert(Boolean(sharedCandidate), 'cross-project exact-match candidate is recorded');
        assert((sharedCandidate?.guard_enabled as boolean) === true, 'cross-project candidate observes guard_enabled true');
        assert((sharedCandidate?.occurrence_count as number) === 2, 'same type/scope/match across two projects is aggregated');
        assert(Array.isArray(sharedCandidate?.project_keys) && (sharedCandidate?.project_keys as string[]).includes(projectKeyA) && (sharedCandidate?.project_keys as string[]).includes(projectKeyB), 'candidate stores both project keys');
        assert(!differentCandidate, 'differing scope/type is not grouped');

        const softRules = readdirSync(join(HARNESS_DIR, 'rules/soft'))
            .filter((file) => file.endsWith('.json'))
            .map((file) => JSON.parse(readFileSync(join(HARNESS_DIR, 'rules/soft', file), 'utf-8')) as Rule);
        const hardRules = readdirSync(join(HARNESS_DIR, 'rules/hard'))
            .filter((file) => file.endsWith('.json'))
            .map((file) => JSON.parse(readFileSync(join(HARNESS_DIR, 'rules/hard', file), 'utf-8')) as Rule);

        assert(!softRules.some((rule) => rule.project_key === 'global' && rule.pattern.match === sharedMatch), 'no automatic global soft rule is created');
        assert(!hardRules.some((rule) => rule.project_key === 'global' && rule.pattern.match === sharedMatch), 'no automatic global hard rule is created');

        console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
    } finally {
        rmSync(worktreeA, { recursive: true, force: true });
        rmSync(worktreeB, { recursive: true, force: true });
        rmSync(projectDirA, { recursive: true, force: true });
        rmSync(projectDirB, { recursive: true, force: true });
        cleanupRuleFiles(ruleIds);
        rewriteJsonlExcept(prunePathA, (record) => !ruleIds.includes(String(record.rule_id)));
        rewriteJsonlExcept(prunePathB, (record) => !ruleIds.includes(String(record.rule_id)));
        rewriteJsonlExcept(globalCandidatePath, (record) =>
            record.candidate_key !== `soft::code::file::${sharedMatch}` &&
            record.candidate_key !== `soft::behavior::prompt::${sharedMatch}`,
        );
    }

    process.exit(failed > 0 ? 1 : 0);
}

void main().catch((err) => {
    console.error(err);
    process.exit(1);
});
