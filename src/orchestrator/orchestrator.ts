// src/orchestrator/orchestrator.ts — Plugin 4: 오케스트레이션 통제
// 에러 복구, QA 추적을 통합하는 플러그인 진입점
import { ensureHarnessDirs } from '../shared/index.js';

export const HarnessOrchestrator = async (_ctx: { worktree: string }) => {
    ensureHarnessDirs();

    return {};
};
