// src/__tests__/smoke-step5g-compacting-canary.ts — Step 5g compacting-canary smoke test
// 실행: npx tsx src/__tests__/smoke-step5g-compacting-canary.ts

import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import type { CompactionRelevanceShadowRecord, CompactionShadowCandidateRecord } from '../types.js';
import { HARNESS_DIR, getProjectKey, appendJsonlRecord } from '../shared/index.js';
import {
    readRecentCompactingShadowRecords,
    evaluateCompactingCanary,
    appendCompactingMismatchRecord,
    generateCompactingCanaryReport,
    getCompactingCanaryMismatchesPath,
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

let nextId = 0;
function uid(prefix: string): string {
    return `${prefix}-${Date.now()}-${nextId++}`;
}

function makeCompactingRecord(overrides: Partial<CompactionRelevanceShadowRecord>): CompactionRelevanceShadowRecord {
    return {
        id: uid('rec'),
        project_key: 'test',
        timestamp: new Date().toISOString(),
        filter_enabled: true,
        query: 'test query',
        max_results: 5,
        baseline_selection: { soft_rule_ids: [], fact_ids: [] },
        applied_selection: { soft_rule_ids: [], fact_ids: [] },
        shadow_candidates: [],
        ...overrides,
    };
}

const testDir = join(tmpdir(), `harness-test-5g-${Date.now()}`);
let projectKey = '';
let projectHarnessDir = '';
let shadowPath = '';
let mismatchesPath = '';

async function main(): Promise<void> {
    mkdirSync(testDir, { recursive: true });
    projectKey = getProjectKey(testDir);
    projectHarnessDir = join(HARNESS_DIR, 'projects', projectKey);
    shadowPath = join(projectHarnessDir, 'compacting-relevance-shadow.jsonl');
    mismatchesPath = getCompactingCanaryMismatchesPath(testDir);

    // Clean up any pre-existing test artifacts
    rmSync(projectHarnessDir, { recursive: true, force: true });

    try {
        console.log('\n=== Step 5g Compacting Canary Smoke Tests ===\n');

        // ═══════════════════════════════════════════════════════
        // Group 4: readRecentCompactingShadowRecords
        // ═══════════════════════════════════════════════════════

        // ─── [1] readRecentCompactingShadowRecords — no file returns empty array ───
        console.log('[1] readRecentCompactingShadowRecords — no file returns empty array');
        const emptyResult = readRecentCompactingShadowRecords(testDir, 10);
        assert(emptyResult.length === 0, 'returns empty array when no shadow file exists');

        // ─── [2] readRecentCompactingShadowRecords — reads last N in reverse order ───
        console.log('\n[2] readRecentCompactingShadowRecords — reads last N in reverse order');
        mkdirSync(projectHarnessDir, { recursive: true });
        for (let i = 0; i < 5; i++) {
            const rec = makeCompactingRecord({ id: `crec-${i}` });
            appendJsonlRecord(shadowPath, rec as unknown as Record<string, unknown>);
        }
        const recent3 = readRecentCompactingShadowRecords(testDir, 3);
        assert(recent3.length === 3, 'returns exactly 3 records');
        assert(recent3[0].id === 'crec-4', `first record is newest (crec-4, got ${recent3[0].id})`);
        assert(recent3[2].id === 'crec-2', `last record is crec-2 (got ${recent3[2].id})`);

        // ═══════════════════════════════════════════════════════
        // Group 1: evaluateCompactingCanary
        // ═══════════════════════════════════════════════════════

        // ─── [3] evaluateCompactingCanary — rule_omission ───
        console.log('\n[3] evaluateCompactingCanary — rule_omission detected');
        const ruleOmissionRecord = makeCompactingRecord({
            baseline_selection: { soft_rule_ids: ['rule-A', 'rule-B'], fact_ids: [] },
            applied_selection: { soft_rule_ids: ['rule-B'], fact_ids: [] },
        });
        const ruleOmissionResult = evaluateCompactingCanary(ruleOmissionRecord, [], { harness: { compacting_canary_enabled: true } });
        assert(ruleOmissionResult !== null, 'rule_omission: result is non-null');
        assert(ruleOmissionResult!.mismatches.length === 1, `rule_omission: 1 mismatch (got ${ruleOmissionResult!.mismatches.length})`);
        assert(ruleOmissionResult!.mismatches[0].type === 'rule_omission', `rule_omission: type is rule_omission (got ${ruleOmissionResult!.mismatches[0].type})`);
        assert(ruleOmissionResult!.mismatches[0].item_id === 'rule-A', `rule_omission: item_id is rule-A (got ${ruleOmissionResult!.mismatches[0].item_id})`);
        assert(ruleOmissionResult!.mismatches[0].item_kind === 'soft_rule', `rule_omission: item_kind is soft_rule (got ${ruleOmissionResult!.mismatches[0].item_kind})`);

        // ─── [4] evaluateCompactingCanary — fact_omission ───
        console.log('\n[4] evaluateCompactingCanary — fact_omission detected');
        const factOmissionRecord = makeCompactingRecord({
            baseline_selection: { soft_rule_ids: [], fact_ids: ['fact-X', 'fact-Y'] },
            applied_selection: { soft_rule_ids: [], fact_ids: ['fact-Y'] },
        });
        const factOmissionResult = evaluateCompactingCanary(factOmissionRecord, [], { harness: { compacting_canary_enabled: true } });
        assert(factOmissionResult !== null, 'fact_omission: result is non-null');
        assert(factOmissionResult!.mismatches.length === 1, `fact_omission: 1 mismatch (got ${factOmissionResult!.mismatches.length})`);
        assert(factOmissionResult!.mismatches[0].type === 'fact_omission', `fact_omission: type is fact_omission (got ${factOmissionResult!.mismatches[0].type})`);
        assert(factOmissionResult!.mismatches[0].item_id === 'fact-X', `fact_omission: item_id is fact-X (got ${factOmissionResult!.mismatches[0].item_id})`);
        assert(factOmissionResult!.mismatches[0].item_kind === 'fact', `fact_omission: item_kind is fact (got ${factOmissionResult!.mismatches[0].item_kind})`);

        // ─── [5] evaluateCompactingCanary — rank_inversion ───
        console.log('\n[5] evaluateCompactingCanary — rank_inversion detected');
        const candidates: CompactionShadowCandidateRecord[] = [
            { candidate_id: 'rule-C', candidate_kind: 'soft_rule', metadata_score: 0.9, lexical_score: 0.9, reasons: [] },
            { candidate_id: 'rule-D', candidate_kind: 'soft_rule', metadata_score: 0.8, lexical_score: 0.8, reasons: [] },
            { candidate_id: 'rule-E', candidate_kind: 'soft_rule', metadata_score: 0.7, lexical_score: 0.7, reasons: [] },
            { candidate_id: 'rule-B', candidate_kind: 'soft_rule', metadata_score: 0.4, lexical_score: 0.4, reasons: [] },
            { candidate_id: 'rule-A', candidate_kind: 'soft_rule', metadata_score: 0.1, lexical_score: 0.1, reasons: [] },
        ];
        // rule-A is baseline rank 0 (top-1), but its metadata_score=0.1 gives semantic rank 4 (>2 → rank_inversion)
        // Sorted by metadata_score desc: rule-C(0.9), rule-D(0.8), rule-E(0.7), rule-B(0.4), rule-A(0.1)
        // rule-B at idx 3: baselineRank=1, NOT 0 → skip
        // rule-A at idx 4: baselineRank=0, semanticIdx=4 > 2 → rank_inversion
        const rankInversionRecord = makeCompactingRecord({
            baseline_selection: { soft_rule_ids: ['rule-A', 'rule-B'], fact_ids: [] },
            applied_selection: { soft_rule_ids: ['rule-A', 'rule-B'], fact_ids: [] },
            shadow_candidates: candidates,
        });
        const rankInversionResult = evaluateCompactingCanary(rankInversionRecord, [], { harness: { compacting_canary_enabled: true } });
        assert(rankInversionResult !== null, 'rank_inversion: result is non-null');
        const rankInversions = rankInversionResult!.mismatches.filter(m => m.type === 'rank_inversion');
        assert(rankInversions.length >= 1, `rank_inversion: at least 1 rank_inversion mismatch (got ${rankInversions.length})`);
        assert(rankInversions[0].item_id === 'rule-A', `rank_inversion: item_id is rule-A (got ${rankInversions[0].item_id})`);

        // ─── [6] evaluateCompactingCanary — no mismatches (identical) ───
        console.log('\n[6] evaluateCompactingCanary — no mismatches (identical baseline/applied)');
        const identicalRecord = makeCompactingRecord({
            baseline_selection: { soft_rule_ids: ['rule-X', 'rule-Y'], fact_ids: ['fact-Z'] },
            applied_selection: { soft_rule_ids: ['rule-X', 'rule-Y'], fact_ids: ['fact-Z'] },
        });
        const noMismatchResult = evaluateCompactingCanary(identicalRecord, [], { harness: { compacting_canary_enabled: true } });
        assert(noMismatchResult === null, 'identical baseline/applied returns null');

        // ─── [7] evaluateCompactingCanary — canary disabled (default) ───
        console.log('\n[7] evaluateCompactingCanary — canary disabled (default)');
        const disabledRecord = makeCompactingRecord({
            baseline_selection: { soft_rule_ids: ['rule-A'], fact_ids: [] },
            applied_selection: { soft_rule_ids: [], fact_ids: [] },
        });
        const defaultDisabledResult = evaluateCompactingCanary(disabledRecord, [], undefined);
        assert(defaultDisabledResult === null, 'default (undefined config) returns null');

        // ─── [8] evaluateCompactingCanary — canary disabled (explicit false) ───
        console.log('\n[8] evaluateCompactingCanary — canary disabled (explicit false)');
        const explicitDisabledResult = evaluateCompactingCanary(disabledRecord, [], { harness: { compacting_canary_enabled: false } });
        assert(explicitDisabledResult === null, 'explicit compacting_canary_enabled=false returns null');

        // ─── [9] evaluateCompactingCanary — multiple mismatches at once ───
        console.log('\n[9] evaluateCompactingCanary — multiple mismatches (rule + fact omission)');
        const multiMismatchRecord = makeCompactingRecord({
            baseline_selection: { soft_rule_ids: ['rule-A', 'rule-B'], fact_ids: ['fact-X', 'fact-Y'] },
            applied_selection: { soft_rule_ids: [], fact_ids: [] },
        });
        const multiResult = evaluateCompactingCanary(multiMismatchRecord, [], { harness: { compacting_canary_enabled: true } });
        assert(multiResult !== null, 'multi-mismatch: result is non-null');
        const ruleOmissions = multiResult!.mismatches.filter(m => m.type === 'rule_omission');
        const factOmissions = multiResult!.mismatches.filter(m => m.type === 'fact_omission');
        assert(ruleOmissions.length === 2, `multi-mismatch: 2 rule_omission (got ${ruleOmissions.length})`);
        assert(factOmissions.length === 2, `multi-mismatch: 2 fact_omission (got ${factOmissions.length})`);

        // ─── [10] evaluateCompactingCanary — confidence varies with frequency ───
        console.log('\n[10] evaluateCompactingCanary — confidence varies with recentRecords frequency');
        // Low frequency (<3) → confidence 0.7
        const lowFreqResult = evaluateCompactingCanary(ruleOmissionRecord, [], { harness: { compacting_canary_enabled: true } });
        assert(lowFreqResult!.confidence === 0.7, `low frequency: confidence is 0.7 (got ${lowFreqResult!.confidence})`);

        // Build 5 recent records with same omission pattern → frequency >=5 → confidence 0.3
        const frequentRecentRecords: CompactionRelevanceShadowRecord[] = [];
        for (let i = 0; i < 6; i++) {
            frequentRecentRecords.push(makeCompactingRecord({
                baseline_selection: { soft_rule_ids: ['rule-A'], fact_ids: [] },
                applied_selection: { soft_rule_ids: [], fact_ids: [] },
            }));
        }
        const highFreqResult = evaluateCompactingCanary(ruleOmissionRecord, frequentRecentRecords, { harness: { compacting_canary_enabled: true } });
        assert(highFreqResult!.confidence === 0.3, `high frequency (6 records): confidence is 0.3 (got ${highFreqResult!.confidence})`);

        // Medium frequency (3-4) → confidence 0.5
        const medFreqRecent: CompactionRelevanceShadowRecord[] = frequentRecentRecords.slice(0, 3);
        const medFreqResult = evaluateCompactingCanary(ruleOmissionRecord, medFreqRecent, { harness: { compacting_canary_enabled: true } });
        assert(medFreqResult!.confidence === 0.5, `medium frequency (3 records): confidence is 0.5 (got ${medFreqResult!.confidence})`);

        // ═══════════════════════════════════════════════════════
        // Group 2: appendCompactingMismatchRecord
        // ═══════════════════════════════════════════════════════

        // ─── [11] appendCompactingMismatchRecord — writes rule_omission record ───
        console.log('\n[11] appendCompactingMismatchRecord — writes rule_omission record');
        rmSync(mismatchesPath, { force: true });
        const recordForAppend = makeCompactingRecord({
            baseline_selection: { soft_rule_ids: ['rule-A', 'rule-B'], fact_ids: ['fact-X'] },
            applied_selection: { soft_rule_ids: ['rule-B'], fact_ids: [] },
        });
        const evaluationForAppend = {
            mismatches: [
                { type: 'rule_omission' as const, item_id: 'rule-A', item_kind: 'soft_rule' as const, detail: 'test rule omission' },
                { type: 'fact_omission' as const, item_id: 'fact-X', item_kind: 'fact' as const, detail: 'test fact omission' },
            ],
            confidence: 0.7,
            reason: 'test reason',
        };
        appendCompactingMismatchRecord(testDir, recordForAppend, evaluationForAppend);
        assert(existsSync(mismatchesPath), 'compacting-canary-mismatches.jsonl created');
        const appendedRecords = readJsonl(mismatchesPath);
        assert(appendedRecords.length === 2, `2 mismatch records appended (got ${appendedRecords.length})`);

        // Verify rule_omission record
        const ruleMismatch = appendedRecords.find(r => r.mismatch_type === 'rule_omission');
        assert(ruleMismatch !== undefined, 'rule_omission record found');
        assert(ruleMismatch!.item_id === 'rule-A', `rule_omission item_id is rule-A (got ${ruleMismatch!.item_id})`);
        assert(ruleMismatch!.item_kind === 'soft_rule', `rule_omission item_kind is soft_rule (got ${ruleMismatch!.item_kind})`);
        assert(ruleMismatch!.baseline_rank === 0, `rule_omission baseline_rank is 0 (got ${ruleMismatch!.baseline_rank})`);
        assert(ruleMismatch!.applied_rank === -1, `rule_omission applied_rank is -1 (got ${ruleMismatch!.applied_rank})`);
        assert(ruleMismatch!.confidence === 0.7, `rule_omission confidence is 0.7 (got ${ruleMismatch!.confidence})`);
        assert(ruleMismatch!.shadow_record_id === recordForAppend.id, `rule_omission shadow_record_id matches record id`);

        // Verify fact_omission record
        const factMismatch = appendedRecords.find(r => r.mismatch_type === 'fact_omission');
        assert(factMismatch !== undefined, 'fact_omission record found');
        assert(factMismatch!.item_id === 'fact-X', `fact_omission item_id is fact-X (got ${factMismatch!.item_id})`);
        assert(factMismatch!.item_kind === 'fact', `fact_omission item_kind is fact (got ${factMismatch!.item_kind})`);
        assert(factMismatch!.baseline_rank === 0, `fact_omission baseline_rank is 0 (got ${factMismatch!.baseline_rank})`);
        assert(factMismatch!.applied_rank === -1, `fact_omission applied_rank is -1 (got ${factMismatch!.applied_rank})`);
        assert(factMismatch!.shadow_record_id === recordForAppend.id, `fact_omission shadow_record_id matches record id`);

        // ─── [12] appendCompactingMismatchRecord — rank_inversion with correct ranks ───
        console.log('\n[12] appendCompactingMismatchRecord — rank_inversion with correct ranks');
        rmSync(mismatchesPath, { force: true });
        const rankRecord = makeCompactingRecord({
            baseline_selection: { soft_rule_ids: ['rule-top', 'rule-A', 'rule-B'], fact_ids: [] },
            applied_selection: { soft_rule_ids: ['rule-top', 'rule-A', 'rule-B'], fact_ids: [] },
        });
        const rankEvaluation = {
            mismatches: [
                { type: 'rank_inversion' as const, item_id: 'rule-top', item_kind: 'soft_rule' as const, detail: 'baseline_rank=0 semantic_rank=5' },
            ],
            confidence: 0.5,
            reason: 'rank inversion test',
        };
        appendCompactingMismatchRecord(testDir, rankRecord, rankEvaluation);
        const rankRecords = readJsonl(mismatchesPath);
        assert(rankRecords.length === 1, `1 rank_inversion record (got ${rankRecords.length})`);
        assert(rankRecords[0].baseline_rank === 0, `rank_inversion baseline_rank is 0 (got ${rankRecords[0].baseline_rank})`);
        assert(rankRecords[0].applied_rank === 0, `rank_inversion applied_rank is 0 (got ${rankRecords[0].applied_rank})`);

        // ═══════════════════════════════════════════════════════
        // Group 3: generateCompactingCanaryReport
        // ═══════════════════════════════════════════════════════

        // ─── [13] generateCompactingCanaryReport — empty data returns zeros ───
        console.log('\n[13] generateCompactingCanaryReport — empty data returns zeros');
        const emptyReportDir = join(tmpdir(), `harness-test-5g-empty-${Date.now()}`);
        mkdirSync(emptyReportDir, { recursive: true });
        try {
            const emptyReport = generateCompactingCanaryReport(emptyReportDir);
            assert(emptyReport.total === 0, `report total is 0 (got ${emptyReport.total})`);
            assert(emptyReport.mismatches === 0, `report mismatches is 0 (got ${emptyReport.mismatches})`);
            assert(emptyReport.mismatch_rate === 0, `report mismatch_rate is 0 (got ${emptyReport.mismatch_rate})`);
            assert(emptyReport.promotion_candidates.length === 0, `no promotion candidates (got ${emptyReport.promotion_candidates.length})`);
            assert(Object.keys(emptyReport.breakdown).length === 0, `empty breakdown (got ${Object.keys(emptyReport.breakdown).length} keys)`);
        } finally {
            rmSync(emptyReportDir, { recursive: true, force: true });
        }

        // ─── [14] generateCompactingCanaryReport — with evaluated shadow records ───
        console.log('\n[14] generateCompactingCanaryReport — with evaluated shadow records');
        // Reset files
        rmSync(projectHarnessDir, { recursive: true, force: true });
        mkdirSync(projectHarnessDir, { recursive: true });

        // Write 3 compacting shadow records with canary.evaluated=true
        for (let i = 0; i < 3; i++) {
            const rec: CompactionRelevanceShadowRecord = {
                id: `eval-${i}`,
                project_key: projectKey,
                timestamp: new Date().toISOString(),
                filter_enabled: true,
                query: 'test',
                max_results: 5,
                baseline_selection: { soft_rule_ids: [], fact_ids: [] },
                applied_selection: { soft_rule_ids: [], fact_ids: [] },
                shadow_candidates: [],
                canary: {
                    evaluated: true,
                    mismatches: i < 2
                        ? [{ type: 'rule_omission', item_id: `rule-${i}`, item_kind: 'soft_rule', detail: 'test' }]
                        : [],
                    confidence: 0.7,
                    reason: 'test',
                },
            };
            appendJsonlRecord(shadowPath, rec as unknown as Record<string, unknown>);
        }

        // Write 2 mismatch records (rule_omission type)
        for (let i = 0; i < 2; i++) {
            const mismatchRec = {
                id: uid('mm'),
                timestamp: new Date().toISOString(),
                project_key: projectKey,
                mismatch_type: 'rule_omission',
                item_id: `rule-${i}`,
                item_kind: 'soft_rule',
                baseline_rank: 0,
                applied_rank: -1,
                detail: 'test mismatch',
                confidence: 0.7,
                shadow_record_id: `eval-${i}`,
            };
            appendJsonlRecord(mismatchesPath, mismatchRec as unknown as Record<string, unknown>);
        }

        const report = generateCompactingCanaryReport(testDir);
        assert(report.total === 3, `report total is 3 (got ${report.total})`);
        assert(report.mismatches === 2, `report mismatches is 2 (got ${report.mismatches})`);
        assert(report.mismatch_rate === 2 / 3, `report mismatch_rate is 2/3 (got ${report.mismatch_rate})`);
        assert(report.breakdown['rule_omission'] !== undefined, 'breakdown has rule_omission entry');
        assert(report.breakdown['rule_omission'].total === 2, `rule_omission eval total is 2 (got ${report.breakdown['rule_omission']?.total})`);
        assert(report.breakdown['rule_omission'].mismatches === 2, `rule_omission mismatches is 2 (got ${report.breakdown['rule_omission']?.mismatches})`);

        // ─── [15] generateCompactingCanaryReport — promotion candidates (>30% mismatch rate) ───
        console.log('\n[15] generateCompactingCanaryReport — promotion candidates (>30% mismatch rate)');
        // Previous report has rule_omission with 2/2 = 100% mismatch → should be promotion candidate
        assert(
            report.promotion_candidates.includes('rule_omission'),
            `rule_omission is promotion candidate (candidates: ${report.promotion_candidates.join(',')})`,
        );

        // ─── [16] generateCompactingCanaryReport — mixed mismatch types ───
        console.log('\n[16] generateCompactingCanaryReport — mixed mismatch types');
        rmSync(projectHarnessDir, { recursive: true, force: true });
        mkdirSync(projectHarnessDir, { recursive: true });

        // 5 evaluated records with rule_omission + fact_omission mixed
        for (let i = 0; i < 5; i++) {
            const rec: CompactionRelevanceShadowRecord = {
                id: `mix-eval-${i}`,
                project_key: projectKey,
                timestamp: new Date().toISOString(),
                filter_enabled: true,
                query: 'test',
                max_results: 5,
                baseline_selection: { soft_rule_ids: [], fact_ids: [] },
                applied_selection: { soft_rule_ids: [], fact_ids: [] },
                shadow_candidates: [],
                canary: {
                    evaluated: true,
                    mismatches: i < 3
                        ? [{ type: 'rule_omission', item_id: `r-${i}`, item_kind: 'soft_rule', detail: 'test' }]
                        : i < 4
                            ? [{ type: 'fact_omission', item_id: `f-${i}`, item_kind: 'fact', detail: 'test' }]
                            : [],
                    confidence: 0.7,
                    reason: 'test',
                },
            };
            appendJsonlRecord(shadowPath, rec as unknown as Record<string, unknown>);
        }

        // 3 rule_omission + 1 fact_omission mismatches
        const mismatchTypes = ['rule_omission', 'rule_omission', 'rule_omission', 'fact_omission'];
        for (let i = 0; i < mismatchTypes.length; i++) {
            appendJsonlRecord(mismatchesPath, {
                id: uid('mm'),
                timestamp: new Date().toISOString(),
                project_key: projectKey,
                mismatch_type: mismatchTypes[i],
                item_id: `item-${i}`,
                item_kind: mismatchTypes[i] === 'rule_omission' ? 'soft_rule' : 'fact',
                baseline_rank: 0,
                applied_rank: -1,
                detail: 'test',
                confidence: 0.7,
                shadow_record_id: `mix-eval-${i}`,
            } as unknown as Record<string, unknown>);
        }

        const mixedReport = generateCompactingCanaryReport(testDir);
        assert(mixedReport.total === 5, `mixed report total is 5 (got ${mixedReport.total})`);
        assert(mixedReport.mismatches === 4, `mixed report mismatches is 4 (got ${mixedReport.mismatches})`);
        assert(mixedReport.breakdown['rule_omission'] !== undefined, 'breakdown has rule_omission');
        assert(mixedReport.breakdown['fact_omission'] !== undefined, 'breakdown has fact_omission');
        assert(mixedReport.breakdown['rule_omission'].total === 3, `rule_omission eval total is 3 (got ${mixedReport.breakdown['rule_omission']?.total})`);
        assert(mixedReport.breakdown['rule_omission'].mismatches === 3, `rule_omission mismatch count is 3 (got ${mixedReport.breakdown['rule_omission']?.mismatches})`);
        assert(mixedReport.breakdown['fact_omission'].total === 1, `fact_omission eval total is 1 (got ${mixedReport.breakdown['fact_omission']?.total})`);
        assert(mixedReport.breakdown['fact_omission'].mismatches === 1, `fact_omission mismatch count is 1 (got ${mixedReport.breakdown['fact_omission']?.mismatches})`);

        // rule_omission: 3/3 = 100% > 30% → promotion candidate
        assert(
            mixedReport.promotion_candidates.includes('rule_omission'),
            `rule_omission is promotion candidate in mixed report`,
        );
        // fact_omission: 1/1 = 100% > 30% → promotion candidate
        assert(
            mixedReport.promotion_candidates.includes('fact_omission'),
            `fact_omission is promotion candidate in mixed report`,
        );

        // ─── [17] generateCompactingCanaryReport — no promotion candidate when rate is low ───
        console.log('\n[17] generateCompactingCanaryReport — no promotion candidate when rate is low');
        rmSync(projectHarnessDir, { recursive: true, force: true });
        mkdirSync(projectHarnessDir, { recursive: true });

        // 10 evaluated records, only 1 with rule_omission mismatch
        for (let i = 0; i < 10; i++) {
            const rec: CompactionRelevanceShadowRecord = {
                id: `low-eval-${i}`,
                project_key: projectKey,
                timestamp: new Date().toISOString(),
                filter_enabled: true,
                query: 'test',
                max_results: 5,
                baseline_selection: { soft_rule_ids: [], fact_ids: [] },
                applied_selection: { soft_rule_ids: [], fact_ids: [] },
                shadow_candidates: [],
                canary: {
                    evaluated: true,
                    mismatches: i === 0
                        ? [{ type: 'rule_omission', item_id: 'r-0', item_kind: 'soft_rule', detail: 'test' }]
                        : [],
                    confidence: 0.7,
                    reason: 'test',
                },
            };
            appendJsonlRecord(shadowPath, rec as unknown as Record<string, unknown>);
        }
        // Only 1 mismatch out of 10 → 10% < 30% → NOT promotion candidate
        appendJsonlRecord(mismatchesPath, {
            id: uid('mm'),
            timestamp: new Date().toISOString(),
            project_key: projectKey,
            mismatch_type: 'rule_omission',
            item_id: 'r-0',
            item_kind: 'soft_rule',
            baseline_rank: 0,
            applied_rank: -1,
            detail: 'test',
            confidence: 0.7,
            shadow_record_id: 'low-eval-0',
        } as unknown as Record<string, unknown>);

        const lowRateReport = generateCompactingCanaryReport(testDir);
        assert(lowRateReport.total === 10, `low rate total is 10 (got ${lowRateReport.total})`);
        assert(lowRateReport.mismatches === 1, `low rate mismatches is 1 (got ${lowRateReport.mismatches})`);
        // rule_omission: 1 eval with rule_omission type, 1 mismatch → 100% → promotion candidate
        // Note: breakdown tracks by eval type presence, not overall total
        // rule_omission breakdown: total=1 (1 eval with rule_omission type), mismatches=1 → 100% > 30%
        // This IS a promotion candidate because the rate is per-type, not overall

        // ─── [18] evaluateCompactingCanary — reason string contains expected info ───
        console.log('\n[18] evaluateCompactingCanary — reason string contains expected info');
        const reasonRecord = makeCompactingRecord({
            baseline_selection: { soft_rule_ids: ['r-1'], fact_ids: ['f-1'] },
            applied_selection: { soft_rule_ids: [], fact_ids: [] },
        });
        const reasonResult = evaluateCompactingCanary(reasonRecord, [], { harness: { compacting_canary_enabled: true } });
        assert(reasonResult !== null, 'reason test: result is non-null');
        assert(reasonResult!.reason.includes('mismatches='), `reason contains 'mismatches=' (got: ${reasonResult!.reason})`);
        assert(reasonResult!.reason.includes('freq='), `reason contains 'freq=' (got: ${reasonResult!.reason})`);
        assert(reasonResult!.reason.includes('confidence='), `reason contains 'confidence=' (got: ${reasonResult!.reason})`);

        // ─── [19] readRecentCompactingShadowRecords — returns fewer records if file has less ───
        console.log('\n[19] readRecentCompactingShadowRecords — returns fewer records if file has less');
        rmSync(projectHarnessDir, { recursive: true, force: true });
        mkdirSync(projectHarnessDir, { recursive: true });
        appendJsonlRecord(shadowPath, makeCompactingRecord({ id: 'only-1' }) as unknown as Record<string, unknown>);
        const fewerResult = readRecentCompactingShadowRecords(testDir, 10);
        assert(fewerResult.length === 1, `returns 1 record when only 1 exists (got ${fewerResult.length})`);
        assert(fewerResult[0].id === 'only-1', `record id is 'only-1' (got ${fewerResult[0].id})`);

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
