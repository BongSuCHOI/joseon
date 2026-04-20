// src/orchestrator/error-recovery.ts — 에러 복구 4단계 (5단계 에스컬레이션)
import { appendFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { HARNESS_DIR, MAX_ERROR_SUMMARY_LENGTH } from '../shared/index.js';
import type { HarnessSettings } from '../config/index.js';
import { DEFAULT_HARNESS_SETTINGS } from '../config/index.js';

export interface RecoveryAttempt {
    timestamp: string;
    stage: number;
    action: string;
    error_summary: string;
    result: string;
}

export interface RecoveryStage {
    stage: number;
    action: string;
}

const ACTIONS: Record<number, string> = {
    1: 'direct_fix',
    2: 'structural_change',
    3: 'cross_model_rescue',
    4: 'reset',
    5: 'escalate_to_user',
};

function getRecoveryFilePath(projectKey: string): string {
    return join(HARNESS_DIR, 'projects', projectKey, 'error-recovery.jsonl');
}

/**
 * 동일 error_summary에 대한 마지막 시도 단계를 JSONL에서 찾는다.
 * 파싱 실패 라인은 건너뜀.
 */
function getLastStageForError(filePath: string, errorSummary: string): number {
    if (!existsSync(filePath)) return 0;

    let lastStage = 0;
    try {
        const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
        for (const line of lines) {
            try {
                const attempt = JSON.parse(line) as RecoveryAttempt;
                if (attempt.error_summary === errorSummary) {
                    lastStage = Math.max(lastStage, attempt.stage);
                }
            } catch {
                // 파싱 실패 라인 스킵
            }
        }
    } catch {
        return 0;
    }
    return lastStage;
}

/**
 * 에러 복구 단계를 결정하고 이력에 기록한다.
 * 동일 error_summary에 대해 1→2→3→4→5 순차 진행.
 */
export function attemptRecovery(
    projectKey: string,
    error: string,
    context?: string,
    settings?: HarnessSettings,
): RecoveryStage {
    const maxStages = settings?.max_recovery_stages ?? DEFAULT_HARNESS_SETTINGS.max_recovery_stages;
    const filePath = getRecoveryFilePath(projectKey);
    const errorSummary = error.slice(0, MAX_ERROR_SUMMARY_LENGTH);
    const lastStage = getLastStageForError(filePath, errorSummary);

    // 다음 단계 (최대 5)
    const nextStage = Math.min(lastStage + 1, maxStages);
    const action = ACTIONS[nextStage] || 'escalate_to_user';

    // 이력 기록
    const attempt: RecoveryAttempt = {
        timestamp: new Date().toISOString(),
        stage: nextStage,
        action,
        error_summary: errorSummary,
        result: 'pending',
    };

    try {
        appendFileSync(filePath, JSON.stringify(attempt) + '\n');
    } catch {
        // 기록 실패는 치명적이지 않음
    }

    return { stage: nextStage, action };
}
