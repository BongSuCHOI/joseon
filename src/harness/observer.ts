// src/harness/observer.ts — Plugin 1: L1 관측 + L2 신호 변환
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { HARNESS_DIR, ensureHarnessDirs, getProjectKey, logEvent, generateId, logger, appendJsonlRecord } from '../shared/index.js';
import { getHarnessSettings } from '../config/index.js';
import type { HarnessConfig } from '../config/index.js';
import { SubagentDepthTracker } from '../orchestrator/subagent-depth.js';
import { runCanaryEvaluation } from './canary.js';
import type { Signal, ShadowDecisionRecord } from '../types.js';

function emitSignal(signal: Record<string, unknown>): void {
    const id = generateId();
    writeFileSync(
        join(HARNESS_DIR, 'signals/pending', `${id}.json`),
        JSON.stringify({ id, status: 'pending', timestamp: new Date().toISOString(), ...signal }, null, 2),
    );
}

function phaseSignalShadowPath(projectKey: string): string {
    return join(HARNESS_DIR, 'projects', projectKey, 'phase-signal-shadow.jsonl');
}

function appendSignalShadowRecord(
    projectKey: string,
    signalType: Signal['type'],
    emitted: boolean,
    trigger: string,
    context: Record<string, unknown>,
    sessionID?: string,
    config?: HarnessConfig,
    worktree?: string,
): void {
    const record: ShadowDecisionRecord = {
        id: generateId(),
        kind: 'signal',
        project_key: projectKey,
        session_id: sessionID,
        timestamp: new Date().toISOString(),
        deterministic: {
            trigger,
            signal_type: signalType,
            emitted,
        },
        shadow: {
            status: 'unavailable',
            signal_relevance: 'unknown',
            confidence: 0,
            reason: 'llm_unavailable',
        },
        context,
    };

    appendJsonlRecord(phaseSignalShadowPath(projectKey), record as unknown as Record<string, unknown>);

    // Step 5f: Run canary evaluation if both config and worktree are provided
    if (config && worktree) {
        try {
            runCanaryEvaluation(worktree, record, config);
        } catch {
            // canary failure must not affect deterministic behavior
        }
    }
}

