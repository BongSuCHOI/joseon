// test/smoke-test-step4.ts — Step 4 (Orchestration) 통합 스모크 테스트
// 실행: npx tsx test/smoke-test-step4.ts

import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { getPhaseState, transitionPhase, resetPhase } from '../src/orchestrator/phase-manager.js';
import { attemptRecovery } from '../src/orchestrator/error-recovery.js';
import { trackQAFailure } from '../src/orchestrator/qa-tracker.js';
import { createAgents } from '../src/agents/agents.js';
import plugin from '../src/index.js';
import { HARNESS_DIR } from '../src/shared/index.js';

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

// Phase Manager는 worktree 기반 → 임시 디렉토리
const testDir = join(tmpdir(), `step4-integration-test-${Date.now()}`);
const opencodeDir = join(testDir, '.opencode');
const docsDir = join(testDir, 'docs');
mkdirSync(opencodeDir, { recursive: true });
mkdirSync(docsDir, { recursive: true });

// Error Recovery / QA Tracker는 HARNESS_DIR/projects/{key} 기반
const testProjectKey = `test-step4-${Date.now()}`;
const testProjectDir = join(HARNESS_DIR, 'projects', testProjectKey);

try {
    mkdirSync(testProjectDir, { recursive: true });

    console.log('\n========================================');
    console.log('  Step 4 — Orchestration 통합 스모크 테스트');
    console.log('========================================\n');

    // ============================================================
    // 1. Phase Manager Integration (Phase lifecycle)
    // ============================================================
    console.log('--- 1. Phase Manager Integration ---\n');

    // 1-1. 초기 상태 — Phase 1
    console.log('[1-1] 초기 상태');
    const init = getPhaseState(testDir);
    assert(init.current_phase === 1, '초기 current_phase === 1');
    assert(init.phase_history.length === 0, '초기 phase_history 비어있음');

    // 1-2. Phase 1 → 2 전환
    console.log('\n[1-2] Phase 1 → 2 전환');
    const s2 = transitionPhase(testDir, 2);
    assert(s2.current_phase === 2, 'current_phase === 2');
    assert(s2.phase_history.length >= 2, 'phase_history에 2개 이상 항목');

    // 1-3. Phase 2 → 3 차단 (qa-test-plan.md 없음)
    console.log('\n[1-3] Phase 3 진입 차단 (Phase 2.5 gate)');
    let blocked = false;
    try {
        transitionPhase(testDir, 3);
    } catch (err) {
        blocked = (err as Error).message.includes('[ORCHESTRATOR BLOCK]');
    }
    assert(blocked, 'qa-test-plan.md 없으면 Phase 3 진입 차단');

    // 1-4. qa-test-plan.md 생성 후 Phase 3 진입
    console.log('\n[1-4] qa-test-plan.md 생성 후 Phase 3 진입');
    writeFileSync(join(docsDir, 'qa-test-plan.md'), '# QA Test Plan\n');
    const s3 = transitionPhase(testDir, 3);
    assert(s3.current_phase === 3, 'current_phase === 3');
    assert(s3.qa_test_plan_exists === true, 'qa_test_plan_exists === true');

    // 1-5. Phase 3 → 4 전환
    console.log('\n[1-5] Phase 3 → 4 전환');
    const s4 = transitionPhase(testDir, 4);
    assert(s4.current_phase === 4, 'current_phase === 4');

    // 1-6. Phase 4 → 5 전환
    console.log('\n[1-6] Phase 4 → 5 전환');
    const s5 = transitionPhase(testDir, 5);
    assert(s5.current_phase === 5, 'current_phase === 5');

    // 1-7. Phase 리셋
    console.log('\n[1-7] Phase 리셋');
    const reset = resetPhase(testDir);
    assert(reset.current_phase === 1, '리셋: current_phase === 1');
    assert(reset.phase_history.length === 0, '리셋: phase_history 비어있음');

    // ============================================================
    // 2. Error Recovery Integration
    // ============================================================
    console.log('\n--- 2. Error Recovery Integration ---\n');

    // 2-1. Stage 1 에러 복구
    console.log('[2-1] Stage 1 (direct_fix)');
    const err1 = attemptRecovery(testProjectKey, 'TypeError: Cannot read property "x"');
    assert(err1.stage === 1, 'stage === 1');
    assert(err1.action === 'direct_fix', 'action === direct_fix');

    // 2-2. 동일 에러 Stage 2
    console.log('\n[2-2] Stage 2 (structural_change)');
    const err2 = attemptRecovery(testProjectKey, 'TypeError: Cannot read property "x"');
    assert(err2.stage === 2, 'stage === 2');
    assert(err2.action === 'structural_change', 'action === structural_change');

    // 2-3. 동일 에러 Stage 3
    console.log('\n[2-3] Stage 3 (cross_model_rescue)');
    const err3 = attemptRecovery(testProjectKey, 'TypeError: Cannot read property "x"');
    assert(err3.stage === 3, 'stage === 3');
    assert(err3.action === 'cross_model_rescue', 'action === cross_model_rescue');

    // 2-4. error-recovery.jsonl 파일 존재 확인
    console.log('\n[2-4] error-recovery.jsonl 파일 검증');
    const recoveryFilePath = join(testProjectDir, 'error-recovery.jsonl');
    assert(existsSync(recoveryFilePath), 'error-recovery.jsonl 파일 존재');
    if (existsSync(recoveryFilePath)) {
        const lines = readFileSync(recoveryFilePath, 'utf-8').split('\n').filter(Boolean);
        assert(lines.length === 3, `error-recovery.jsonl에 3개 항목 (실제: ${lines.length})`);
        for (let i = 0; i < lines.length; i++) {
            try {
                const parsed = JSON.parse(lines[i]);
                assert(parsed.stage === i + 1, `항목 ${i + 1}: stage === ${i + 1}`);
                assert(parsed.result === 'pending', `항목 ${i + 1}: result === pending`);
            } catch {
                assert(false, `항목 ${i + 1}: JSON 파싱 가능`);
            }
        }
    }

    // ============================================================
    // 3. QA Tracker Integration
    // ============================================================
    console.log('\n--- 3. QA Tracker Integration ---\n');

    // qa-failures.json 사전 정리 (다른 테스트 잔여물 제거)
    const qaPath = join(testProjectDir, 'qa-failures.json');
    try { rmSync(qaPath); } catch { /* 없으면 무시 */ }

    // 3-1. 첫 실패 — T1
    console.log('[3-1] T1 첫 실패 → retry, count 1');
    const qa1 = trackQAFailure(testProjectKey, 'T1', 'Expected 200, got 500');
    assert(qa1.verdict === 'retry', 'T1 첫 실패: verdict === retry');
    assert(qa1.count === 1, 'T1 첫 실패: count === 1');

    // 3-2. 두 번째 실패 — T1
    console.log('\n[3-2] T1 두 번째 실패 → retry, count 2');
    const qa2 = trackQAFailure(testProjectKey, 'T1', 'Expected 200, got 403');
    assert(qa2.verdict === 'retry', 'T1 두 번째: verdict === retry');
    assert(qa2.count === 2, 'T1 두 번째: count === 2');

    // 3-3. 세 번째 실패 — T1 → 에스컬레이션
    console.log('\n[3-3] T1 세 번째 실패 → escalate, count 3');
    const qa3 = trackQAFailure(testProjectKey, 'T1', 'Timeout after 30s');
    assert(qa3.verdict === 'escalate', 'T1 세 번째: verdict === escalate');
    assert(qa3.count === 3, 'T1 세 번째: count === 3');

    // 3-4. 다른 시나리오 T2 — 독립 추적
    console.log('\n[3-4] T2 첫 실패 → 독립 카운트');
    const qa4 = trackQAFailure(testProjectKey, 'T2', 'Email not sent');
    assert(qa4.verdict === 'retry', 'T2 첫 실패: verdict === retry');
    assert(qa4.count === 1, 'T2 첫 실패: count === 1');

    // 3-5. qa-failures.json 구조 검증
    console.log('\n[3-5] qa-failures.json 구조 검증');
    assert(existsSync(qaPath), 'qa-failures.json 파일 존재');
    if (existsSync(qaPath)) {
        const qaData = JSON.parse(readFileSync(qaPath, 'utf-8'));
        assert(qaData['T1'] !== undefined, 'T1 시나리오 존재');
        assert(qaData['T1'].count === 3, 'T1 count === 3');
        assert(qaData['T1'].details.length === 3, 'T1 details에 3개 항목');
        assert(qaData['T2'] !== undefined, 'T2 시나리오 존재');
        assert(qaData['T2'].count === 1, 'T2 count === 1');
        assert(qaData['T2'].details.length === 1, 'T2 details에 1개 항목');
        assert(typeof qaData['T1'].last_failure_at === 'string', 'T1 last_failure_at이 문자열');
        assert(typeof qaData['T2'].last_failure_at === 'string', 'T2 last_failure_at이 문자열');
    }

    // ============================================================
    // 4. Agent Registration Integration
    // ============================================================
    console.log('\n--- 4. Agent Registration Integration ---\n');

    // 4-1. createAgents() 호출 → 9개 에이전트
    console.log('[4-1] createAgents() — 9개 에이전트 반환');
    const agents = createAgents();
    assert(agents.length === 9, `에이전트 9개 (실제: ${agents.length})`);

    // 4-2. 필수 필드 검증
    console.log('\n[4-2] 필수 필드 검증');
    for (const agent of agents) {
        assert(typeof agent.name === 'string' && agent.name.length > 0, `${agent.name}: name 존재`);
        assert(typeof agent.description === 'string' && agent.description.length > 0, `${agent.name}: description 존재`);
        assert(typeof agent.config.prompt === 'string' && agent.config.prompt.length > 0, `${agent.name}: prompt 비어있지 않음`);
        assert(typeof agent.config.temperature === 'number', `${agent.name}: temperature이 숫자`);
        assert(agent.mode === 'primary' || agent.mode === 'subagent', `${agent.name}: mode이 primary|subagent`);
    }

    // 4-3. 에이전트 이름 검증
    console.log('\n[4-3] 에이전트 이름 검증');
    const expectedNames = ['orchestrator', 'builder', 'frontend', 'backend', 'tester', 'reviewer', 'designer', 'explorer', 'librarian'];
    const actualNames = agents.map(a => a.name);
    for (const expected of expectedNames) {
        assert(actualNames.includes(expected), `에이전트 "${expected}" 존재`);
    }

    // 4-4. 모드 검증
    console.log('\n[4-4] 모드 검증');
    const orchestratorAgent = agents.find(a => a.name === 'orchestrator');
    assert(orchestratorAgent?.mode === 'primary', 'orchestrator mode === primary');
    const subagents = agents.filter(a => a.name !== 'orchestrator');
    for (const sub of subagents) {
        assert(sub.mode === 'subagent', `${sub.name} mode === subagent`);
    }

    // 4-5. hidden 에이전트 검증 (all agents visible by default, configurable via harness.jsonc)
    console.log('\n[4-5] hidden 에이전트 검증');
    const visibleExpected = ['frontend', 'backend', 'tester', 'explorer'];
    for (const name of visibleExpected) {
        const agent = agents.find(a => a.name === name);
        assert(agent?.hidden === false, `${name}: hidden === false`);
    }

    // 4-6. reviewer 권한 검증
    console.log('\n[4-6] reviewer 권한 검증');
    const reviewer = agents.find(a => a.name === 'reviewer');
    assert(reviewer?.permission?.file_edit === 'deny', 'reviewer: file_edit === deny');
    assert(reviewer?.hidden === false, 'reviewer: hidden === false');

    // 4-7. designer 온도 검증
    console.log('\n[4-7] designer 온도 검증');
    const designer = agents.find(a => a.name === 'designer');
    assert(designer?.config.temperature === 0.7, 'designer: temperature === 0.7');

    // ============================================================
    // 5. Orchestrator Plugin Integration
    // ============================================================
    console.log('\n--- 5. Orchestrator Plugin Integration ---\n');

    // 5-1. 플러그인 id 검증
    console.log('[5-1] 플러그인 id');
    assert(typeof plugin.id === 'string' && plugin.id.length > 0, `id가 비어있지 않은 문자열: "${plugin.id}"`);

    // 5-2. 플러그인 server 검증
    console.log('\n[5-2] 플러그인 server');
    assert(typeof plugin.server === 'function', 'server가 함수');

    // 5-3. 플러그인 config 검증
    console.log('\n[5-3] 플러그인 config');
    const serverResult = await plugin.server({ project: {}, client: {}, $: {}, directory: process.cwd(), worktree: process.cwd() });
    assert(typeof serverResult.config === 'function', 'config가 함수');
    const testConfig: Record<string, unknown> = {};
    await serverResult.config(testConfig);
    assert(testConfig.default_agent === 'orchestrator', 'default_agent === orchestrator');
    const agentMap = testConfig.agent as Record<string, unknown>;
    assert(agentMap !== undefined && agentMap !== null, 'agent 객체가 설정됨');
    assert(typeof agentMap.orchestrator === 'object', 'orchestrator 에이전트 등록됨');
    assert(typeof agentMap.builder === 'object', 'builder 에이전트 등록됨');
    assert(typeof agentMap.designer === 'object', 'designer 에이전트 등록됨');

    // ============================================================
    // 결과 요약
    // ============================================================
    console.log('\n========================================');
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('========================================\n');
} finally {
    // 정리: 임시 worktree + HARNESS_DIR 하위 테스트 프로젝트
    rmSync(testDir, { recursive: true, force: true });
    rmSync(testProjectDir, { recursive: true, force: true });
}

process.exit(failed > 0 ? 1 : 0);
