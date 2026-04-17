// src/__tests__/smoke-step5c-rule-lifecycle.ts — Step 5c rule lifecycle smoke test
// 실행: npx tsx src/__tests__/smoke-step5c-rule-lifecycle.ts

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
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
    const rulePath = join(HARNESS_DIR, 'rules/soft', `${rule.id}.json`);
    writeFileSync(rulePath, JSON.stringify(rule, null, 2));
}

function cleanupRuleFiles(ruleIds: string[]): void {
    for (const ruleId of ruleIds) {
        rmSync(join(HARNESS_DIR, 'rules/soft', `${ruleId}.json`), { force: true });
        rmSync(join(HARNESS_DIR, 'rules/hard', `${ruleId}.json`), { force: true });
    }
}

async function runProject(worktree: string): Promise<void> {
    const improver = await HarnessImprover({ worktree });
    const event = improver.event as (input: { event: { type: string; properties?: Record<string, unknown> } }) => Promise<void>;
    await event({ event: { type: 'session.idle', properties: { sessionID: `idle-${getProjectKey(worktree)}` } } });
}

async function main(): Promise<void> {
    const worktreeA = join(tmpdir(), `step5c-a-${Date.now()}`);
    const worktreeB = join(tmpdir(), `step5c-b-${Date.now()}`);
    mkdirSync(worktreeA, { recursive: true });
    mkdirSync(worktreeB, { recursive: true });

    const projectKeyA = getProjectKey(worktreeA);
    const projectKeyB = getProjectKey(worktreeB);
    const projectDirA = join(HARNESS_DIR, 'projects', projectKeyA);
    const projectDirB = join(HARNESS_DIR, 'projects', projectKeyB);
    const prunePathA = join(projectDirA, 'rule-prune-candidates.jsonl');
    const prunePathB = join(projectDirB, 'rule-prune-candidates.jsonl');
    const globalCandidatePath = join(HARNESS_DIR, 'projects', 'global', 'cross-project-promotion-candidates.jsonl');
    const sharedPattern = `step5c-shared-pattern-${Date.now()}`;
    const promptPattern = `step5c-prompt-pattern-${Date.now()}`;
    const oldCreatedAt = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();

    const eligibleRuleA: Rule = {
        id: `step5c-eligible-${projectKeyA}`,
        type: 'soft',
        project_key: projectKeyA,
        created_at: oldCreatedAt,
        source_signal_id: `signal-${projectKeyA}`,
        pattern: { type: 'code', match: sharedPattern, scope: 'file' },
        description: 'Old local rule candidate',
        violation_count: 0,
    };

    const promptRuleA: Rule = {
        id: `step5c-prompt-${projectKeyA}`,
        type: 'soft',
        project_key: projectKeyA,
        created_at: oldCreatedAt,
        source_signal_id: `signal-prompt-${projectKeyA}`,
        pattern: { type: 'behavior', match: promptPattern, scope: 'prompt' },
        description: 'Prompt scope stays protected',
        violation_count: 0,
    };

    const eligibleRuleB: Rule = {
        id: `step5c-eligible-${projectKeyB}`,
        type: 'soft',
        project_key: projectKeyB,
        created_at: oldCreatedAt,
        source_signal_id: `signal-${projectKeyB}`,
        pattern: { type: 'code', match: sharedPattern, scope: 'file' },
        description: 'Shared local rule candidate',
        violation_count: 0,
    };

    const ruleIds = [eligibleRuleA.id, promptRuleA.id, eligibleRuleB.id];

    try {
        console.log('\n=== Step 5c Rule Lifecycle Smoke Tests ===\n');

        mkdirSync(join(HARNESS_DIR, 'rules/soft'), { recursive: true });
        mkdirSync(join(HARNESS_DIR, 'rules/hard'), { recursive: true });
        mkdirSync(projectDirA, { recursive: true });
        mkdirSync(projectDirB, { recursive: true });

        cleanupRuleFiles(ruleIds);
        rewriteJsonlExcept(prunePathA, (record) => record.rule_id !== eligibleRuleA.id && record.rule_id !== promptRuleA.id);
        rewriteJsonlExcept(prunePathB, (record) => record.rule_id !== eligibleRuleB.id);
        rewriteJsonlExcept(globalCandidatePath, (record) => record.candidate_key !== `soft::code::file::${sharedPattern}`);

        writeRule(eligibleRuleA);
        writeRule(promptRuleA);
        writeRule(eligibleRuleB);

        await runProject(worktreeA);
        await runProject(worktreeB);

        const eligibleAAfter = JSON.parse(readFileSync(join(HARNESS_DIR, 'rules/soft', `${eligibleRuleA.id}.json`), 'utf-8')) as Rule;
        const promptAAfter = JSON.parse(readFileSync(join(HARNESS_DIR, 'rules/soft', `${promptRuleA.id}.json`), 'utf-8')) as Rule;
        const eligibleBAfter = JSON.parse(readFileSync(join(HARNESS_DIR, 'rules/soft', `${eligibleRuleB.id}.json`), 'utf-8')) as Rule;
        const globalCandidates = readJsonl<Record<string, unknown>>(globalCandidatePath);
        const sharedCandidate = globalCandidates.find((record) => record.candidate_key === `soft::code::file::${sharedPattern}`);
        const pruneRecordsAFirst = readJsonl<Record<string, unknown>>(prunePathA).filter((record) => record.rule_id === eligibleRuleA.id);
        const pruneRecordsBFirst = readJsonl<Record<string, unknown>>(prunePathB).filter((record) => record.rule_id === eligibleRuleB.id);
        const sharedCandidateRecordsFirst = globalCandidates.filter((record) => record.candidate_key === `soft::code::file::${sharedPattern}`);

        assert(existsSync(join(HARNESS_DIR, 'rules/soft', `${eligibleRuleA.id}.json`)), 'eligible local SOFT rule stays in storage');
        assert(eligibleAAfter.prune_candidate?.reason === 'stale_unused_rule', 'eligible local SOFT rule is marked as prune candidate');
        assert(eligibleAAfter.prune_candidate?.guard_enabled === false, 'prune candidate remains guarded-off by default');
        assert(!promptAAfter.prune_candidate, 'scope: prompt rule is excluded from pruning');
        assert(eligibleBAfter.prune_candidate?.reason === 'stale_unused_rule', 'second project eligible rule is also marked as prune candidate');
        assert(pruneRecordsAFirst.length === 1, 'first idle run appends one prune candidate observation for project A');
        assert(pruneRecordsBFirst.length === 1, 'first idle run appends one prune candidate observation for project B');

        assert(Boolean(sharedCandidate), 'cross-project candidate is recorded');
        assert(sharedCandidate?.candidate_key === `soft::code::file::${sharedPattern}`, 'cross-project candidate uses exact-match aggregation');
        assert(Array.isArray(sharedCandidate?.project_keys) && (sharedCandidate?.project_keys as string[]).includes(projectKeyA) && (sharedCandidate?.project_keys as string[]).includes(projectKeyB), 'cross-project candidate includes both project keys');
        assert((sharedCandidate?.guard_enabled as boolean) === false, 'cross-project promotion remains guarded off by default');
        assert((sharedCandidate?.occurrence_count as number) === 2, 'cross-project candidate aggregates exact matches across two projects');
        assert(sharedCandidateRecordsFirst.length > 0, 'first idle runs append cross-project candidate observations');

        await runProject(worktreeA);
        await runProject(worktreeB);

        const eligibleARepeat = JSON.parse(readFileSync(join(HARNESS_DIR, 'rules/soft', `${eligibleRuleA.id}.json`), 'utf-8')) as Rule;
        const promptARepeat = JSON.parse(readFileSync(join(HARNESS_DIR, 'rules/soft', `${promptRuleA.id}.json`), 'utf-8')) as Rule;
        const eligibleBRepeat = JSON.parse(readFileSync(join(HARNESS_DIR, 'rules/soft', `${eligibleRuleB.id}.json`), 'utf-8')) as Rule;
        const pruneRecordsASecond = readJsonl<Record<string, unknown>>(prunePathA).filter((record) => record.rule_id === eligibleRuleA.id);
        const pruneRecordsBSecond = readJsonl<Record<string, unknown>>(prunePathB).filter((record) => record.rule_id === eligibleRuleB.id);
        const sharedCandidateRecordsSecond = readJsonl<Record<string, unknown>>(globalCandidatePath)
            .filter((record) => record.candidate_key === `soft::code::file::${sharedPattern}`);
        const sharedCandidateIdsFirst = new Set(sharedCandidateRecordsFirst.map((record) => String(record.id)));
        const appendedSharedCandidateRecords = sharedCandidateRecordsSecond.filter((record) => !sharedCandidateIdsFirst.has(String(record.id)));

        assert(pruneRecordsASecond.length === pruneRecordsAFirst.length + 1, 'repeated idle run appends another prune candidate observation for project A');
        assert(pruneRecordsBSecond.length === pruneRecordsBFirst.length + 1, 'repeated idle run appends another prune candidate observation for project B');
        assert(sharedCandidateRecordsSecond.length > sharedCandidateRecordsFirst.length, 'repeated idle runs increase cross-project candidate observations');
        assert(appendedSharedCandidateRecords.length >= 2, 'repeated idle runs append another pair of cross-project candidate observations');
        assert(new Set(pruneRecordsASecond.map((record) => record.id)).size === pruneRecordsASecond.length, 'prune candidate observations remain append-only records for project A');
        assert(new Set(sharedCandidateRecordsSecond.map((record) => record.id)).size === sharedCandidateRecordsSecond.length, 'cross-project candidate observations remain append-only records');
        assert(appendedSharedCandidateRecords.every((record) => record.guard_enabled === false), 'new cross-project candidate observations stay guarded-off');
        assert(eligibleARepeat.prune_candidate?.guard_enabled === false, 'project A prune candidate stays guarded-off after repeated idle runs');
        assert(promptARepeat.prune_candidate === undefined, 'scope: prompt rule stays excluded after repeated idle runs');
        assert(eligibleBRepeat.prune_candidate?.guard_enabled === false, 'project B prune candidate stays guarded-off after repeated idle runs');

        const softRules = readdirSync(join(HARNESS_DIR, 'rules/soft'))
            .filter((file) => file.endsWith('.json'))
            .map((file) => JSON.parse(readFileSync(join(HARNESS_DIR, 'rules/soft', file), 'utf-8')) as Rule);
        const hardRules = readdirSync(join(HARNESS_DIR, 'rules/hard'))
            .filter((file) => file.endsWith('.json'))
            .map((file) => JSON.parse(readFileSync(join(HARNESS_DIR, 'rules/hard', file), 'utf-8')) as Rule);

        assert(!softRules.some((rule) => rule.project_key === 'global' && rule.pattern.match === sharedPattern), 'no automatic global soft rule is created');
        assert(!hardRules.some((rule) => rule.project_key === 'global' && rule.pattern.match === sharedPattern), 'no automatic global hard rule is created');
        assert(sharedCandidateRecordsSecond.every((record) => record.guard_enabled === false), 'cross-project candidate remains guarded-off after repeated idle runs');

        console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
    } finally {
        rmSync(worktreeA, { recursive: true, force: true });
        rmSync(worktreeB, { recursive: true, force: true });
        rmSync(projectDirA, { recursive: true, force: true });
        rmSync(projectDirB, { recursive: true, force: true });
        cleanupRuleFiles(ruleIds);
        rewriteJsonlExcept(prunePathA, (record) => record.rule_id !== eligibleRuleA.id && record.rule_id !== promptRuleA.id);
        rewriteJsonlExcept(prunePathB, (record) => record.rule_id !== eligibleRuleB.id);
        rewriteJsonlExcept(globalCandidatePath, (record) => record.candidate_key !== `soft::code::file::${sharedPattern}`);
    }

    process.exit(failed > 0 ? 1 : 0);
}

void main().catch((err) => {
    console.error(err);
    process.exit(1);
});
