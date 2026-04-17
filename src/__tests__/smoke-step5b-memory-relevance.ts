// src/__tests__/smoke-step5b-memory-relevance.ts — Step 5b reduced-safe smoke test
// 실행: npx tsx src/__tests__/smoke-step5b-memory-relevance.ts

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { tmpdir } from 'os';

import type { MemoryFact, Rule, UpperMemoryExtractShadowRecord, CompactionRelevanceShadowRecord } from '../types.js';
import {
    HarnessImprover,
    planCompactionSelections,
} from '../harness/improver.js';
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

const testDir = join(tmpdir(), `step5b-test-${Date.now()}`);
const sessionDir = join(HARNESS_DIR, 'logs', 'sessions');
const factsDir = join(HARNESS_DIR, 'memory', 'facts');

let projectKey = 'unknown';
let projectHarnessDir = '';
let extractShadowPath = '';
let compactionShadowPath = '';
let sessionFile = '';
let legacySessionFile = '';
let metadataSessionFile = '';
let foreignMetadataSessionFile = '';
let unrelatedSessionFile = '';
let compactionRuleFile = '';
let competingCompactionRuleFile = '';
let softRuleDir = '';
let softRuleBackups: Array<{ filePath: string; content: string }> = [];

function buildRule(overrides: Partial<Rule> & Pick<Rule, 'id' | 'project_key' | 'created_at' | 'description' | 'violation_count'>): Rule {
    return {
        id: overrides.id,
        type: overrides.type ?? 'soft',
        project_key: overrides.project_key,
        created_at: overrides.created_at,
        source_signal_id: overrides.source_signal_id ?? `signal-${overrides.id}`,
        pattern: overrides.pattern ?? {
            type: 'code',
            match: overrides.id,
            scope: 'tool',
        },
        description: overrides.description,
        violation_count: overrides.violation_count,
        last_violation_at: overrides.last_violation_at,
    };
}

function removeProjectFacts(dir: string, targetProjectKey: string): void {
    if (!existsSync(dir)) return;

    for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        const filePath = join(dir, file);
        try {
            const fact = JSON.parse(readFileSync(filePath, 'utf-8')) as { project_key?: string };
            if (fact.project_key === targetProjectKey) {
                rmSync(filePath, { force: true });
            }
        } catch {
            // ignore unrelated/corrupt files in shared harness storage
        }
    }
}

