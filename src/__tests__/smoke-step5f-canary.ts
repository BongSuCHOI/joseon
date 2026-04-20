// src/__tests__/smoke-step5f-canary.ts — Step 5f phase-signal-canary smoke test
// 실행: npx tsx src/__tests__/smoke-step5f-canary.ts

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import type { ShadowDecisionRecord } from '../types.js';
import { HARNESS_DIR, getProjectKey, appendJsonlRecord } from '../shared/index.js';
import { getHarnessSettings } from '../config/index.js';
import {
    readRecentShadowRecords,
    isLowConfidenceProxy,
    computePhaseHint,
    computeSignalRelevance,
    computeConfidence,
    evaluateCanary,
    getCanaryMismatchesPath,
    appendMismatchRecord,
    generateCanaryReport,
    runCanaryEvaluation,
} from '../harness/canary.js';

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

function makePhaseRecord(overrides: Partial<ShadowDecisionRecord['deterministic']> & { phase_from: number; phase_to: number }, context?: Record<string, unknown>): ShadowDecisionRecord {
    return {
        id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'phase',
        project_key: 'test',
        timestamp: new Date().toISOString(),
        deterministic: {
            trigger: 'test',
            ...overrides,
        },
        shadow: { status: 'unavailable', confidence: 0 },
        context: context ?? {},
    };
}

function makeSignalRecord(overrides: Partial<ShadowDecisionRecord['deterministic']>, context?: Record<string, unknown>): ShadowDecisionRecord {
    return {
        id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'signal',
        project_key: 'test',
        timestamp: new Date().toISOString(),
        deterministic: {
            trigger: 'test',
            ...overrides,
        },
        shadow: { status: 'unavailable', confidence: 0 },
        context: context ?? {},
    };
}

const testDir = join(tmpdir(), `harness-test-5f-${Date.now()}`);
let projectKey = '';
let projectHarnessDir = '';
let shadowPath = '';
let mismatchesPath = '';

