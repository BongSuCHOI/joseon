// src/orchestrator/phase-manager.ts — Phase 상태 파일 관리 + Phase 2.5 gate
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { PhaseState, PhaseHistoryEntry, ShadowDecisionRecord } from '../types.js';
import { HARNESS_DIR, appendJsonlRecord, generateId, getProjectKey } from '../shared/index.js';
import { runCanaryEvaluation } from '../harness/canary.js';
import type { HarnessConfig } from '../config/index.js';

const PHASE_FILE_NAME = 'orchestrator-phase.json';

function phaseFilePath(worktree: string): string {
    return join(worktree, '.opencode', PHASE_FILE_NAME);
}

function initialPhaseState(): PhaseState {
    return {
        current_phase: 1,
        phase_history: [],
        qa_test_plan_exists: false,
    };
}

function phaseSignalShadowPath(worktree: string): string {
    return join(HARNESS_DIR, 'projects', getProjectKey(worktree), 'phase-signal-shadow.jsonl');
}

function appendPhaseShadowRecord(worktree: string, currentPhase: number, targetPhase: number, transitionStatus: 'blocked' | 'applied', reason?: string, config?: HarnessConfig): void {
    const record: ShadowDecisionRecord = {
        id: generateId(),
        kind: 'phase',
        project_key: getProjectKey(worktree),
        timestamp: new Date().toISOString(),
        deterministic: {
            trigger: 'transitionPhase',
            phase_from: currentPhase,
            phase_to: targetPhase,
        },
        shadow: {
            status: 'unavailable',
            confidence: 0,
            reason: 'llm_unavailable',
        },
        context: {
            transition_status: transitionStatus,
            ...(reason ? { reason } : {}),
        },
    };

    appendJsonlRecord(phaseSignalShadowPath(worktree), record as unknown as Record<string, unknown>);

    // Step 5f: Run canary evaluation if config provided
    if (config) {
        try {
            runCanaryEvaluation(worktree, record, config);
        } catch {
            // canary failure must not affect deterministic behavior
        }
    }
}

/**
 * Phase 상태 파일을 읽어 반환. 파일 없으면 초기화 후 생성.
 * JSON 파싱 실패 시 Phase 1 폴백.
 */
export function getPhaseState(worktree: string): PhaseState {
    const filePath = phaseFilePath(worktree);

    if (!existsSync(filePath)) {
        const initial = initialPhaseState();
        writeFileSync(filePath, JSON.stringify(initial, null, 2));
        return initial;
    }

    try {
        const raw = readFileSync(filePath, 'utf-8');
        const state = JSON.parse(raw) as PhaseState;

        // 미완료 Phase 감지: 마지막 history entry에 completed_at 없으면
        if (state.phase_history && state.phase_history.length > 0) {
            const lastEntry = state.phase_history[state.phase_history.length - 1];
            if (lastEntry && !lastEntry.completed_at) {
                state.incomplete_phase = lastEntry.phase;
            }
        }

        return state;
    } catch {
        // 손상 파일 → Phase 1 폴백
        const initial = initialPhaseState();
        writeFileSync(filePath, JSON.stringify(initial, null, 2));
        return initial;
    }
}

/**
 * Phase 전환. 이전 Phase completed_at 기록, 새 Phase entered_at 기록.
 * 동일 Phase면 no-op.
 * Phase 2.5 gate: targetPhase === 3일 때 docs/qa-test-plan.md 존재 확인.
 */
export function transitionPhase(worktree: string, targetPhase: number, config?: HarnessConfig): PhaseState {
    const state = getPhaseState(worktree);
    const previousPhase = state.current_phase;

    // 동일 Phase면 no-op
    if (previousPhase === targetPhase) {
        return state;
    }

    // Phase 2.5 gate: Phase 3 진입 전 qa-test-plan.md 확인
    if (targetPhase === 3) {
        const qaPlanPath = join(worktree, 'docs', 'qa-test-plan.md');
        if (!existsSync(qaPlanPath)) {
            appendPhaseShadowRecord(worktree, previousPhase, targetPhase, 'blocked', 'missing_qa_test_plan', config);
            throw new Error(
                `[ORCHESTRATOR BLOCK] Phase 3 진입 불가: docs/qa-test-plan.md가 존재하지 않습니다. ` +
                `Phase 2.5에서 QA 테스트 계획을 먼저 작성하세요.`
            );
        }
        state.qa_test_plan_exists = true;
    }

    const now = new Date().toISOString();

    // 현재 Phase가 history에 없으면 (초기 상태 등) 추가
    const currentPhaseInHistory = state.phase_history.find(e => e.phase === state.current_phase);
    if (!currentPhaseInHistory) {
        state.phase_history.push({
            phase: state.current_phase,
            entered_at: now,  // 알 수 없는 시작 시간이므로 현재로 설정
            completed_at: now,
        });
    } else if (!currentPhaseInHistory.completed_at) {
        // 현재 Phase가 history에 있고 completed_at이 없으면 설정
        currentPhaseInHistory.completed_at = now;
    }

    // 새 Phase history entry 추가
    const newEntry: PhaseHistoryEntry = {
        phase: targetPhase,
        entered_at: now,
    };
    state.phase_history.push(newEntry);
    state.current_phase = targetPhase;

    // incomplete_phase 제거 (방금 새 Phase에 진입했으므로)
    delete state.incomplete_phase;

    appendPhaseShadowRecord(worktree, previousPhase, targetPhase, 'applied', undefined, config);

    const filePath = phaseFilePath(worktree);
    writeFileSync(filePath, JSON.stringify(state, null, 2));

    return state;
}

/**
 * Phase 상태 초기화 (Phase 5 완료 후 호출).
 * current_phase: 1, phase_history: []
 */
export function resetPhase(worktree: string): PhaseState {
    const initial = initialPhaseState();
    const filePath = phaseFilePath(worktree);
    writeFileSync(filePath, JSON.stringify(initial, null, 2));
    return initial;
}
