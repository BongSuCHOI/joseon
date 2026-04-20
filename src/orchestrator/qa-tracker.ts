// src/orchestrator/qa-tracker.ts — QA 시나리오별 실패 추적
import { writeFileSync } from 'fs';
import { join } from 'path';
import { HARNESS_DIR, readJsonFile } from '../shared/index.js';
import type { QAFailures, QAFailureDetail } from '../types.js';
import type { HarnessSettings } from '../config/index.js';
import { DEFAULT_HARNESS_SETTINGS } from '../config/index.js';

export interface QAVerdict {
    verdict: 'retry' | 'escalate';
    count: number;
}

function getQAFailuresPath(projectKey: string): string {
    return join(HARNESS_DIR, 'projects', projectKey, 'qa-failures.json');
}

function readQAFailures(filePath: string): QAFailures {
    return readJsonFile<QAFailures>(filePath, {});
}

/**
 * QA 실패를 기록하고 판정을 반환한다.
 * 동일 시나리오 3회 실패 시 escalate.
 */
export function trackQAFailure(
    projectKey: string,
    scenarioId: string,
    detail: string,
    settings?: HarnessSettings,
): QAVerdict {
    const threshold = settings?.escalation_threshold ?? DEFAULT_HARNESS_SETTINGS.escalation_threshold;
    const filePath = getQAFailuresPath(projectKey);
    const failures = readQAFailures(filePath);
    const now = new Date().toISOString();

    if (!failures[scenarioId]) {
        failures[scenarioId] = {
            count: 0,
            last_failure_at: now,
            details: [],
        };
    }

    const entry = failures[scenarioId];
    entry.count += 1;
    entry.last_failure_at = now;
    entry.details.push({
        timestamp: now,
        message: detail,
    });

    writeFileSync(filePath, JSON.stringify(failures, null, 2));

    const verdict = entry.count >= threshold ? 'escalate' : 'retry';
    return { verdict, count: entry.count };
}
