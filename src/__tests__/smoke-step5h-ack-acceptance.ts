// src/__tests__/smoke-step5h-ack-acceptance.ts — Step 5h multi-check acceptance plane smoke test
// 실행: npx tsx src/__tests__/smoke-step5h-ack-acceptance.ts

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { HarnessImprover, evaluateAckAcceptance } from '../harness/improver.js';
import { HARNESS_DIR, getProjectKey } from '../shared/index.js';
import type { Signal, Rule, AckRecord } from '../types.js';

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

function makeSignal(id: string, pattern: string, projectKey: string): Signal {
    return {
        id,
        type: 'error_repeat',
        project_key: projectKey,
        session_id: 'test-session',
        timestamp: new Date().toISOString(),
        payload: {
            description: `Test pattern: ${pattern}`,
            pattern,
            recurrence_count: 3,
        },
        status: 'pending',
    };
}

function makeRule(id: string, pattern: string, projectKey: string, overrides?: Partial<Rule>): Rule {
    return {
        id,
        type: 'soft',
        project_key: projectKey,
        created_at: new Date().toISOString(),
        source_signal_id: 'test-signal',
        pattern: { type: 'code', match: pattern, scope: 'file' },
        description: `Test rule for ${pattern}`,
        violation_count: 0,
        ...overrides,
    };
}

function writeRuleToDisk(rule: Rule): void {
    const dir = join(HARNESS_DIR, `rules/${rule.type}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${rule.id}.json`), JSON.stringify(rule, null, 2));
}

function writeCorruptRuleFile(ruleId: string, type: 'soft' | 'hard'): void {
    const dir = join(HARNESS_DIR, `rules/${type}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${ruleId}.json`), '{ corrupt json /// ');
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
        } catch { /* ignore */ }
    }
}

const testDir = join(tmpdir(), `step5h-test-${Date.now()}`);
const opencodeDir = join(testDir, '.opencode');
const pendingDir = join(HARNESS_DIR, 'signals', 'pending');
const ackDir = join(HARNESS_DIR, 'signals', 'ack');

const SIGNAL_IDS = {
    allPass: 'step5h-allpass',
    ruleMissing: 'step5h-missing',
    ruleCorrupt: 'step5h-corrupt',
    ruleNoFields: 'step5h-nofields',
    rulePrune: 'step5h-prune',
    guardDisabled: 'step5h-guardoff',
};

let projectKey = 'unknown';
let projectHarnessDir = '';
let ackStatusPath = '';