async function main(): Promise<void> {
    mkdirSync(testDir, { recursive: true });
    projectKey = getProjectKey(testDir);
    projectHarnessDir = join(HARNESS_DIR, 'projects', projectKey);
    shadowPath = join(projectHarnessDir, 'phase-signal-shadow.jsonl');
    mismatchesPath = getCanaryMismatchesPath(testDir);

    // Clean up any pre-existing test artifacts
    rmSync(projectHarnessDir, { recursive: true, force: true });

    try {
        console.log('\n=== Step 5f Phase-Signal Canary Smoke Tests ===\n');

        // ─── 1. readRecentShadowRecords — empty file returns [] ───
        console.log('[1] readRecentShadowRecords — empty file returns []');
        const emptyResult = readRecentShadowRecords(testDir, 10);
        assert(emptyResult.length === 0, 'returns empty array when no shadow file exists');

        // ─── 2. readRecentShadowRecords — reads last N records ───
        console.log('\n[2] readRecentShadowRecords — reads last N records');
        mkdirSync(projectHarnessDir, { recursive: true });
        for (let i = 0; i < 5; i++) {
            const rec: ShadowDecisionRecord = {
                id: `rec-${i}`,
                kind: 'phase',
                project_key: projectKey,
                timestamp: new Date().toISOString(),
                deterministic: { trigger: 'test', phase_from: i, phase_to: i + 1 },
                shadow: { status: 'recorded', confidence: 1 },
                context: {},
            };
            appendJsonlRecord(shadowPath, rec as unknown as Record<string, unknown>);
        }
        const recent3 = readRecentShadowRecords(testDir, 3);
        assert(recent3.length === 3, 'returns exactly 3 records');
        assert(recent3[0].id === 'rec-4', 'first record is the newest (rec-4)');
        assert(recent3[2].id === 'rec-2', 'last record is rec-2 (3rd from end)');

        // ─── 3. isLowConfidenceProxy — phase_blocked ───
        console.log('\n[3] isLowConfidenceProxy — phase_blocked');
        const blockedRecord = makePhaseRecord(
            { phase_from: 2, phase_to: 3 },
            { transition_status: 'blocked' },
        );
        assert(isLowConfidenceProxy(blockedRecord) === 'phase_blocked', 'returns phase_blocked for blocked transition');

        // ─── 4. isLowConfidenceProxy — phase_regression ───
        console.log('\n[4] isLowConfidenceProxy — phase_regression');
        const regressionRecord = makePhaseRecord(
            { phase_from: 3, phase_to: 2 },
            {},
        );
        assert(isLowConfidenceProxy(regressionRecord) === 'phase_regression', 'returns phase_regression for backward phase');

        // ─── 5. isLowConfidenceProxy — user_feedback ───
        console.log('\n[5] isLowConfidenceProxy — user_feedback');
        const feedbackRecord = makeSignalRecord(
            { signal_type: 'user_feedback' },
        );
        assert(isLowConfidenceProxy(feedbackRecord) === 'user_feedback', 'returns user_feedback for user_feedback signal');

        // ─── 6. isLowConfidenceProxy — error_pre_alert ───
        console.log('\n[6] isLowConfidenceProxy — error_pre_alert');
        const errorPreAlertRecord = makeSignalRecord(
            { signal_type: 'error_repeat' },
            { repeat_count: 2 },
        );
        assert(isLowConfidenceProxy(errorPreAlertRecord) === 'error_pre_alert', 'returns error_pre_alert for error_repeat with repeat_count=2');

        // ─── 7. isLowConfidenceProxy — normal forward phase returns null ───
        console.log('\n[7] isLowConfidenceProxy — normal forward phase returns null');
        const forwardRecord = makePhaseRecord(
            { phase_from: 1, phase_to: 2 },
            { transition_status: 'applied' },
        );
        assert(isLowConfidenceProxy(forwardRecord) === null, 'forward applied phase returns null');

        // ─── 8. isLowConfidenceProxy — fix_commit signal returns null ───
        console.log('\n[8] isLowConfidenceProxy — fix_commit signal returns null');
        const fixCommitRecord = makeSignalRecord(
            { signal_type: 'fix_commit' },
        );
        assert(isLowConfidenceProxy(fixCommitRecord) === null, 'fix_commit signal returns null');

        // ─── 9. computePhaseHint — blocked_gate ───
        console.log('\n[9] computePhaseHint — blocked_gate');
        assert(computePhaseHint(blockedRecord) === 'blocked_gate', 'blocked transition → blocked_gate');

        // ─── 10. computePhaseHint — regression ───
        console.log('\n[10] computePhaseHint — regression');
        assert(computePhaseHint(regressionRecord) === 'regression', 'backward phase → regression');

        // ─── 11. computePhaseHint — forward ───
        console.log('\n[11] computePhaseHint — forward');
        assert(computePhaseHint(forwardRecord) === 'forward', 'forward phase → forward');

        // ─── 12. computeSignalRelevance — high (2+ keywords) ───
        console.log('\n[12] computeSignalRelevance — high (2+ keywords)');
        const highRelevanceRecord = makeSignalRecord(
            { signal_type: 'user_feedback' },
            { matched_keywords: ['왜이래', '또'] },
        );
        assert(computeSignalRelevance(highRelevanceRecord) === 'high', '2 keywords → high relevance');

        // ─── 13. computeSignalRelevance — medium (1 keyword) ───
        console.log('\n[13] computeSignalRelevance — medium (1 keyword)');
        const medRelevanceRecord = makeSignalRecord(
            { signal_type: 'user_feedback' },
            { matched_keywords: ['이상해'] },
        );
        assert(computeSignalRelevance(medRelevanceRecord) === 'medium', '1 keyword → medium relevance');

        // ─── 14. computeSignalRelevance — low (0 keywords) ───
        console.log('\n[14] computeSignalRelevance — low (0 keywords)');
        const lowRelevanceRecord = makeSignalRecord(
            { signal_type: 'user_feedback' },
            { matched_keywords: [] },
        );
        assert(computeSignalRelevance(lowRelevanceRecord) === 'low', '0 keywords → low relevance');

        // ─── 15. computeConfidence — rare event (high confidence) ───
        console.log('\n[15] computeConfidence — rare event (high confidence)');
        const rareConfidence = computeConfidence('phase_blocked', []);
        assert(rareConfidence >= 0.7, `empty recent records → confidence >= 0.7 (got ${rareConfidence})`);

        // ─── 16. computeConfidence — frequent event (low confidence) ───
        console.log('\n[16] computeConfidence — frequent event (low confidence)');
        const frequentRecords: ShadowDecisionRecord[] = [];
        for (let i = 0; i < 6; i++) {
            frequentRecords.push(makePhaseRecord(
                { phase_from: 2, phase_to: 3 },
                { transition_status: 'blocked' },
            ));
        }
        const freqConfidence = computeConfidence('phase_blocked', frequentRecords);
        assert(freqConfidence <= 0.3, `6 same-proxy records → confidence <= 0.3 (got ${freqConfidence})`);

        // ─── 17. evaluateCanary — disabled returns null ───
        console.log('\n[17] evaluateCanary — disabled returns null');
        const disabledResult = evaluateCanary(blockedRecord, [], undefined);
        assert(disabledResult === null, 'canary_enabled=false (default) returns null');

        const explicitDisabled = evaluateCanary(blockedRecord, [], { harness: { canary_enabled: false } });
        assert(explicitDisabled === null, 'explicit canary_enabled=false returns null');

        // ─── 18. evaluateCanary — enabled + low-confidence proxy returns result ───
        console.log('\n[18] evaluateCanary — enabled + low-confidence proxy returns result');
        const enabledConfig = { harness: { canary_enabled: true } };
        const enabledResult = evaluateCanary(blockedRecord, [], enabledConfig);
        assert(enabledResult !== null, 'enabled + phase_blocked returns non-null');
        assert(enabledResult!.phase_hint === 'blocked_gate', `phase_hint is blocked_gate (got ${enabledResult!.phase_hint})`);
        assert(enabledResult!.confidence >= 0.7, `confidence >= 0.7 for rare event (got ${enabledResult!.confidence})`);

        // ─── 19. appendMismatchRecord — phase blocked mismatch ───
        console.log('\n[19] appendMismatchRecord — phase blocked mismatch');
        rmSync(mismatchesPath, { force: true });
        const canaryResultForMismatch = {
            phase_hint: 'blocked_gate' as string | undefined,
            signal_relevance: undefined as string | undefined,
            confidence: 0.7,
            reason: 'test mismatch',
        };
        appendMismatchRecord(testDir, blockedRecord, canaryResultForMismatch);
        assert(existsSync(mismatchesPath), 'canary-mismatches.jsonl created after phase mismatch');
        const mismatchRecords19 = readJsonl(mismatchesPath);
        assert(mismatchRecords19.length === 1, '1 mismatch record appended');
        assert(mismatchRecords19[0].proxy_type === 'phase_blocked', `proxy_type is phase_blocked (got ${mismatchRecords19[0].proxy_type})`);

        // ─── 20. appendMismatchRecord — signal not-emitted mismatch ───
        console.log('\n[20] appendMismatchRecord — signal not-emitted mismatch');
        rmSync(mismatchesPath, { force: true });
        const notEmittedRecord = makeSignalRecord(
            { signal_type: 'user_feedback', emitted: false },
            { matched_keywords: ['왜이래', '또'] },
        );
        const canaryResultForSignal = {
            phase_hint: undefined as string | undefined,
            signal_relevance: 'high' as string | undefined,
            confidence: 0.7,
            reason: 'test signal mismatch',
        };
        appendMismatchRecord(testDir, notEmittedRecord, canaryResultForSignal);
        const mismatchRecords20 = readJsonl(mismatchesPath);
        assert(mismatchRecords20.length === 1, '1 signal mismatch record appended');
        assert(mismatchRecords20[0].proxy_type === 'user_feedback', `proxy_type is user_feedback (got ${mismatchRecords20[0].proxy_type})`);

        // ─── 21. appendMismatchRecord — no mismatch when confidence low ───
        console.log('\n[21] appendMismatchRecord — no mismatch when confidence low');
        rmSync(mismatchesPath, { force: true });
        const lowConfCanaryResult = {
            phase_hint: undefined as string | undefined,
            signal_relevance: 'high' as string | undefined,
            confidence: 0.3,
            reason: 'test low conf',
        };
        appendMismatchRecord(testDir, notEmittedRecord, lowConfCanaryResult);
        assert(!existsSync(mismatchesPath), 'no mismatch file when confidence is low (0.3)');

        // ─── 22. generateCanaryReport — empty returns zeros ───
        console.log('\n[22] generateCanaryReport — empty returns zeros');
        // Use a fresh testDir so there's no shadow/mismatch data
        const emptyReportDir = join(tmpdir(), `harness-test-5f-empty-${Date.now()}`);
        mkdirSync(emptyReportDir, { recursive: true });
        try {
            const report = generateCanaryReport(emptyReportDir);
            assert(report.total === 0, `report total is 0 (got ${report.total})`);
            assert(report.mismatches === 0, `report mismatches is 0 (got ${report.mismatches})`);
            assert(report.mismatch_rate === 0, `report mismatch_rate is 0 (got ${report.mismatch_rate})`);
        } finally {
            rmSync(emptyReportDir, { recursive: true, force: true });
        }

        // ─── 23. generateCanaryReport — with data ───
        console.log('\n[23] generateCanaryReport — with data');
        // Reset for report test
        rmSync(projectHarnessDir, { recursive: true, force: true });
        mkdirSync(projectHarnessDir, { recursive: true });

        // Write 2 evaluated shadow records (shadow.status = 'low_confidence')
        for (let i = 0; i < 2; i++) {
            const rec: ShadowDecisionRecord = {
                id: `eval-${i}`,
                kind: 'phase',
                project_key: projectKey,
                timestamp: new Date().toISOString(),
                deterministic: { trigger: 'test', phase_from: 2, phase_to: 3 },
                shadow: { status: 'low_confidence', confidence: 0.7, reason: 'test' },
                context: { transition_status: 'blocked' },
            };
            appendJsonlRecord(shadowPath, rec as unknown as Record<string, unknown>);
        }
        // Write 1 mismatch
        const mismatchEntry = {
            id: 'mismatch-1',
            timestamp: new Date().toISOString(),
            project_key: projectKey,
            proxy_type: 'phase_blocked',
            deterministic: { decision: 'phase 2->3', detail: '{}' },
            canary: { phase_hint: 'blocked_gate', confidence: 0.7, reason: 'test' },
            shadow_record_id: 'eval-0',
        };
        appendJsonlRecord(mismatchesPath, mismatchEntry as unknown as Record<string, unknown>);

        const report = generateCanaryReport(testDir);
        assert(report.total === 2, `report total is 2 (got ${report.total})`);
        assert(report.mismatches === 1, `report mismatches is 1 (got ${report.mismatches})`);
        assert(report.breakdown['phase_blocked'] !== undefined, 'breakdown has phase_blocked entry');
        assert(report.breakdown['phase_blocked'].total === 2, `phase_blocked total is 2 (got ${report.breakdown['phase_blocked']?.total})`);
        assert(report.breakdown['phase_blocked'].mismatches === 1, `phase_blocked mismatches is 1 (got ${report.breakdown['phase_blocked']?.mismatches})`);

        // ─── 24. canary_enabled=false — zero impact ───
        console.log('\n[24] canary_enabled=false — zero impact');
        rmSync(projectHarnessDir, { recursive: true, force: true });
        mkdirSync(projectHarnessDir, { recursive: true });

        // Write a simple stub shadow record (what the system normally writes when canary is off)
        const stubRecord: ShadowDecisionRecord = {
            id: 'stub-1',
            kind: 'phase',
            project_key: projectKey,
            timestamp: new Date().toISOString(),
            deterministic: { trigger: 'test', phase_from: 1, phase_to: 2 },
            shadow: { status: 'unavailable', confidence: 0 },
            context: {},
        };
        appendJsonlRecord(shadowPath, stubRecord as unknown as Record<string, unknown>);

        // Canary evaluation should return null when disabled
        const nullResult = evaluateCanary(stubRecord, [], { harness: { canary_enabled: false } });
        assert(nullResult === null, 'canary returns null when disabled');

        // runCanaryEvaluation should also return null
        const runResult = runCanaryEvaluation(testDir, stubRecord, { harness: { canary_enabled: false } });
        assert(runResult === null, 'runCanaryEvaluation returns null when disabled');

        // The stub record should keep its original shadow status
        const stubRecords = readJsonl(shadowPath);
        assert(stubRecords.length === 1, 'only 1 record exists (no canary append)');
        const stubShadow = stubRecords[0].shadow as Record<string, unknown> | undefined;
        assert(stubShadow?.status === 'unavailable', 'stub shadow status is unavailable');
        assert(stubShadow?.confidence === 0, 'stub confidence is 0');

        console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
    } finally {
        rmSync(testDir, { recursive: true, force: true });
        rmSync(projectHarnessDir, { recursive: true, force: true });
    }

    process.exit(failed > 0 ? 1 : 0);
}

void main().catch((err) => {
    console.error(err);
    process.exit(1);
});
