import { mkdirSync, appendFileSync, realpathSync, statSync, renameSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import { HARNESS_DIR } from './constants.js';
import { logger } from './logger.js';

export { HARNESS_DIR };

export function getProjectKey(worktree: string): string {
    try {
        const resolved = realpathSync(worktree);
        return createHash('sha256').update(resolved).digest('hex').slice(0, 12);
    } catch {
        return 'unknown';
    }
}

export function ensureHarnessDirs(): void {
    const dirs = [
        join(HARNESS_DIR, 'logs/sessions'),
        join(HARNESS_DIR, 'logs/tools'),
        join(HARNESS_DIR, 'logs/errors'),
        join(HARNESS_DIR, 'signals/pending'),
        join(HARNESS_DIR, 'signals/ack'),
        join(HARNESS_DIR, 'rules/soft'),
        join(HARNESS_DIR, 'rules/hard'),
        join(HARNESS_DIR, 'scaffold'),
        join(HARNESS_DIR, 'memory/archive'),
        join(HARNESS_DIR, 'memory/facts'),
        join(HARNESS_DIR, 'projects'),
        join(HARNESS_DIR, 'metrics/effectiveness'),
    ];
    for (const dir of dirs) {
        mkdirSync(dir, { recursive: true });
    }
}

/**
 * @deprecated Use logger.info() instead. This function redirects to the structured logger.
 */
export function logEvent(category: string, filename: string, data: Record<string, unknown>): void {
    logger.info('legacy', 'logEvent', { ...data, _category: category, _filename: filename });
}

export function generateId(): string {
    return randomUUID();
}

export function rotateHistoryIfNeeded(historyPath: string, maxBytes?: number): void {
    const HISTORY_MAX_BYTES = maxBytes ?? 1048576;
    if (!existsSync(historyPath)) return;
    try {
        const size = statSync(historyPath).size;
        if (size >= HISTORY_MAX_BYTES) {
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const dir = historyPath.slice(0, historyPath.lastIndexOf('/'));
            const baseName = historyPath.slice(historyPath.lastIndexOf('/') + 1);
            const rotatedName = baseName.replace('.jsonl', `-${ts}.jsonl`);
            renameSync(historyPath, join(dir, rotatedName));
        }
    } catch { /* 로테이션 실패는 치명적이지 않음 */ }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventHandler = (...args: any[]) => Promise<void> | void;
type HookObject = Record<string, EventHandler | undefined>;

/**
 * 여러 플러그인이 반환한 hook 객체에서 'event' 키를 병합.
 * 스프레드 연산자로 인해 나중 것이 앞의 것을 덮어쓰는 버그(C1)를 해결.
 * 한 핸들러에서 에러가 나도 나머지는 계속 실행됨.
 */
export function mergeEventHandlers(...hookObjects: HookObject[]): Record<string, EventHandler> {
    const merged: Record<string, Record<string, EventHandler>> = {};

    for (const hooks of hookObjects) {
        for (const [key, handler] of Object.entries(hooks)) {
            if (!handler) continue;
            if (!merged[key]) merged[key] = {};
            // 여러 핸들러를 고유 키로 저장
            merged[key][`${key}_${Object.keys(merged[key]).length}`] = handler;
        }
    }

    const result: Record<string, EventHandler> = {};
    for (const [key, handlers] of Object.entries(merged)) {
        const handlerList = Object.values(handlers);
        if (handlerList.length === 1) {
            result[key] = handlerList[0];
        } else {
            result[key] = async (...args: unknown[]) => {
                for (const handler of handlerList) {
                    try {
                        await handler(...args);
                    } catch (err) {
                        logger.error('shared', 'merged event handler error', {
                            key,
                            error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
                        });
                    }
                }
            };
        }
    }
    return result;
}
