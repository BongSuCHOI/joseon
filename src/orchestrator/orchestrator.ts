// src/orchestrator/orchestrator.ts — Plugin 4: 오케스트레이션 통제
// Phase Manager, 에러 복구, QA 추적을 통합하는 플러그인 진입점
import { getPhaseState } from './phase-manager.js';
import { logEvent, getProjectKey, ensureHarnessDirs } from '../shared/index.js';

export const HarnessOrchestrator = async (ctx: { worktree: string }) => {
    ensureHarnessDirs();
    const projectKey = getProjectKey(ctx.worktree);

    return {
        // event 훅: session.idle에서 Phase 정리
        event: async ({ event }: { event: { type: string; properties?: Record<string, unknown> } }) => {
            // session.idle: 미완료 Phase 검사 및 요약 로깅
            if (event.type === 'session.idle') {
                try {
                    const phaseState = getPhaseState(ctx.worktree);
                    // Phase 1이고 history가 비어있으면 로깅 불필요 (활성 Phase 없음)
                    if (phaseState.current_phase > 1 || phaseState.phase_history.length > 0) {
                        logEvent('sessions', 'orchestrator.jsonl', {
                            event: 'phase_summary_on_idle',
                            project_key: projectKey,
                            current_phase: phaseState.current_phase,
                            incomplete_phase: phaseState.incomplete_phase ?? null,
                            history_count: phaseState.phase_history.length,
                        });
                    }
                } catch (err) {
                    console.error('[harness] orchestrator session.idle error:', err);
                }
            }
        },
    };
};
