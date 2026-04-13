// src/__tests__/smoke-error-recovery-qa.ts — 에러 복구 + QA 추적 스모크 테스트
// 실행: npx tsx src/__tests__/smoke-error-recovery-qa.ts

import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// 테스트 대상은 HARNESS_DIR 기반이므로, 임시 HARNESS_DIR 환경에서 실행
// 직접 모듈을 import하여 테스트

import { attemptRecovery } from '../orchestrator/error-recovery.js';
import { trackQAFailure } from '../orchestrator/qa-tracker.js';
import { HARNESS_DIR } from '../shared/index.js';

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

// 임시 프로젝트 디렉토리
const testProjectKey = `test-err-qa-${Date.now()}`;
const testProjectDir = join(HARNESS_DIR, 'projects', testProjectKey);

try {
    mkdirSync(testProjectDir, { recursive: true });

    console.log('\n=== Error Recovery Smoke Tests ===\n');

    // 1. 첫 호출 → stage 1
    console.log('[1] 첫 호출 → stage 1 (direct_fix)');
    const r1 = attemptRecovery(testProjectKey, 'TypeError: Cannot read property');
    assert(r1.stage === 1, 'stage === 1');
    assert(r1.action === 'direct_fix', 'action === direct_fix');

    // 2. 동일 에러 두 번째 → stage 2
    console.log('\n[2] 동일 에러 재시도 → stage 2 (structural_change)');
    const r2 = attemptRecovery(testProjectKey, 'TypeError: Cannot read property');
    assert(r2.stage === 2, 'stage === 2');
    assert(r2.action === 'structural_change', 'action === structural_change');

    // 3. 세 번째 → stage 3
    console.log('\n[3] 세 번째 → stage 3 (cross_model_rescue)');
    const r3 = attemptRecovery(testProjectKey, 'TypeError: Cannot read property');
    assert(r3.stage === 3, 'stage === 3');
    assert(r3.action === 'cross_model_rescue', 'action === cross_model_rescue');

    // 4. 네 번째 → stage 4
    console.log('\n[4] 네 번째 → stage 4 (reset)');
    const r4 = attemptRecovery(testProjectKey, 'TypeError: Cannot read property');
    assert(r4.stage === 4, 'stage === 4');
    assert(r4.action === 'reset', 'action === reset');

    // 5. 다섯 번째 → stage 5 (escalate)
    console.log('\n[5] 다섯 번째 → stage 5 (escalate_to_user)');
    const r5 = attemptRecovery(testProjectKey, 'TypeError: Cannot read property');
    assert(r5.stage === 5, 'stage === 5');
    assert(r5.action === 'escalate_to_user', 'action === escalate_to_user');

    // 6. 다른 에러는 stage 1부터
    console.log('\n[6] 다른 에러 → stage 1 (독립 추적)');
    const r6 = attemptRecovery(testProjectKey, 'ReferenceError: x is not defined');
    assert(r6.stage === 1, 'different error starts at stage 1');
    assert(r6.action === 'direct_fix', 'different error action === direct_fix');

    // 7. 손상된 JSONL → stage 1 폴백
    console.log('\n[7] 손상된 JSONL → stage 1 폴백');
    writeFileSync(join(testProjectDir, 'error-recovery.jsonl'), '{ invalid json\nnot json either\n');
    const r7 = attemptRecovery(testProjectKey, 'NewError: test');
    assert(r7.stage === 1, 'corrupted JSONL falls back to stage 1');

    console.log('\n=== QA Tracker Smoke Tests ===\n');

    // QA failures 파일 정리
    const qaPath = join(testProjectDir, 'qa-failures.json');
    try { rmSync(qaPath); } catch { /* 없으면 무시 */ }

    // 1. 첫 실패 → retry, count 1
    console.log('[1] 첫 실패 → retry, count 1');
    const q1 = trackQAFailure(testProjectKey, 'login-form-validation', 'Expected 200, got 500');
    assert(q1.verdict === 'retry', 'verdict === retry');
    assert(q1.count === 1, 'count === 1');

    // 2. 두 번째 실패 → retry, count 2
    console.log('\n[2] 두 번째 실패 → retry, count 2');
    const q2 = trackQAFailure(testProjectKey, 'login-form-validation', 'Expected 200, got 403');
    assert(q2.verdict === 'retry', 'verdict === retry');
    assert(q2.count === 2, 'count === 2');

    // 3. 세 번째 실패 → escalate, count 3
    console.log('\n[3] 세 번째 실패 → escalate, count 3');
    const q3 = trackQAFailure(testProjectKey, 'login-form-validation', 'Timeout after 30s');
    assert(q3.verdict === 'escalate', 'verdict === escalate');
    assert(q3.count === 3, 'count === 3');

    // 4. 다른 시나리오 독립 추적
    console.log('\n[4] 다른 시나리오 독립 추적');
    const q4 = trackQAFailure(testProjectKey, 'signup-email', 'Email not sent');
    assert(q4.verdict === 'retry', 'different scenario verdict === retry');
    assert(q4.count === 1, 'different scenario count === 1');

    // 5. 파일 생성 확인
    console.log('\n[5] qa-failures.json 파일 존재');
    assert(existsSync(qaPath), 'qa-failures.json exists');

    // 6. 손상된 JSON → 초기화 후 정상 동작
    console.log('\n[6] 손상된 qa-failures.json → 초기화 후 정상 동작');
    writeFileSync(qaPath, '{ corrupt');
    const q6 = trackQAFailure(testProjectKey, 'new-scenario', 'Test failure');
    assert(q6.verdict === 'retry', 'corrupted file resets and works');
    assert(q6.count === 1, 'corrupted file count starts at 1');

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
} finally {
    rmSync(testProjectDir, { recursive: true, force: true });
}

process.exit(failed > 0 ? 1 : 0);