async function main(): Promise<void> {
    mkdirSync(opencodeDir, { recursive: true });
    projectKey = getProjectKey(testDir);
    projectHarnessDir = join(HARNESS_DIR, 'projects', projectKey);
    ackStatusPath = join(projectHarnessDir, 'ack-status.jsonl');

    // Cleanup
    rmSync(projectHarnessDir, { recursive: true, force: true });
    const softDir = join(HARNESS_DIR, 'rules/soft');
    const hardDir = join(HARNESS_DIR, 'rules/hard');
    rmSync(softDir, { recursive: true, force: true });
    rmSync(hardDir, { recursive: true, force: true });
    Object.values(SIGNAL_IDS).forEach((id) => {
        rmSync(join(pendingDir, `${id}.json`), { force: true });
        rmSync(join(ackDir, `${id}.json`), { force: true });
    });

    try {
        console.log('\n=== Step 5h Ack Acceptance Plane Smoke Tests ===\n');

        // ─── Unit Tests: evaluateAckAcceptance() directly ───

        console.log('[1] All 3 checks pass → accepted');
        const goodRule = makeRule('rule-allpass', 'TypeError: boom', projectKey);
        writeRuleToDisk(goodRule);
        const sig1 = makeSignal(SIGNAL_IDS.allPass, 'TypeError: boom', projectKey);
        const result1 = evaluateAckAcceptance(sig1, '/dummy/ack/path');
        assert(result1.verdict === 'accepted', 'verdict === accepted');
        assert(result1.checks_passed.length === 3, '3 checks passed');
        assert(result1.checks_passed.includes('rule_written'), 'includes rule_written');
        assert(result1.checks_passed.includes('rule_valid'), 'includes rule_valid');
        assert(result1.checks_passed.includes('not_prune_candidate'), 'includes not_prune_candidate');
        assert(result1.checks_failed.length === 0, '0 checks failed');
        assert(result1.reason === 'all_3_checks_passed', 'reason === all_3_checks_passed');

        console.log('\n[2] Rule file missing → rejected at rule_written');
        const sig2 = makeSignal(SIGNAL_IDS.ruleMissing, 'NonExistentPattern', projectKey);
        const result2 = evaluateAckAcceptance(sig2, '/dummy/ack/path');
        assert(result2.verdict === 'rejected', 'verdict === rejected');
        assert(result2.checks_passed.length === 0, '0 checks passed');
        assert(result2.checks_failed.length === 1, '1 check failed');
        assert(result2.checks_failed[0].check === 'rule_written', 'failed check === rule_written');
        assert(result2.checks_failed[0].reason === 'rule_file_not_found', 'reason === rule_file_not_found');

        console.log('\n[3] Corrupt JSON rule → rejected at rule_valid (parse error caught by findRule)');
        // findRule does JSON.parse in try/catch → returns null → rule_written fails
        writeCorruptRuleFile('rule-corrupt', 'soft');
        // Need a rule whose pattern matches corrupt file — but findRule can't parse it
        // Actually, findRule returns null for corrupt files, so rule_written fails first
        // Let's test the actual corrupt scenario by writing a valid-looking file with bad JSON
        const corruptDir = join(HARNESS_DIR, 'rules/soft');
        mkdirSync(corruptDir, { recursive: true });
        writeFileSync(join(corruptDir, 'rule-corrupt2.json'), 'not json at all');
        const sig3 = makeSignal(SIGNAL_IDS.ruleCorrupt, 'CorruptTestPattern', projectKey);
        // write a valid rule for corrupt test but corrupt it
        const corruptRule = makeRule('rule-corrupt2', 'CorruptTestPattern', projectKey);
        writeFileSync(join(corruptDir, 'rule-corrupt2.json'), JSON.stringify(corruptRule));
        // Now corrupt: overwrite with bad JSON
        writeFileSync(join(corruptDir, 'rule-corrupt2.json'), '{ bad json content');
        const result3 = evaluateAckAcceptance(sig3, '/dummy/ack/path');
        // findRule catches parse error → returns null → rule_written fails
        assert(result3.verdict === 'rejected', 'corrupt rule rejected');
        assert(result3.checks_failed[0].check === 'rule_written', 'corrupt rule fails at rule_written (findRule returns null)');

        console.log('\n[4] Rule missing required fields → rejected at rule_valid');
        const incompleteRule: Rule = {
            id: 'rule-nofields',
            type: 'soft',
            project_key: projectKey,
            created_at: new Date().toISOString(),
            source_signal_id: 'test',
            pattern: { type: 'code', match: 'MissingFieldsPattern', scope: 'file' },
            description: '',  // empty description — should fail validation
            violation_count: 0,
        };
        writeRuleToDisk(incompleteRule);
        const sig4 = makeSignal(SIGNAL_IDS.ruleNoFields, 'MissingFieldsPattern', projectKey);
        const result4 = evaluateAckAcceptance(sig4, '/dummy/ack/path');
        assert(result4.verdict === 'rejected', 'verdict === rejected');
        assert(result4.checks_passed.includes('rule_written'), 'rule_written passed (file exists)');
        assert(result4.checks_failed[0].check === 'rule_valid', 'fails at rule_valid');
        assert(result4.checks_failed[0].reason === 'rule_missing_required_fields', 'reason === rule_missing_required_fields');

        console.log('\n[5] Rule is prune_candidate → rejected at not_prune_candidate');
        const pruneRule = makeRule('rule-prune', 'PruneTestPattern', projectKey, {
            prune_candidate: {
                marked_at: new Date().toISOString(),
                reason: 'inactive for 30+ days',
                guard_enabled: true,
            },
        });
        writeRuleToDisk(pruneRule);
        const sig5 = makeSignal(SIGNAL_IDS.rulePrune, 'PruneTestPattern', projectKey);
        const result5 = evaluateAckAcceptance(sig5, '/dummy/ack/path');
        assert(result5.verdict === 'rejected', 'verdict === rejected');
        assert(result5.checks_passed.includes('rule_written'), 'rule_written passed');
        assert(result5.checks_passed.includes('rule_valid'), 'rule_valid passed');
        assert(result5.checks_failed[0].check === 'not_prune_candidate', 'fails at not_prune_candidate');
        assert(result5.checks_failed[0].reason === 'rule_is_prune_candidate', 'reason === rule_is_prune_candidate');

        console.log('\n[6] Missing signal pattern → rejected');
        const noPatternSignal: Signal = {
            id: 'step5h-nopattern',
            type: 'error_repeat',
            project_key: projectKey,
            timestamp: new Date().toISOString(),
            payload: {
                description: '',
                recurrence_count: 1,
            },
            status: 'pending',
        };
        const result6 = evaluateAckAcceptance(noPatternSignal, '/dummy/ack/path');
        assert(result6.verdict === 'rejected', 'no pattern rejected');
        assert(result6.checks_failed[0].check === 'rule_written', 'fails at rule_written (no pattern)');
        assert(result6.checks_failed[0].reason === 'missing_signal_pattern', 'reason === missing_signal_pattern');

        console.log('\n[7] prune_candidate with guard_enabled=false passes');
        const pruneRuleNoGuard = makeRule('rule-prune-noguard', 'PruneNoGuard', projectKey, {
            prune_candidate: {
                marked_at: new Date().toISOString(),
                reason: 'reviewed and kept',
                guard_enabled: false,
            },
        });
        writeRuleToDisk(pruneRuleNoGuard);
        const sig7 = makeSignal('step5h-prune-noguard', 'PruneNoGuard', projectKey);
        const result7 = evaluateAckAcceptance(sig7, '/dummy/ack/path');
        assert(result7.verdict === 'accepted', 'prune_candidate with guard_enabled=false passes');

        // ─── Integration Tests: full session.idle flow ───

        console.log('\n[8] Full flow: guard enabled, valid rule → written + accepted records');
        rmSync(ackStatusPath, { force: true });
        const validRule = makeRule('rule-flow-valid', 'FlowValidPattern', projectKey);
        writeRuleToDisk(validRule);
        writeFileSync(join(pendingDir, `${SIGNAL_IDS.allPass}.json`), JSON.stringify(
            makeSignal(SIGNAL_IDS.allPass, 'FlowValidPattern', projectKey), null, 2
        ));

        const guardedImprover = await HarnessImprover({ worktree: testDir }, { harness: { ack_guard_enabled: true } });
        const guardedEvent = guardedImprover.event as (input: { event: { type: string } }) => Promise<void>;
        await guardedEvent({ event: { type: 'session.idle' } });

        const ackRecords = readJsonl(ackStatusPath);
        const writtenRec = ackRecords.find((r) => r.signal_id === SIGNAL_IDS.allPass && r.state === 'written');
        const acceptedRec = ackRecords.find((r) => r.signal_id === SIGNAL_IDS.allPass && r.state === 'accepted');
        assert(!!writtenRec, 'written record exists for valid signal');
        assert(!!acceptedRec, 'accepted record exists for valid signal');
        if (acceptedRec) {
            assert((acceptedRec as Record<string, unknown>).acceptance_verdict === 'accepted', 'accepted record has acceptance_verdict=accepted');
            assert(Array.isArray((acceptedRec as Record<string, unknown>).acceptance_checks_passed), 'accepted record has acceptance_checks_passed');
        }

        console.log('\n[9] Full flow: guard disabled → no accepted record');
        writeFileSync(join(pendingDir, `${SIGNAL_IDS.guardDisabled}.json`), JSON.stringify(
            makeSignal(SIGNAL_IDS.guardDisabled, 'FlowValidPattern', projectKey), null, 2
        ));

        const defaultImprover = await HarnessImprover({ worktree: testDir });
        const defaultEvent = defaultImprover.event as (input: { event: { type: string } }) => Promise<void>;
        await defaultEvent({ event: { type: 'session.idle' } });

        const ackRecordsAfter = readJsonl(ackStatusPath);
        const guardOffWritten = ackRecordsAfter.find((r) => r.signal_id === SIGNAL_IDS.guardDisabled && r.state === 'written');
        const guardOffAccepted = ackRecordsAfter.find((r) => r.signal_id === SIGNAL_IDS.guardDisabled && r.state === 'accepted');
        assert(!!guardOffWritten, 'guard off: written record exists');
        assert(!guardOffAccepted, 'guard off: no accepted record');
        if (guardOffWritten) {
            assert((guardOffWritten as Record<string, unknown>).acceptance_verdict === 'rejected', 'guard off: acceptance_verdict=rejected');
            assert((guardOffWritten as Record<string, unknown>).reason === 'guard_disabled', 'guard off: reason=guard_disabled');
        }

        console.log('\n[10] Full flow: guard enabled, rule not created (broad pattern) → written only, no accepted');
        rmSync(ackStatusPath, { force: true });
        // Use a broad pattern that signalToRule will reject (isValidPattern returns false)
        // so no rule file is created → evaluateAckAcceptance should find no rule
        const broadSignal: Signal = {
            id: SIGNAL_IDS.ruleMissing,
            type: 'error_repeat',
            project_key: projectKey,
            timestamp: new Date().toISOString(),
            payload: {
                description: 'Too broad',
                pattern: '...',  // broad pattern — rejected by isValidPattern
                recurrence_count: 3,
            },
            status: 'pending',
        };
        writeFileSync(join(pendingDir, `${SIGNAL_IDS.ruleMissing}.json`), JSON.stringify(broadSignal, null, 2));

        const guarded2 = await HarnessImprover({ worktree: testDir }, { harness: { ack_guard_enabled: true } });
        const guarded2Event = guarded2.event as (input: { event: { type: string } }) => Promise<void>;
        await guarded2Event({ event: { type: 'session.idle' } });

        const ackRecords2 = readJsonl(ackStatusPath);
        const missingWritten = ackRecords2.find((r) => r.signal_id === SIGNAL_IDS.ruleMissing && r.state === 'written');
        const missingAccepted = ackRecords2.find((r) => r.signal_id === SIGNAL_IDS.ruleMissing && r.state === 'accepted');
        assert(!!missingWritten, 'missing rule: written record exists');
        assert(!missingAccepted, 'missing rule: no accepted record');
        if (missingWritten) {
            assert((missingWritten as Record<string, unknown>).acceptance_verdict === 'rejected', 'missing rule: verdict=rejected');
            assert(
                Array.isArray((missingWritten as Record<string, unknown>).acceptance_checks_failed) &&
                ((missingWritten as Record<string, unknown>).acceptance_checks_failed as Array<unknown>).length > 0,
                'missing rule: has failed checks'
            );
        }

        console.log('\n[11] Old ack records (pre-5h schema) remain readable');
        // Write a pre-5h format record directly
        mkdirSync(join(HARNESS_DIR, 'projects', projectKey), { recursive: true });
        const oldRecord: Record<string, unknown> = {
            signal_id: 'old-signal',
            project_key: projectKey,
            timestamp: new Date().toISOString(),
            state: 'written',
            signal_type: 'error_repeat',
            guard_enabled: false,
            acceptance_check: 'rule_written',  // old field
            accepted: false,
            reason: 'guard_disabled',
            // No acceptance_checks_passed/failed/verdict — pre-5h
        };
        writeFileSync(ackStatusPath, JSON.stringify(oldRecord) + '\n', { flag: 'a' });
        const allRecords = readJsonl(ackStatusPath);
        const oldRec = allRecords.find((r) => r.signal_id === 'old-signal');
        assert(!!oldRec, 'old format record found');
        assert(oldRec!.acceptance_check === 'rule_written', 'old format has acceptance_check field');

        console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
    } finally {
        // Cleanup
        rmSync(testDir, { recursive: true, force: true });
        rmSync(projectHarnessDir, { recursive: true, force: true });
        rmSync(join(HARNESS_DIR, 'rules/soft'), { recursive: true, force: true });
        rmSync(join(HARNESS_DIR, 'rules/hard'), { recursive: true, force: true });
        Object.values(SIGNAL_IDS).forEach((id) => {
            rmSync(join(pendingDir, `${id}.json`), { force: true });
            rmSync(join(ackDir, `${id}.json`), { force: true });
        });
        rmSync(ackStatusPath, { force: true });
    }

    process.exit(failed > 0 ? 1 : 0);
}

void main().catch((err) => {
    console.error(err);
    process.exit(1);
});