async function main(): Promise<void> {
    mkdirSync(testDir, { recursive: true });
    projectKey = getProjectKey(testDir);
    projectHarnessDir = join(HARNESS_DIR, 'projects', projectKey);
    extractShadowPath = join(projectHarnessDir, 'memory-upper-shadow.jsonl');
    compactionShadowPath = join(projectHarnessDir, 'compacting-relevance-shadow.jsonl');
    mkdirSync(projectHarnessDir, { recursive: true });
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(factsDir, { recursive: true });

    try {
        console.log('\n=== Step 5b Reduced-Safe Smoke Tests ===\n');

        console.log('[1] default-off plan preserves baseline while semantic ranking differs');
        const recent = new Date().toISOString();
        const older = '2026-03-01T00:00:00.000Z';
        const rules: Rule[] = [
            buildRule({
                id: 'global-high-violations',
                project_key: 'global',
                created_at: older,
                description: 'Legacy global warning',
                violation_count: 9,
                pattern: { type: 'code', match: 'global', scope: 'file' },
            }),
            buildRule({
                id: 'project-prompt-recent',
                project_key: projectKey,
                created_at: recent,
                description: 'Current prompt reminder',
                violation_count: 1,
                last_violation_at: recent,
                pattern: { type: 'behavior', match: 'prompt', scope: 'prompt' },
            }),
        ];
        const facts: MemoryFact[] = [
            {
                id: 'legacy-fact',
                keywords: ['decision', 'legacy'],
                content: 'legacy compacting choice',
                source_session: 'legacy.jsonl',
                created_at: older,
            },
            {
                id: 'project-fact',
                project_key: projectKey,
                keywords: ['decision', 'current'],
                content: 'current project compacting choice',
                source_session: 'current.jsonl',
                created_at: recent,
            },
        ];
        const query = 'current prompt decision compacting';

        const defaultPlan = planCompactionSelections(projectKey, rules, facts, query, 1, false);
        const enabledPlan = planCompactionSelections(projectKey, rules, facts, query, 1, true);
        assert(defaultPlan.baseline_soft_rules[0].id === 'global-high-violations', 'baseline soft rule still follows current violation_count ordering');
        assert(defaultPlan.applied_soft_rules[0].id === defaultPlan.baseline_soft_rules[0].id, 'default-off keeps applied soft rule identical to baseline');
        assert(enabledPlan.applied_soft_rules[0].id === 'project-prompt-recent', 'enabled semantic ranking promotes exact-project prompt rule first');
        assert(defaultPlan.applied_facts[0].id === defaultPlan.baseline_facts[0].id, 'default-off keeps applied fact identical to baseline');
        assert(enabledPlan.applied_facts[0].id === 'project-fact', 'enabled semantic ranking prefers exact-project recent fact');

        console.log('\n[2] session.idle appends extract shadow records only for current-project logs');
        sessionFile = join(sessionDir, `step5b-${projectKey}.jsonl`);
        legacySessionFile = join(sessionDir, `session_${projectKey}_compat.jsonl`);
        metadataSessionFile = join(sessionDir, `step5b-metadata-override.jsonl`);
        foreignMetadataSessionFile = join(sessionDir, 'step5b-foreign-metadata.jsonl');
        unrelatedSessionFile = join(sessionDir, 'step5b-other-project.jsonl');
        writeFileSync(sessionFile, [
            JSON.stringify({ type: 'message', text: 'decision: keep semantic compacting disabled by default' }),
            JSON.stringify({ type: 'message', text: 'constraint: shadow logs must stay append-only' }),
        ].join('\n') + '\n');
        writeFileSync(legacySessionFile, [
            JSON.stringify({ type: 'message', text: 'decision: keep legacy session filename compatible' }),
        ].join('\n') + '\n');
        writeFileSync(metadataSessionFile, [
            JSON.stringify({ type: 'message', project_key: projectKey, text: 'decision: metadata-scoped session log should index' }),
        ].join('\n') + '\n');
        writeFileSync(foreignMetadataSessionFile, [
            JSON.stringify({ type: 'message', project_key: `${projectKey}-other`, text: 'decision: foreign metadata must stay isolated' }),
        ].join('\n') + '\n');
        writeFileSync(unrelatedSessionFile, [
            JSON.stringify({ type: 'message', text: 'decision: unrelated project should stay isolated' }),
        ].join('\n') + '\n');

        const improver = await HarnessImprover({ worktree: testDir });
        const idleEvent = improver.event as (input: { event: { type: string; properties?: Record<string, unknown> } }) => Promise<void>;
        await idleEvent({ event: { type: 'session.idle', properties: { sessionID: 'step5b-shadow' } } });

        const extractRecords = readJsonl<UpperMemoryExtractShadowRecord>(extractShadowPath);
        assert(extractRecords.length >= 2, 'extract shadow records appended for indexed fact candidates');
        assert(extractRecords.every((record) => record.stage === 'extract'), 'extract shadow file records only extract stage in reduced scope');
        assert(extractRecords.some((record) => record.content.includes('semantic compacting disabled by default')), 'extract shadow captures indexed decision text');
        assert(extractRecords.some((record) => record.source_session === basename(legacySessionFile)), 'legacy session_${projectKey}_...jsonl filename is indexed');
        assert(extractRecords.some((record) => record.source_session === basename(metadataSessionFile)), 'explicit per-entry project_key metadata is indexed');
        assert(!extractRecords.some((record) => record.source_session === basename(foreignMetadataSessionFile)), 'mismatched project_key metadata stays isolated');
        assert(!extractRecords.some((record) => record.content.includes('unrelated project should stay isolated')), 'current project skips unrelated session logs during indexing');

        await idleEvent({ event: { type: 'session.idle', properties: { sessionID: 'step5b-shadow-repeat' } } });
        const extractRecordsAfterRepeat = readJsonl<UpperMemoryExtractShadowRecord>(extractShadowPath);
        assert(extractRecordsAfterRepeat.length > extractRecords.length, 'extract shadow stays append-only across repeated idle runs');

        console.log('\n[3] extract shadow failure stays non-fatal for baseline indexing');
        rmSync(extractShadowPath, { force: true });
        mkdirSync(extractShadowPath, { recursive: true });
        await idleEvent({ event: { type: 'session.idle', properties: { sessionID: 'step5b-shadow-failure' } } });
        const projectFacts = readdirSync(factsDir)
            .filter((file) => file.endsWith('.json'))
            .map((file) => JSON.parse(readFileSync(join(factsDir, file), 'utf-8')) as MemoryFact)
            .filter((fact) => fact.project_key === projectKey);
        assert(projectFacts.length > 0, 'fact indexing still succeeds when extract shadow append fails');
        rmSync(extractShadowPath, { recursive: true, force: true });

        console.log('\n[4] compacting writes shadow log and keeps output stable by default');
        softRuleDir = join(HARNESS_DIR, 'rules', 'soft');
        mkdirSync(softRuleDir, { recursive: true });
        softRuleBackups = readdirSync(softRuleDir)
            .filter((file) => file.endsWith('.json'))
            .map((file) => {
                const filePath = join(softRuleDir, file);
                return { filePath, content: readFileSync(filePath, 'utf-8') };
            });
        for (const { filePath } of softRuleBackups) {
            rmSync(filePath, { force: true });
        }
        compactionRuleFile = join(softRuleDir, `step5b-${projectKey}.json`);
        competingCompactionRuleFile = join(softRuleDir, `step5b-global-${projectKey}.json`);
        writeFileSync(compactionRuleFile, JSON.stringify(buildRule({
            id: `step5b-rule-${projectKey}`,
            project_key: projectKey,
            created_at: new Date().toISOString(),
            description: 'Semantic compacting default-off reminder',
            violation_count: 1,
            pattern: { type: 'behavior', match: 'semantic compacting default-off', scope: 'prompt' },
        }), null, 2));
        writeFileSync(competingCompactionRuleFile, JSON.stringify(buildRule({
            id: `step5b-global-rule-${projectKey}`,
            project_key: 'global',
            created_at: '2026-03-01T00:00:00.000Z',
            description: 'Legacy global compacting reminder',
            violation_count: 5,
            pattern: { type: 'code', match: 'legacy global reminder', scope: 'file' },
        }), null, 2));

        const output = { context: [] as string[] };
        const compacting = improver['experimental.session.compacting'] as (input: unknown, output: { context: string[] }) => Promise<void>;
        await compacting({}, output);
        const compactionRecords = readJsonl<CompactionRelevanceShadowRecord>(compactionShadowPath);
        const latestRecord = compactionRecords[compactionRecords.length - 1];
        assert(output.context.some((part) => part.includes('[HARNESS MEMORY — past decisions]')), 'default compacting still injects memory facts');
        assert(latestRecord.filter_enabled === false, 'default compacting shadow record marks filter as disabled');
        assert(latestRecord.baseline_selection.soft_rule_ids.join(',') === latestRecord.applied_selection.soft_rule_ids.join(','), 'default-off shadow keeps applied soft rules equal to baseline selection');
        assert(latestRecord.baseline_selection.fact_ids.join(',') === latestRecord.applied_selection.fact_ids.join(','), 'default-off shadow keeps applied facts equal to baseline selection');

        console.log('\n[5] enabled compacting path and shadow failure both keep baseline usable');
        const enabledImprover = await HarnessImprover({ worktree: testDir }, { harness: { semantic_compacting_enabled: true } });
        const enabledOutput = { context: [] as string[] };
        const enabledCompacting = enabledImprover['experimental.session.compacting'] as (input: unknown, output: { context: string[] }) => Promise<void>;
        await enabledCompacting({}, enabledOutput);
        const enabledRecords = readJsonl<CompactionRelevanceShadowRecord>(compactionShadowPath);
        const latestEnabledRecord = enabledRecords[enabledRecords.length - 1];
        assert(latestEnabledRecord.filter_enabled === true, 'enabled compacting shadow record marks filter as enabled');
        assert(latestEnabledRecord.baseline_selection.soft_rule_ids.join(',') !== latestEnabledRecord.applied_selection.soft_rule_ids.join(','), 'enabled compacting can change soft rule selection');
        assert(enabledOutput.context.some((part) => part.includes('[HARNESS SOFT RULES — recommended]')), 'enabled compacting still emits soft rule context');

        rmSync(compactionShadowPath, { force: true });
        mkdirSync(compactionShadowPath, { recursive: true });
        const fallbackOutput = { context: [] as string[] };
        await compacting({}, fallbackOutput);
        assert(fallbackOutput.context.some((part) => part.includes('[HARNESS MEMORY — past decisions]')), 'compacting context still builds when shadow append fails');
        rmSync(compactionShadowPath, { recursive: true, force: true });

        console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
    } finally {
        rmSync(testDir, { recursive: true, force: true });
        rmSync(projectHarnessDir, { recursive: true, force: true });
        rmSync(sessionFile, { force: true });
        rmSync(legacySessionFile, { force: true });
        rmSync(metadataSessionFile, { force: true });
        rmSync(foreignMetadataSessionFile, { force: true });
        rmSync(unrelatedSessionFile, { force: true });
        rmSync(compactionRuleFile, { force: true });
        rmSync(competingCompactionRuleFile, { force: true });
        for (const { filePath, content } of softRuleBackups) {
            writeFileSync(filePath, content);
        }
        removeProjectFacts(factsDir, projectKey);
    }

    process.exit(failed > 0 ? 1 : 0);
}

void main().catch((err) => {
    console.error(err);
    process.exit(1);
});
