// src/harness/observer.ts — Plugin 1: L1 관측 + L2 신호 변환
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { HARNESS_DIR, ensureHarnessDirs, getProjectKey, logEvent, generateId, logger } from '../shared/index.js';

function emitSignal(signal: Record<string, unknown>): void {
    const id = generateId();
    writeFileSync(
        join(HARNESS_DIR, 'signals/pending', `${id}.json`),
        JSON.stringify({ id, status: 'pending', timestamp: new Date().toISOString(), ...signal }, null, 2),
    );
}

// ── PID 세션 차단 유틸리티 ──

function isProcessRunning(pid: number): boolean {
    try {
        // signal 0 = 생존 확인만 (실제 시그널 전송 없음)
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function acquireSessionLock(projectKey: string): void {
    const lockDir = join(HARNESS_DIR, 'projects', projectKey);
    const lockPath = join(lockDir, '.session-lock');

    if (existsSync(lockPath)) {
        try {
            const lockData = JSON.parse(readFileSync(lockPath, 'utf-8')) as { pid: number; started_at: string };
            if (isProcessRunning(lockData.pid)) {
                logger.warn('observer', 'Session already active', { pid: lockData.pid });
                return;
            }
            // Stale lock — PID가 죽었으므로 교체
        } catch {
            // 손상된 lock 파일 — 교체
        }
    }

    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }, null, 2));
}

function releaseSessionLock(projectKey: string): void {
    const lockPath = join(HARNESS_DIR, 'projects', projectKey, '.session-lock');
    try {
        if (existsSync(lockPath)) {
            unlinkSync(lockPath);
        }
    } catch { /* 정리 실패는 치명적이지 않음 */ }
}

export const HarnessObserver = async (ctx: { worktree: string }) => {
    ensureHarnessDirs();

    const projectKey = getProjectKey(ctx.worktree);
    const errorCounts = new Map<string, number>();

    return {
        // L1: 도구 실행 후 기록 (순수 로깅만 담당)
        'tool.execute.after': async (input: { tool: string; sessionID: string; callID: string; args: unknown }, output?: { title?: string; output?: string }) => {
            const date = new Date().toISOString().slice(0, 10);
            logger.info('observer', 'tool executed', {
                tool: input.tool,
                args: input.args,
                title: output?.title,
                output_preview: typeof output?.output === 'string' ? output.output.slice(0, 500) : undefined,
            });
        },

        // L1 + L2: 이벤트 수신
        event: async ({ event }: { event: { type: string; properties?: Record<string, unknown> } }) => {
            // Step 2: 세션 시작 타임스탬프 기록 (improver의 fix: 커밋 감지에서 사용)
            if (event.type === 'session.created') {
                const sessionID = (event.properties as { sessionID?: string })?.sessionID || 'unknown';
                writeFileSync(
                    join(HARNESS_DIR, 'logs/sessions', `session_start_${projectKey}.json`),
                    JSON.stringify({ timestamp: new Date().toISOString(), sessionID }, null, 2),
                );
                // PID 세션 락 획득
                acquireSessionLock(projectKey);
            }

            // 세션 완료 로깅 + PID 락 해제
            if (event.type === 'session.idle') {
                logger.info('observer', 'session_idle', {
                    event: 'session_idle',
                    sessionID: (event.properties as { sessionID?: string })?.sessionID,
                });
                releaseSessionLock(projectKey);
            }

            // L2: 세션 에러 감지 + 반복 에러 카운팅
            if (event.type === 'session.error') {
                const date = new Date().toISOString().slice(0, 10);
                const err = (event.properties as { error?: { message?: string } })?.error;
                const errorInfo = err?.message || String(err) || 'unknown';
                const key = `session_error:${String(errorInfo).slice(0, 100)}`;
                const count = (errorCounts.get(key) || 0) + 1;
                errorCounts.set(key, count);

                logger.error('observer', 'session_error', {
                    sessionID: (event.properties as { sessionID?: string })?.sessionID,
                    error: errorInfo,
                    repeat_count: count,
                });

                if (count >= 3) {
                    emitSignal({
                        type: 'error_repeat',
                        project_key: getProjectKey(ctx.worktree),
                        payload: {
                            description: `세션 에러 ${count}회 반복: ${String(errorInfo).slice(0, 200)}`,
                            pattern: key,
                            recurrence_count: count,
                        },
                    });
                }
            }

            // 파일 편집 감지 — Step 1에서는 로깅만. Step 2에서 fix: 커밋 학습에 사용.
            if (event.type === 'file.edited') {
                logger.info('observer', 'file_edited', {
                    event: 'file_edited',
                    file: (event.properties as { file?: string })?.file,
                });
            }

            // 사용자 메시지에서 불만 키워드 감지
            if (event.type === 'message.part.updated') {
                const { part } = event.properties as { part: { type: string; text?: string; messageID: string } };
                if (part.type === 'text') {
                    const content = part.text || '';
                    if (typeof content === 'string') {
                        const frustrationKeywords = ['왜이래', '안돼', '또', '이상해', '다시', '안되잖아', '장난해', '에러', '버그', '깨졌어', '제대로'];
                        const found = frustrationKeywords.filter((kw) => content.includes(kw));
                        if (found.length > 0) {
                            emitSignal({
                                type: 'user_feedback',
                                project_key: getProjectKey(ctx.worktree),
                                payload: {
                                    description: `사용자 불만 감지: ${found.join(', ')}`,
                                    pattern: found.join('|'),
                                    recurrence_count: 1,
                                },
                            });
                        }
                    }
                }
            }
        },
    };
};