function isProcessRunning(pid: number): boolean {
    try {
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

function persistSessionStart(projectKey: string, sessionID: string): void {
    const sessionStartPath = join(HARNESS_DIR, 'logs/sessions', `session_start_${projectKey}.json`);
    if (existsSync(sessionStartPath)) {
        try {
            const current = JSON.parse(readFileSync(sessionStartPath, 'utf-8')) as { sessionID?: string };
            if (current?.sessionID === sessionID) return;
        } catch {
            // overwrite malformed file
        }
    }

    writeFileSync(
        sessionStartPath,
        JSON.stringify({ timestamp: new Date().toISOString(), sessionID }, null, 2),
    );
}

function isUserInterrupt(err: unknown): boolean {
    if (!err) return false;
    const s = String(err).toLowerCase();
    return s.includes('abort') || s.includes('interrupt') || s.includes('cancelled') || s.includes('user interrupt');
}

function extractErrorMessage(err: unknown): string {
    if (!err) return '';
    if (typeof err === 'string') return err.slice(0, 200);
    if (err instanceof Error) return err.message?.slice(0, 200) || '';
    const obj = err as Record<string, unknown>;
    if (obj?.message && typeof obj.message === 'string') return obj.message.slice(0, 200);
    const str = JSON.stringify(err);
    if (str === '{}' || str === '""' || str === '[object Object]') return '';
    return str.slice(0, 200);
}

export const HarnessObserver = async (ctx: { worktree: string; config?: HarnessConfig }) => {
    ensureHarnessDirs();

    const projectKey = getProjectKey(ctx.worktree);
    const errorCounts = new Map<string, number>();
    const harnessSettings = getHarnessSettings(ctx.config);
    const depthTracker = new SubagentDepthTracker(harnessSettings.max_subagent_depth);

    return {
        'tool.execute.after': async (input: { tool: string; sessionID: string; callID: string; args: unknown }, output?: { title?: string; output?: string }) => {
            const date = new Date().toISOString().slice(0, 10);
            logger.info('observer', 'tool executed', {
                tool: input.tool,
                args: input.args,
                title: output?.title,
                output_preview: typeof output?.output === 'string' ? output.output.slice(0, 500) : undefined,
            });
        },

        event: async ({ event }: { event: { type: string; properties?: Record<string, unknown> } }) => {
            if (event.type === 'session.created') {
                const sessionID = (event.properties as { sessionID?: string })?.sessionID || 'unknown';
                persistSessionStart(projectKey, sessionID);
                acquireSessionLock(projectKey);
            }

            if (event.type === 'session.updated') {
                const sessionID = (event.properties as { sessionID?: string })?.sessionID;
                if (sessionID) {
                    persistSessionStart(projectKey, sessionID);
                }
            }

            if (event.type === 'subagent.session.created') {
                const props = event.properties as { sessionID?: string; parentSessionID?: string } | undefined;
                if (props?.sessionID && props?.parentSessionID) {
                    depthTracker.registerChild(props.parentSessionID, props.sessionID);
                }
            }

            if (event.type === 'session.deleted') {
                const sessionID = (event.properties as { sessionID?: string })?.sessionID;
                if (sessionID) {
                    depthTracker.cleanup(sessionID);
                }
            }

            if (event.type === 'session.idle') {
                logger.info('observer', 'session_idle', {
                    event: 'session_idle',
                    sessionID: (event.properties as { sessionID?: string })?.sessionID,
                });
                releaseSessionLock(projectKey);
            }

            if (event.type === 'session.error') {
                const err = (event.properties as { error?: unknown })?.error;
                const errorInfo = extractErrorMessage(err);
                if (!errorInfo || isUserInterrupt(err)) return;

                const key = `session_error:${errorInfo.slice(0, 100)}`;
                const count = (errorCounts.get(key) || 0) + 1;
                errorCounts.set(key, count);

                logger.warn('observer', 'session_error', {
                    sessionID: (event.properties as { sessionID?: string })?.sessionID,
                    error: errorInfo,
                    repeat_count: count,
                });

                const sessionID = (event.properties as { sessionID?: string })?.sessionID;
                const shouldEmit = count >= 3;
                appendSignalShadowRecord(projectKey, 'error_repeat', shouldEmit, 'session.error', {
                    error: errorInfo,
                    repeat_count: count,
                }, sessionID, ctx.config, ctx.worktree);

                if (shouldEmit) {
                    emitSignal({
                        type: 'error_repeat',
                        project_key: getProjectKey(ctx.worktree),
                        payload: {
                            description: `세션 에러 ${count}회 반복: ${errorInfo.slice(0, 200)}`,
                            pattern: key,
                            recurrence_count: count,
                        },
                    });
                }
            }

            if (event.type === 'file.edited') {
                logger.info('observer', 'file_edited', {
                    event: 'file_edited',
                    file: (event.properties as { file?: string })?.file,
                });
            }

            if (event.type === 'message.part.updated') {
                const { part } = event.properties as { part: { type: string; text?: string; messageID: string } };
                if (part.type === 'text') {
                    const content = part.text || '';
                    if (typeof content === 'string') {
                        const frustrationKeywords = ['왜이래', '안돼', '또', '이상해', '다시', '안되잖아', '장난해', '에러', '버그', '깨졌어', '제대로'];
                        const found = frustrationKeywords.filter((kw) => content.includes(kw));
                        const shouldEmit = found.length > 0;
                        appendSignalShadowRecord(projectKey, 'user_feedback', shouldEmit, 'message.part.updated', {
                            matched_keywords: found,
                            message_id: part.messageID,
                        }, undefined, ctx.config, ctx.worktree);

                        if (shouldEmit) {
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
