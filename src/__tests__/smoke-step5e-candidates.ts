// src/__tests__/smoke-step5e-candidates.ts — Step 5e candidate grouping smoke test
// 실행: npx tsx src/__tests__/smoke-step5e-candidates.ts

import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { computePatternIdentity, appendMistakeSummaryShadow } from '../harness/improver.js';
import { HARNESS_DIR, getProjectKey } from '../shared/index.js';
import type { HarnessConfig } from '../config/index.js';

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

const VALID_DIFF = [
    'diff --git a/src/parser/tokenizer.ts b/src/parser/tokenizer.ts',
    '--- a/src/parser/tokenizer.ts',
    '+++ b/src/parser/tokenizer.ts',
    '@@',
    '-const old = true;',
    '+const old = false;',
].join('\n');

const testDir = join(tmpdir(), `step5e-test-${Date.now()}`);
const opencodeDir = join(testDir, '.opencode');

let projectKey = 'unknown';
let projectHarnessDir = '';
let shadowPath = '';
let candidatePath = '';

function cleanProjectFiles(): void {
    rmSync(projectHarnessDir, { recursive: true, force: true });
}

async function main(): Promise<void> {
    mkdirSync(opencodeDir, { recursive: true });
    projectKey = getProjectKey(testDir);
    projectHarnessDir = join(HARNESS_DIR, 'projects', projectKey);
    shadowPath = join(projectHarnessDir, 'mistake-pattern-shadow.jsonl');
    candidatePath = join(projectHarnessDir, 'mistake-pattern-candidates.jsonl');

    try {
        console.log('\n=== Step 5e Candidate Grouping Smoke Tests ===\n');

        // ── (a) Threshold 미만 → candidate 생성 안 됨 ──
        console.log('[a] Below threshold → no candidate created');
        cleanProjectFiles();
        const configThreshold3: HarnessConfig = { harness: { candidate_threshold: 3 } };
        appendMistakeSummaryShadow(projectKey, 'hash_a1', 'fix: null check in parser', ['src/parser/tokenizer.ts'], VALID_DIFF, configThreshold3);
        appendMistakeSummaryShadow(projectKey, 'hash_a2', 'fix: null check in parser', ['src/parser/tokenizer.ts'], VALID_DIFF, configThreshold3);
        const candidatesA = readJsonl(candidatePath);
        assert(!existsSync(candidatePath) || candidatesA.length === 0, 'no candidate when below threshold (2 < 3)');

        // ── (b) Threshold 도달 → candidate 생성 ──
        console.log('\n[b] At threshold → candidate created');
        cleanProjectFiles();
        appendMistakeSummaryShadow(projectKey, 'hash1a', 'fix: null check in parser', ['src/parser/tokenizer.ts'], VALID_DIFF);
        appendMistakeSummaryShadow(projectKey, 'hash1b', 'fix: null check in parser', ['src/parser/tokenizer.ts'], VALID_DIFF);
        appendMistakeSummaryShadow(projectKey, 'hash1c', 'fix: null check in parser', ['src/parser/tokenizer.ts'], VALID_DIFF);
        const candidatesB = readJsonl(candidatePath);
        assert(existsSync(candidatePath) && candidatesB.length >= 1, 'candidate file exists with at least one record');

        // Find the candidate with highest repetition_count (latest update)
        const latestCandidateB = candidatesB.reduce((best, c) =>
            (c.repetition_count as number) > (best.repetition_count as number) ? c : best,
            candidatesB[0],
        );
        assert(latestCandidateB.status === 'pending', 'candidate status is pending');
        assert(
            (latestCandidateB.repetition_count as number) >= 3,
            `candidate repetition_count >= 3 (actual: ${latestCandidateB.repetition_count})`,
        );

        const expectedIdentity = computePatternIdentity('fix: null check in parser', ['src/parser/tokenizer.ts']);
        assert(
            latestCandidateB.pattern_identity === expectedIdentity.identity,
            `candidate pattern_identity matches (actual: ${latestCandidateB.pattern_identity})`,
        );

        // ── (d) 기존 candidate 업데이트 (builds on b, NO cleanup) ──
        console.log('\n[d] Existing candidate updated on 4th commit');
        const candidatesBeforeD = readJsonl(candidatePath);
        const latestBeforeD = candidatesBeforeD.reduce((best, c) =>
            (c.repetition_count as number) > (best.repetition_count as number) ? c : best,
            candidatesBeforeD[0],
        );
        const countBeforeD = latestBeforeD.repetition_count as number;

        const fourthRecord = appendMistakeSummaryShadow(
            projectKey, 'hash_d4', 'fix: null check in parser', ['src/parser/tokenizer.ts'], VALID_DIFF,
        );
        const candidatesAfterD = readJsonl(candidatePath);
        const latestAfterD = candidatesAfterD.reduce((best, c) =>
            (c.repetition_count as number) > (best.repetition_count as number) ? c : best,
            candidatesAfterD[0],
        );
        assert(
            (latestAfterD.repetition_count as number) > countBeforeD,
            `repetition_count increased after 4th commit (before: ${countBeforeD}, after: ${latestAfterD.repetition_count})`,
        );
        assert(
            (latestAfterD.source_shadow_ids as string[]).includes(fourthRecord.id),
            'source_shadow_ids includes the 4th record',
        );

        // ── (c) Ambiguous 제외 (clean slate) ──
        console.log('\n[c] Ambiguous records excluded from candidates');
        cleanProjectFiles();
        // empty diff → no +/- lines → ambiguous
        appendMistakeSummaryShadow(projectKey, 'hash_amb1', 'fix: ambiguous fix', ['src/parser/tokenizer.ts'], '');
        appendMistakeSummaryShadow(projectKey, 'hash_amb2', 'fix: ambiguous fix', ['src/parser/tokenizer.ts'], '');
        appendMistakeSummaryShadow(projectKey, 'hash_amb3', 'fix: ambiguous fix', ['src/parser/tokenizer.ts'], '');
        const shadowRecordsC = readJsonl(shadowPath);
        assert(shadowRecordsC.every((r) => r.ambiguous === true), 'all shadow records are ambiguous');
        const candidatesC = readJsonl(candidatePath);
        assert(candidatesC.length === 0, 'no candidate created for ambiguous records');

        // ── (e) Pattern identity 결정성 ──
        console.log('\n[e] Pattern identity determinism and prefix stripping');
        const id1 = computePatternIdentity('fix: null check in parser', ['src/parser/tokenizer.ts']);
        const id2 = computePatternIdentity('fix: null check in parser', ['src/parser/tokenizer.ts']);
        assert(id1.identity === id2.identity, 'same inputs produce same identity');

        const id3 = computePatternIdentity('fix: null check', ['src/parser/tokenizer.ts']);
        assert(
            id3.keyword !== 'fix',
            `keyword strips 'fix:' prefix (actual keyword: ${id3.keyword})`,
        );

        const id4 = computePatternIdentity('chore(deps): update packages', ['lib/utils.ts']);
        assert(
            id4.keyword !== 'chore',
            `keyword strips 'chore(deps):' prefix (actual keyword: ${id4.keyword})`,
        );

        const id5 = computePatternIdentity('', []);
        assert(
            id5.identity === 'unknown::',
            `empty message+files produces 'unknown::' (actual: ${id5.identity})`,
        );

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
