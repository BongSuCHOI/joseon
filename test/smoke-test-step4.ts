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
import { filterAvailableSkillsBlock } from '../src/hooks/filter-available-skills.js';
import { createForegroundFallbackController, isRetryableModelFailure } from '../src/hooks/foreground-fallback.js';
import { createFilterAvailableSkillsHook } from '../src/hooks/filter-available-skills.js';
import { createForegroundFallbackHook } from '../src/hooks/foreground-fallback.js';

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

async function main(): Promise<void> {
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
    const serverResult = await plugin.server({ project: {}, client: {}, $: {}, directory: process.cwd(), worktree: process.cwd() }) as { config: (config: Record<string, unknown>) => Promise<void> };
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

    // 5-0. deny_tools 통합 테스트 — config 콜백에서 deny_tools가 permission에 병합되는지
    console.log('[5-0] deny_tools → permission 병합 테스트');
    // harness.jsonc에 deny_tools가 설정된 상태에서 플러그인을 로드
    const denyServerResult = await plugin.server({ project: {}, client: {}, $: {}, directory: process.cwd(), worktree: process.cwd() }) as { config: (config: Record<string, unknown>) => Promise<void> };
    const denyConfig: Record<string, unknown> = {};
    await denyServerResult.config(denyConfig);
    const denyAgentMap = denyConfig.agent as Record<string, any>;
    // reviewer: deny_tools: ["write", "edit", "patch", "bash"] + file_edit: "deny"
    assert(denyAgentMap.reviewer?.permission?.write === 'deny', 'deny_tools: reviewer write === deny');
    assert(denyAgentMap.reviewer?.permission?.edit === 'deny', 'deny_tools: reviewer edit === deny');
    assert(denyAgentMap.reviewer?.permission?.patch === 'deny', 'deny_tools: reviewer patch === deny');
    assert(denyAgentMap.reviewer?.permission?.bash === 'deny', 'deny_tools: reviewer bash === deny');
    assert(denyAgentMap.reviewer?.permission?.file_edit === 'deny', 'deny_tools: reviewer 기존 file_edit deny 보존');
    // advisor: deny_tools: ["write", "edit", "patch", "bash"] + file_edit: "deny"
    assert(denyAgentMap.advisor?.permission?.write === 'deny', 'deny_tools: advisor write === deny');
    assert(denyAgentMap.advisor?.permission?.file_edit === 'deny', 'deny_tools: advisor 기존 file_edit deny 보존');
    // designer: deny_tools: ["bash"] (file_edit 없음)
    assert(denyAgentMap.designer?.permission?.bash === 'deny', 'deny_tools: designer bash === deny');
    assert(denyAgentMap.designer?.permission?.write === undefined, 'deny_tools: designer write 제한 없음');
    // builder: deny_tools 없음 → 아무 tool permission 없어야 함
    assert(denyAgentMap.builder?.permission?.write === undefined, 'deny_tools: builder write 제한 없음');
    assert(denyAgentMap.builder?.permission?.bash === undefined, 'deny_tools: builder bash 제한 없음');

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
    // 5B. Stability Follow-up Hooks
    // ============================================================
    console.log('\n--- 5B. Stability Follow-up Hooks ---\n');

    // 5B-1. skill catalog filtering at prompt layer
    console.log('[5B-1] skill catalog filtering');
    const skillPrompt = [
        'prefix',
        '<available_skills>',
        '<skill>',
        '  <name>frontend</name>',
        '  <description>frontend skill</description>',
        '  <location>file:///tmp/frontend</location>',
        '</skill>',
        '<skill>',
        '  <name>backend</name>',
        '  <description>backend skill</description>',
        '  <location>file:///tmp/backend</location>',
        '</skill>',
        '<skill>',
        '  <name>tester</name>',
        '  <description>tester skill</description>',
        '  <location>file:///tmp/tester</location>',
        '</skill>',
        '</available_skills>',
        'suffix',
    ].join('\n');
    const filteredPrompt = filterAvailableSkillsBlock(skillPrompt, ['frontend', '!backend'], ['frontend', 'backend', 'tester']);
    assert(filteredPrompt.includes('frontend skill'), 'skill filter: allowed skill remains');
    assert(!filteredPrompt.includes('backend skill'), 'skill filter: denied skill removed');
    assert(!filteredPrompt.includes('tester skill'), 'skill filter: non-allowed skill removed');
    const emptyPrompt = filterAvailableSkillsBlock(skillPrompt, undefined, ['frontend', 'backend', 'tester']);
    assert(!emptyPrompt.includes('<skill>'), 'skill filter: empty config removes all skills');

    // 5B-2. foreground fallback state tracks reactive session recovery
    console.log('[5B-2] foreground fallback state');
    const fallbackWorktree = join(tmpdir(), `step4-fallback-test-${Date.now()}`);
    mkdirSync(fallbackWorktree, { recursive: true });
    const fallbackController = createForegroundFallbackController(fallbackWorktree);
    fallbackController.recordSession('session-1', 'frontend', ['model-a', 'model-b', 'model-c']);
    assert(fallbackController.resolveModel('frontend', 'model-a', ['model-a', 'model-b', 'model-c']) === 'model-a', 'fallback: initial model selected');
    assert(isRetryableModelFailure('rate limit exceeded') === true, 'fallback: retryable failure detected');
    assert(fallbackController.advanceOnFailure('session-1', 'rate limit exceeded') === true, 'fallback: cursor advanced on retryable failure');
    assert(fallbackController.resolveModel('frontend', 'model-a', ['model-a', 'model-b', 'model-c']) === 'model-b', 'fallback: next model selected on next turn');
    assert(fallbackController.advanceOnFailure('session-1', 'rate limit exceeded') === false, 'fallback: same session advances only once');
    fallbackController.clearSession('session-1');
    const fallbackStateFile = fallbackController.statePath;
    assert(existsSync(fallbackStateFile), 'fallback: state file persisted');
    if (existsSync(fallbackStateFile)) {
        const state = JSON.parse(readFileSync(fallbackStateFile, 'utf-8')) as { agents?: Record<string, { cursor: number; last_failure?: string }> };
        assert(state.agents?.frontend?.cursor === 1, 'fallback: cursor persisted at 1');
        assert(typeof state.agents?.frontend?.last_failure === 'string', 'fallback: failure metadata persisted');
    }
    rmSync(join(HARNESS_DIR, 'projects', fallbackController.projectKey), { recursive: true, force: true });
    rmSync(fallbackWorktree, { recursive: true, force: true });

    const disabledWorktree = join(tmpdir(), `step4-fallback-disabled-${Date.now()}`);
    const disabledController = createForegroundFallbackController(disabledWorktree, false);
    assert(disabledController.resolveModel('frontend', 'model-a', ['model-a', 'model-b']) === 'model-a', 'fallback: disabled keeps primary model');
    disabledController.recordSession('session-disabled', 'frontend', ['model-a', 'model-b']);
    assert(disabledController.advanceOnFailure('session-disabled', 'rate limit exceeded') === false, 'fallback: disabled does not advance');
    rmSync(join(HARNESS_DIR, 'projects', disabledController.projectKey), { recursive: true, force: true });
    rmSync(disabledWorktree, { recursive: true, force: true });

    // 5B-3. foreground fallback reactive session recovery
    console.log('[5B-3] foreground fallback reactive recovery');
    const fallbackRecoveryWorktree = join(tmpdir(), `step4-fallback-recovery-${Date.now()}`);
    mkdirSync(fallbackRecoveryWorktree, { recursive: true });
    const fallbackRecoveryController = createForegroundFallbackController(fallbackRecoveryWorktree);
    const runtimeCalls: Array<{ method: string; args: unknown[] }> = [];
    const runtimeClient = {
        session: {
            messages: [
                {
                    info: { role: 'user', sessionID: 'fallback-session' },
                    parts: [{ type: 'text', text: 'First user message' }],
                },
                {
                    info: { role: 'assistant', sessionID: 'fallback-session' },
                    parts: [{ type: 'text', text: 'Assistant reply' }],
                },
                {
                    info: { role: 'user', sessionID: 'fallback-session' },
                    parts: [{ type: 'text', text: 'Latest user message' }],
                },
            ],
            abort: async (...args: unknown[]) => {
                runtimeCalls.push({ method: 'abort', args });
            },
            prompt_async: async (...args: unknown[]) => {
                runtimeCalls.push({ method: 'prompt_async', args });
            },
        },
    };
    const recoveryAgents = createAgents({
        agents: { frontend: { model: ['model-a', 'model-b', 'model-c'] } },
        fallback: { chains: { frontend: ['model-a', 'model-b', 'model-c'] } },
    });
    const recoveryAgentMap = Object.fromEntries(recoveryAgents.map((agent) => [agent.name, agent]));
    const fallbackRecoveryHook = createForegroundFallbackHook({
        worktree: fallbackRecoveryWorktree,
        agentsByName: recoveryAgentMap as any,
        fallbackEnabled: true,
        client: runtimeClient as any,
    } as any, fallbackRecoveryController);

    await fallbackRecoveryHook['chat.params']({
        sessionID: 'fallback-session',
        agent: 'frontend',
        model: { providerID: 'provider-a', modelID: 'model-a' },
        provider: {},
        message: { id: 'msg-1', sessionID: 'fallback-session', role: 'user', time: { created: Date.now() }, agent: 'frontend', model: { providerID: 'provider-a', modelID: 'model-a' } },
    } as any);
    await fallbackRecoveryHook.event({ event: { type: 'message.updated', properties: { sessionID: 'fallback-session', info: { id: 'msg-2', sessionID: 'fallback-session', role: 'assistant', modelID: 'model-a', providerID: 'provider-a' } } } });
    await fallbackRecoveryHook.event({ event: { type: 'session.status', properties: { sessionID: 'fallback-session', status: 'running', modelID: 'model-a' } } });
    await fallbackRecoveryHook.event({ event: { type: 'session.error', properties: { sessionID: 'fallback-session', error: new Error('rate limit exceeded') } } });

    assert(fallbackRecoveryController.getSessionState('fallback-session')?.currentModel === 'model-b', 'fallback recovery: current model advances to the re-prompted model');
    assert(runtimeCalls.filter((call) => call.method === 'abort').length === 1, 'fallback recovery: abort called once');
    assert(runtimeCalls.filter((call) => call.method === 'prompt_async').length === 1, 'fallback recovery: prompt_async called once');
    assert(runtimeCalls.some((call) => call.method === 'prompt_async' && Array.isArray(call.args) && (() => {
        const payload = call.args[0] as { modelID?: string; model?: { providerID?: string; modelID?: string }; parts?: unknown[] } | undefined;
        return String(payload?.model?.providerID ?? '') === 'provider-a'
            && String(payload?.model?.modelID ?? '') === 'model-b'
            && Array.isArray(payload?.parts)
            && payload?.parts.length === 1
            && typeof (payload.parts[0] as { text?: string } | undefined)?.text === 'string'
            && (payload.parts[0] as { text?: string }).text === 'Latest user message';
    })()), 'fallback recovery: re-prompts next model');
    assert(fallbackRecoveryController.resolveModel('frontend', 'model-a', ['model-a', 'model-b', 'model-c']) === 'model-b', 'fallback recovery: controller advanced to model-b');
    rmSync(join(HARNESS_DIR, 'projects', fallbackRecoveryController.projectKey), { recursive: true, force: true });
    rmSync(fallbackRecoveryWorktree, { recursive: true, force: true });

    // 5B-3a. foreground fallback continues the chain before sync events arrive
    console.log('[5B-3a] foreground fallback chained continuation');
    const chainedFallbackWorktree = join(tmpdir(), `step4-fallback-chained-${Date.now()}`);
    mkdirSync(chainedFallbackWorktree, { recursive: true });
    const chainedFallbackController = createForegroundFallbackController(chainedFallbackWorktree);
    const chainedCalls: Array<{ method: string; args: unknown[] }> = [];
    const chainedRuntimeClient = {
        session: {
            messages: [
                {
                    info: { role: 'user', sessionID: 'chained-session' },
                    parts: [{ type: 'text', text: 'Chained user message' }],
                },
            ],
            abort: async (...args: unknown[]) => {
                chainedCalls.push({ method: 'abort', args });
            },
            prompt_async: async (...args: unknown[]) => {
                chainedCalls.push({ method: 'prompt_async', args });
            },
        },
    };
    const chainedAgents = createAgents({
        agents: { frontend: { model: ['model-a', 'model-b', 'model-c'] } },
        fallback: { chains: { frontend: ['model-a', 'model-b', 'model-c'] } },
    });
    const chainedAgentMap = Object.fromEntries(chainedAgents.map((agent) => [agent.name, agent]));
    const chainedFallbackHook = createForegroundFallbackHook({
        worktree: chainedFallbackWorktree,
        agentsByName: chainedAgentMap as any,
        fallbackEnabled: true,
        client: chainedRuntimeClient as any,
    } as any, chainedFallbackController);

    await chainedFallbackHook['chat.params']({
        sessionID: 'chained-session',
        agent: 'frontend',
        model: { providerID: 'provider-a', modelID: 'model-a' },
        provider: {},
        message: { id: 'msg-chained-1', sessionID: 'chained-session', role: 'user', time: { created: Date.now() }, agent: 'frontend', model: { providerID: 'provider-a', modelID: 'model-a' } },
    } as any);
    await chainedFallbackHook.event({ event: { type: 'session.error', properties: { sessionID: 'chained-session', error: new Error('rate limit exceeded') } } });
    await chainedFallbackHook.event({ event: { type: 'session.error', properties: { sessionID: 'chained-session', error: new Error('rate limit exceeded') } } });

    const chainedPromptCalls = chainedCalls.filter((call) => call.method === 'prompt_async');
    assert(chainedPromptCalls.length === 2, 'fallback chain: second failure re-prompts again before sync events');
    assert(chainedPromptCalls.some((call, index) => index === 1 && Array.isArray(call.args) && (() => {
        const payload = call.args[0] as { model?: { providerID?: string; modelID?: string } } | undefined;
        return String(payload?.model?.providerID ?? '') === 'provider-a' && String(payload?.model?.modelID ?? '') === 'model-c';
    })()), 'fallback chain: second failure advances to model-c');
    assert(chainedFallbackController.resolveModel('frontend', 'model-a', ['model-a', 'model-b', 'model-c']) === 'model-c', 'fallback chain: controller cursor advanced to model-c');
    rmSync(join(HARNESS_DIR, 'projects', chainedFallbackController.projectKey), { recursive: true, force: true });
    rmSync(chainedFallbackWorktree, { recursive: true, force: true });

    // 5B-3b. foreground fallback prompt_async failure must not count as success
    console.log('[5B-3b] foreground fallback prompt_async failure');
    const failedPromptWorktree = join(tmpdir(), `step4-fallback-failed-prompt-${Date.now()}`);
    mkdirSync(failedPromptWorktree, { recursive: true });
    const failedPromptController = createForegroundFallbackController(failedPromptWorktree);
    const failedPromptCalls: Array<{ method: string; args: unknown[] }> = [];
    const failedPromptRuntimeClient = {
        session: {
            messages: [
                {
                    info: { role: 'user', sessionID: 'failed-prompt-session' },
                    parts: [{ type: 'text', text: 'Failed prompt user message' }],
                },
            ],
            abort: async (...args: unknown[]) => {
                failedPromptCalls.push({ method: 'abort', args });
            },
            prompt_async: async (...args: unknown[]) => {
                failedPromptCalls.push({ method: 'prompt_async', args });
                throw new Error('prompt_async unavailable');
            },
        },
    };
    const failedPromptAgents = createAgents({
        agents: { frontend: { model: ['model-a', 'model-b'] } },
        fallback: { chains: { frontend: ['model-a', 'model-b'] } },
    });
    const failedPromptAgentMap = Object.fromEntries(failedPromptAgents.map((agent) => [agent.name, agent]));
    const failedPromptHook = createForegroundFallbackHook({
        worktree: failedPromptWorktree,
        agentsByName: failedPromptAgentMap as any,
        fallbackEnabled: true,
        client: failedPromptRuntimeClient as any,
    } as any, failedPromptController);

    await failedPromptHook['chat.params']({
        sessionID: 'failed-prompt-session',
        agent: 'frontend',
        model: { providerID: 'provider-a', modelID: 'model-a' },
        provider: {},
        message: { id: 'msg-failed-1', sessionID: 'failed-prompt-session', role: 'user', time: { created: Date.now() }, agent: 'frontend', model: { providerID: 'provider-a', modelID: 'model-a' } },
    } as any);
    await failedPromptHook.event({ event: { type: 'session.error', properties: { sessionID: 'failed-prompt-session', error: new Error('rate limit exceeded') } } });

    assert(failedPromptCalls.filter((call) => call.method === 'abort').length === 1, 'fallback failure: abort still attempted');
    assert(failedPromptCalls.filter((call) => call.method === 'prompt_async').length >= 1, 'fallback failure: prompt_async attempted');
    assert(failedPromptController.resolveModel('frontend', 'model-a', ['model-a', 'model-b']) === 'model-a', 'fallback failure: controller does not advance on prompt_async failure');
    assert(existsSync(failedPromptController.statePath) === false, 'fallback failure: no state persisted on failed re-prompt');
    rmSync(join(HARNESS_DIR, 'projects', failedPromptController.projectKey), { recursive: true, force: true });
    rmSync(failedPromptWorktree, { recursive: true, force: true });

    // 5B-3c. foreground fallback method-shaped messages + full model IDs
    console.log('[5B-3c] foreground fallback compatibility shapes');
    const methodFallbackWorktree = join(tmpdir(), `step4-fallback-method-${Date.now()}`);
    mkdirSync(methodFallbackWorktree, { recursive: true });
    const methodFallbackController = createForegroundFallbackController(methodFallbackWorktree);
    const methodCalls: Array<{ method: string; args: unknown[] }> = [];
    const methodRuntimeClient = {
        session: {
            messages: async () => ([
                {
                    info: { role: 'user', sessionID: 'fallback-session-method' },
                    parts: [{ type: 'text', text: 'Method user message' }],
                },
                {
                    info: { role: 'assistant', sessionID: 'fallback-session-method' },
                    parts: [{ type: 'text', text: 'Method assistant reply' }],
                },
                {
                    info: { role: 'user', sessionID: 'fallback-session-method' },
                    parts: [{ type: 'text', text: 'Method latest user message' }],
                },
            ]),
            abort: async (...args: unknown[]) => {
                methodCalls.push({ method: 'abort', args });
            },
            prompt_async: async (...args: unknown[]) => {
                methodCalls.push({ method: 'prompt_async', args });
            },
        },
    };
    const methodAgents = createAgents({
        agents: { frontend: { model: ['provider-a/model-a', 'provider-a/model-b'] } },
        fallback: { chains: { frontend: ['provider-a/model-a', 'provider-a/model-b'] } },
    });
    const methodAgentMap = Object.fromEntries(methodAgents.map((agent) => [agent.name, agent]));
    const methodFallbackHook = createForegroundFallbackHook({
        worktree: methodFallbackWorktree,
        agentsByName: methodAgentMap as any,
        fallbackEnabled: true,
        client: methodRuntimeClient as any,
    } as any, methodFallbackController);

    await methodFallbackHook['chat.params']({
        sessionID: 'fallback-session-method',
        agent: 'frontend',
        model: { providerID: 'provider-a', modelID: 'model-a' },
        provider: {},
        message: { id: 'msg-method-1', sessionID: 'fallback-session-method', role: 'user', time: { created: Date.now() }, agent: 'frontend', model: { providerID: 'provider-a', modelID: 'model-a' } },
    } as any);
    await methodFallbackHook.event({ event: { type: 'session.error', properties: { sessionID: 'fallback-session-method', error: new Error('rate limit exceeded') } } });

    assert(methodCalls.filter((call) => call.method === 'abort').length === 1, 'fallback compatibility: abort called once for method-shaped messages');
    assert(methodCalls.filter((call) => call.method === 'prompt_async').length === 1, 'fallback compatibility: prompt_async called once for method-shaped messages');
    assert(methodCalls.some((call) => call.method === 'prompt_async' && Array.isArray(call.args) && (() => {
        const payload = call.args[0] as { modelID?: string; model?: { providerID?: string; modelID?: string }; parts?: unknown[] } | undefined;
        return String(payload?.model?.providerID ?? '') === 'provider-a'
            && String(payload?.model?.modelID ?? '') === 'model-b'
            && String(payload?.modelID ?? '') === 'model-b'
            && Array.isArray(payload?.parts)
            && payload?.parts.length === 1
            && typeof (payload.parts[0] as { text?: string } | undefined)?.text === 'string'
            && (payload.parts[0] as { text?: string }).text === 'Method latest user message';
    })()), 'fallback compatibility: method messages and full model IDs preserved');
    rmSync(join(HARNESS_DIR, 'projects', methodFallbackController.projectKey), { recursive: true, force: true });
    rmSync(methodFallbackWorktree, { recursive: true, force: true });

    // 5B-4. foreground fallback config path ignores persisted cursor for foreground recovery
    console.log('[5B-4] foreground fallback config path');
    const configFallbackWorktree = join(tmpdir(), `step4-fallback-config-${Date.now()}`);
    mkdirSync(join(configFallbackWorktree, '.opencode'), { recursive: true });
    writeFileSync(join(configFallbackWorktree, '.opencode', 'harness.jsonc'), JSON.stringify({ agents: { frontend: { model: ['model-a', 'model-b'] } } }, null, 2));
    const configFallbackController = createForegroundFallbackController(configFallbackWorktree);
    mkdirSync(join(HARNESS_DIR, 'projects', configFallbackController.projectKey), { recursive: true });
    writeFileSync(join(HARNESS_DIR, 'projects', configFallbackController.projectKey, 'foreground-fallback.json'), JSON.stringify({ agents: { frontend: { cursor: 1, updated_at: new Date().toISOString(), last_session_id: 'stale-session', last_failure: 'rate limit exceeded' } } }, null, 2));
    const pluginInstance = await plugin.server({ project: {}, client: {} as any, $: {} as any, directory: configFallbackWorktree, worktree: configFallbackWorktree } as any);
    const opencodeConfig: Record<string, unknown> = { agent: {} };
    await (pluginInstance as { config: (cfg: Record<string, unknown>) => Promise<void> }).config(opencodeConfig);
    const frontendAgent = (opencodeConfig.agent as Record<string, { model?: string }>).frontend;
    assert(frontendAgent?.model === 'model-a', 'fallback config: persisted cursor does not override current session model');
    rmSync(join(HARNESS_DIR, 'projects', configFallbackController.projectKey), { recursive: true, force: true });
    rmSync(configFallbackWorktree, { recursive: true, force: true });

    // 5B-5. hook lifecycle order
    console.log('[5B-5] hook lifecycle order');
    const lifecycleSkillContext = {
        harnessConfig: {
            agents: {
                frontend: { skills: ['frontend'] },
            },
        },
        sessionAgents: new Map<string, string>(),
    };
    const lifecycleSkillHook = createFilterAvailableSkillsHook(lifecycleSkillContext as any);
    await lifecycleSkillHook['chat.params']({ sessionID: 'skill-session', agent: 'frontend' });
    await lifecycleSkillHook.event({ event: { type: 'session.created', properties: { sessionID: 'skill-session' } } });
    const lifecycleSkillOutput = { system: [skillPrompt] };
    await lifecycleSkillHook['experimental.chat.system.transform']({ sessionID: 'skill-session' }, lifecycleSkillOutput);
    assert(lifecycleSkillOutput.system.join('\n').includes('frontend skill'), 'skill lifecycle: allowed skill survives session.created');
    assert(!lifecycleSkillOutput.system.join('\n').includes('backend skill'), 'skill lifecycle: denied skill removed');

    const lifecycleFallbackWorktree = join(tmpdir(), `step4-fallback-lifecycle-${Date.now()}`);
    mkdirSync(lifecycleFallbackWorktree, { recursive: true });
    const lifecycleAgents = createAgents({
        agents: { frontend: { model: ['model-a', 'model-b'] } },
        fallback: { chains: { frontend: ['model-a', 'model-b'] } },
    });
    const lifecycleAgentMap = Object.fromEntries(lifecycleAgents.map((agent) => [agent.name, agent]));
    const lifecycleFallbackController = createForegroundFallbackController(lifecycleFallbackWorktree, true);
    const lifecycleFallbackHook = createForegroundFallbackHook({ worktree: lifecycleFallbackWorktree, agentsByName: lifecycleAgentMap as any, fallbackEnabled: true, client: {} as any } as any, lifecycleFallbackController);
    await lifecycleFallbackHook['chat.params']({ sessionID: 'fallback-session', agent: 'frontend' });
    await lifecycleFallbackHook.event({ event: { type: 'session.created', properties: { sessionID: 'fallback-session' } } });
    await lifecycleFallbackHook.event({ event: { type: 'session.error', properties: { sessionID: 'fallback-session', error: new Error('rate limit exceeded') } } });
    assert(lifecycleFallbackController.resolveModel('frontend', 'model-a', ['model-a', 'model-b']) === 'model-b', 'fallback lifecycle: session.created does not clear state');
    rmSync(join(HARNESS_DIR, 'projects', lifecycleFallbackController.projectKey), { recursive: true, force: true });
    rmSync(lifecycleFallbackWorktree, { recursive: true, force: true });

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
}

main().catch((err) => { console.error(err); process.exit(1); });
