// test/smoke-test-step4.ts — Step 4 (Orchestration) 통합 스모크 테스트
// 실행: npx tsx test/smoke-test-step4.ts

import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { getPhaseState, transitionPhase, resetPhase } from '../src/orchestrator/phase-manager.js';
import { attemptRecovery } from '../src/orchestrator/error-recovery.js';
import { trackQAFailure } from '../src/orchestrator/qa-tracker.js';
import { createAgents } from '../src/agents/agents.js';
import { SubagentDepthTracker } from '../src/orchestrator/subagent-depth.js';
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

    // 4-1. createAgents() 호출 → 11개 에이전트
    console.log('[4-1] createAgents() — 11개 에이전트 반환');
    const agents = createAgents();
    assert(agents.length === 11, `에이전트 11개 (실제: ${agents.length})`);

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
    const expectedNames = ['orchestrator', 'builder', 'frontend', 'backend', 'tester', 'reviewer', 'designer', 'explorer', 'librarian', 'coder', 'advisor'];
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
    // 4B. Agent Override Extension Tests
    // ============================================================
    console.log('\n--- 4B. Agent Override Extension ---\n');

    // 4B-1. model 배열 (FallbackChain)
    console.log('[4B-1] model 배열 → _modelArray + 첫 모델');
    const chainAgents = createAgents({
        agents: {
            frontend: { model: ['model-a', 'model-b', 'model-c'] },
        },
    });
    const chainFrontend = chainAgents.find(a => a.name === 'frontend')!;
    assert(chainFrontend._modelArray?.length === 3, '_modelArray 길이 === 3');
    assert(chainFrontend._modelArray?.[0] === 'model-a', '_modelArray[0] === model-a');
    assert(chainFrontend.config.model === 'model-a', 'config.model === 첫 번째 모델');

    // 4B-2. ModelEntry 배열
    console.log('\n[4B-2] ModelEntry 배열 → id 추출');
    const entryAgents = createAgents({
        agents: {
            backend: { model: [{ id: 'gpt-5', variant: 'high' }, 'claude-sonnet'] },
        },
    });
    const entryBackend = entryAgents.find(a => a.name === 'backend')!;
    assert(entryBackend._modelArray?.[0] === 'gpt-5', 'ModelEntry: id 추출');
    assert(entryBackend._modelArray?.[1] === 'claude-sonnet', 'ModelEntry + string 혼합');

    // 4B-3. FallbackChain 구성: _modelArray 우선 > fallback.chains
    console.log('\n[4B-3] FallbackChain 구성 (model 배열 우선)');
    const fbAgents1 = createAgents({
        agents: { frontend: { model: ['a', 'b', 'c'] } },
        fallback: { chains: { frontend: ['x', 'y'] } },
    });
    const fbFrontend1 = fbAgents1.find(a => a.name === 'frontend')!;
    assert(JSON.stringify(fbFrontend1._fallbackChain) === JSON.stringify(['a', 'b', 'c']), 'model 배열이 fallback.chains보다 우선');

    // 4B-4. FallbackChain: model 단일 → fallback.chains 사용
    console.log('\n[4B-4] FallbackChain 구성 (fallback.chains 사용)');
    const fbAgents2 = createAgents({
        fallback: { chains: { backend: ['x', 'y'] } },
    });
    const fbBackend2 = fbAgents2.find(a => a.name === 'backend')!;
    assert(JSON.stringify(fbBackend2._fallbackChain) === JSON.stringify(['x', 'y']), 'model 단일 → fallback.chains 사용');

    // 4B-5. FallbackChain: 둘 다 없음 → undefined
    console.log('\n[4B-5] FallbackChain 구성 (둘 다 없음)');
    const noFbAgents = createAgents();
    const noFbFrontend = noFbAgents.find(a => a.name === 'frontend')!;
    assert(noFbFrontend._fallbackChain === undefined, '둘 다 없으면 _fallbackChain === undefined');

    // 4B-6. variant 오버라이드
    console.log('\n[4B-6] variant 오버라이드');
    const variantAgents = createAgents({
        agents: { tester: { variant: 'high' } },
    });
    const variantTester = variantAgents.find(a => a.name === 'tester')!;
    assert(variantTester.config.variant === 'high', 'variant === high');

    // 4B-7. options 오버라이드
    console.log('\n[4B-7] options 오버라이드');
    const optionsAgents = createAgents({
        agents: { coder: { options: { topP: 0.9, maxTokens: 4096 } } },
    });
    const optionsCoder = optionsAgents.find(a => a.name === 'coder')!;
    assert(optionsCoder.config.options?.topP === 0.9, 'options.topP === 0.9');
    assert(optionsCoder.config.options?.maxTokens === 4096, 'options.maxTokens === 4096');

    // 4B-8. prompt 파일 없음 → 기본 프롬프트 유지 (경고만)
    console.log('\n[4B-8] prompt 파일 없음 → 기본 유지');
    const noFileAgents = createAgents({
        agents: { explorer: { prompt: '/nonexistent/prompt.md' } },
    });
    const noFileExplorer = noFileAgents.find(a => a.name === 'explorer')!;
    assert(noFileExplorer.config.prompt.length > 0, '존재하지 않는 프롬프트 파일 → 기본 프롬프트 유지');

    // ============================================================
    // 4C. Permission Auto-Generation Tests (pure function level)
    // ============================================================
    console.log('\n--- 4C. Permission Auto-Generation ---\n');

    // 4C-1. createAgents returns proper structure for permission merge
    console.log('[4C-1] createAgents — permission 필드 구조 검증');
    const permAgents = createAgents();
    const permReviewer = permAgents.find(a => a.name === 'reviewer')!;
    assert(permReviewer.permission?.file_edit === 'deny', 'reviewer: file_edit === deny (기존 permission 유지)');
    const permAdvisor = permAgents.find(a => a.name === 'advisor')!;
    assert(permAdvisor.permission?.file_edit === 'deny', 'advisor: file_edit === deny (기존 permission 유지)');
    const permOrch = permAgents.find(a => a.name === 'orchestrator')!;
    assert(permOrch.permission === undefined, 'orchestrator: permission 없음 (기본값)');

    // 4C-2. config callback — 기본 agent 등록 + default_agent 검증
    console.log('\n[4C-2] config callback — agent 등록 + permission 보존');
    const serverResult = await plugin.server({ project: {}, client: {}, $: {}, directory: process.cwd(), worktree: process.cwd() });
    assert(typeof serverResult.config === 'function', 'config가 함수');
    const cbConfig: Record<string, unknown> = {};
    await serverResult.config(cbConfig);
    const cbAgentMap = cbConfig.agent as Record<string, any>;
    assert(cbAgentMap.reviewer.permission?.file_edit === 'deny', 'config callback: reviewer file_edit deny 보존');
    assert(cbAgentMap.advisor.permission?.file_edit === 'deny', 'config callback: advisor file_edit deny 보존');
    assert(cbConfig.default_agent === 'orchestrator', 'default_agent === orchestrator');

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

    // 5-3. 플러그인 config 검증 (기본 동작은 4C에서 이미 검증)
    console.log('\n[5-3] 플러그인 config — 추가 에이전트 등록 확인');
    const testConfig: Record<string, unknown> = {};
    await serverResult.config(testConfig);
    const agentMap = testConfig.agent as Record<string, unknown>;
    assert(agentMap !== undefined && agentMap !== null, 'agent 객체가 설정됨');
    assert(typeof agentMap.builder === 'object', 'builder 에이전트 등록됨');
    assert(typeof agentMap.designer === 'object', 'designer 에이전트 등록됨');
    assert(typeof agentMap.coder === 'object', 'coder 에이전트 등록됨');
    assert(typeof agentMap.advisor === 'object', 'advisor 에이전트 등록됨');

    // ============================================================
    // 6. Subagent Depth Tracker Tests
    // ============================================================
    console.log('\n--- 6. Subagent Depth Tracker ---\n');

    // 6-1. 기본 깊이 초기값
    console.log('[6-1] 기본 깊이 — 루트는 depth 0');
    const tracker1 = new SubagentDepthTracker();
    assert(tracker1.getDepth('unknown-session') === 0, '알 수 세션 depth === 0');
    assert(tracker1.maxDepth === 3, '기본 maxDepth === 3');

    // 6-2. 자식 등록
    console.log('\n[6-2] 자식 등록 — depth 1');
    const ok = tracker1.registerChild('root', 'child-1');
    assert(ok === true, '첫 자식 등록 성공');
    assert(tracker1.getDepth('child-1') === 1, 'child-1 depth === 1');

    // 6-3. 손자 등록
    console.log('\n[6-3] 손자 등록 — depth 2');
    const ok2 = tracker1.registerChild('child-1', 'grandchild-1');
    assert(ok2 === true, '손자 등록 성공');
    assert(tracker1.getDepth('grandchild-1') === 2, 'grandchild depth === 2');

    // 6-4. depth 3 등록 (max=3이므로 허용)
    console.log('\n[6-4] depth 3 등록 — max=3이므로 허용');
    const ok3 = tracker1.registerChild('grandchild-1', 'greatgrandchild');
    assert(ok3 === true, 'depth 3 등록 성공 (max=3)');
    assert(tracker1.getDepth('greatgrandchild') === 3, 'greatgrandchild depth === 3');

    // 6-4b. depth 4 초과 차단
    console.log('\n[6-4b] max depth 초과 — depth 4 차단');
    const ok3b = tracker1.registerChild('greatgrandchild', 'lvl4');
    assert(ok3b === false, 'depth 4 초과 → 등록 거부');

    // 6-5. cleanup
    console.log('\n[6-5] cleanup');
    tracker1.cleanup('child-1');
    assert(tracker1.getDepth('child-1') === 0, 'cleanup 후 depth === 0');
    assert(tracker1.getDepth('grandchild-1') === 2, '손자는 cleanup 불가 (부모만 cleanup)');

    // 6-6. cleanupAll
    console.log('\n[6-6] cleanupAll');
    tracker1.cleanupAll();
    assert(tracker1.getDepth('grandchild-1') === 0, 'cleanupAll 후 모든 depth === 0');

    // 6-7. 커스텀 max depth
    console.log('\n[6-7] 커스텀 max depth');
    const tracker2 = new SubagentDepthTracker(2);
    assert(tracker2.maxDepth === 2, '커스텀 maxDepth === 2');
    const ok4 = tracker2.registerChild('root', 'c1');
    assert(ok4 === true, 'max=2: depth 1 등록 성공');
    const ok5 = tracker2.registerChild('c1', 'c2');
    assert(ok5 === true, 'max=2: depth 2 등록 성공');
    const ok6 = tracker2.registerChild('c2', 'c3');
    assert(ok6 === false, 'max=2: depth 3 초과 → 등록 거부');

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
