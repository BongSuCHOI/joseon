// src/__tests__/smoke-phase-manager.ts — Phase Manager 스모크 테스트
// 실행: npx tsx src/__tests__/smoke-phase-manager.ts

import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getPhaseState, transitionPhase, resetPhase } from '../orchestrator/phase-manager.js';

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

// 임시 worktree 생성
const testDir = join(tmpdir(), `phase-test-${Date.now()}`);
const opencodeDir = join(testDir, '.opencode');
const docsDir = join(testDir, 'docs');

mkdirSync(opencodeDir, { recursive: true });
mkdirSync(docsDir, { recursive: true });

try {
    console.log('\n=== Phase Manager Smoke Tests ===\n');

    // 1. 초기 상태 — 파일 없으면 생성
    console.log('[1] 초기 상태');
    const state1 = getPhaseState(testDir);
    assert(state1.current_phase === 1, 'current_phase === 1');
    assert(state1.phase_history.length === 0, 'phase_history is empty');
    assert(state1.qa_test_plan_exists === false, 'qa_test_plan_exists === false');
    assert(existsSync(join(opencodeDir, 'orchestrator-phase.json')), 'phase file created');

    // 2. Phase 전환 1 → 2
    console.log('\n[2] Phase 전환 1 → 2');
    const state2 = transitionPhase(testDir, 2);
    assert(state2.current_phase === 2, 'current_phase === 2');
    assert(state2.phase_history.length === 2, 'phase_history has 2 entries (Phase 1 completed + Phase 2 entered)');
    assert(state2.phase_history[0].phase === 1, 'history[0].phase === 1 (old phase)');
    assert(state2.phase_history[0].completed_at !== undefined, 'history[0] has completed_at');
    // 현재 Phase 2는 history에 entered_at만 있음
    const phase2Entry = state2.phase_history.find(e => e.phase === 2);
    assert(phase2Entry !== undefined, 'Phase 2 entry exists in history');
    assert(phase2Entry!.entered_at !== undefined, 'Phase 2 has entered_at');
    assert(phase2Entry!.completed_at === undefined, 'Phase 2 has no completed_at (current)');

    // 3. 동일 Phase 전환은 no-op
    console.log('\n[3] 동일 Phase 전환 (no-op)');
    const state3 = transitionPhase(testDir, 2);
    assert(state3.current_phase === 2, 'still phase 2');
    assert(state3.phase_history.length === state2.phase_history.length, 'history unchanged');

    // 4. Phase 2.5 gate — qa-test-plan.md 없으면 차단
    console.log('\n[4] Phase 2.5 gate — 차단');
    let blocked = false;
    try {
        transitionPhase(testDir, 3);
    } catch (err) {
        blocked = (err as Error).message.includes('[ORCHESTRATOR BLOCK]');
    }
    assert(blocked, 'Phase 3 blocked without qa-test-plan.md');

    // 5. Phase 2.5 gate — qa-test-plan.md 있으면 통과
    console.log('\n[5] Phase 2.5 gate — 통과');
    writeFileSync(join(docsDir, 'qa-test-plan.md'), '# QA Test Plan\n');
    const state5 = transitionPhase(testDir, 3);
    assert(state5.current_phase === 3, 'current_phase === 3');
    assert(state5.qa_test_plan_exists === true, 'qa_test_plan_exists === true');

    // 6. 미완료 Phase 감지
    console.log('\n[6] 미완료 Phase 감지');
    const state6 = getPhaseState(testDir);
    assert(state6.incomplete_phase === 3, 'incomplete_phase === 3 (Phase 3 has no completed_at)');

    // 7. Phase 리셋
    console.log('\n[7] Phase 리셋');
    const state7 = resetPhase(testDir);
    assert(state7.current_phase === 1, 'reset: current_phase === 1');
    assert(state7.phase_history.length === 0, 'reset: phase_history is empty');
    assert(state7.incomplete_phase === undefined, 'reset: no incomplete_phase');

    // 8. 손상 파일 폴백
    console.log('\n[8] 손상 파일 폴백');
    writeFileSync(join(opencodeDir, 'orchestrator-phase.json'), '{ invalid json');
    const state8 = getPhaseState(testDir);
    assert(state8.current_phase === 1, 'corrupted: falls back to phase 1');
    assert(state8.phase_history.length === 0, 'corrupted: empty history');

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
} finally {
    // 정리
    rmSync(testDir, { recursive: true, force: true });
}

process.exit(failed > 0 ? 1 : 0);
