// src/harness/observer.ts — Plugin 1: L1 observation + L2 signal conversion
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { HARNESS_DIR, ensureHarnessDirs, getProjectKey, generateId, logger, appendJsonlRecord } from '../shared/index.js';
import { getHarnessSettings } from '../config/index.js';
import type { HarnessConfig } from '../config/index.js';
import { SubagentDepthTracker } from '../orchestrator/subagent-depth.js';
import { runCanaryEvaluation } from './canary.js';
import type { Signal, ShadowDecisionRecord } from '../types.js';

// --- File-level constants ---
const MAX_ERROR_MESSAGE_LENGTH = 200;
const MAX_ERROR_KEY_LENGTH = 100;
const MAX_OUTPUT_PREVIEW_LENGTH = 500;
const ERROR_REPEAT_THRESHOLD = 3;
const FRUSTRATION_KEYWORDS = ['왜이래', '안돼', '또', '이상해', '다시', '안되잖아', '장난해', '에러', '버그', '깨졌어', '제대로'] as const;

// --- Typed property accessor for event.properties ---
function getProp<T>(event: { properties?: Record<string, unknown> }, key: string): T | undefined {
    return event.properties?.[key] as T | undefined;
}

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
            /* non-fatal — canary failure must not affect deterministic behavior */
        }
    }
}

function emitSignalWithShadow(
    projectKey: string,
    signalType: 'error_repeat' | 'user_feedback',
    shouldEmit: boolean,
    trigger: string,
    context: Record<string, unknown>,
    signalPayload: Signal['payload'] & { project_key: string },
    sessionID?: string,
    config?: HarnessConfig,
    worktree?: string,
): void {
    appendSignalShadowRecord(projectKey, signalType, shouldEmit, trigger, context, sessionID, config, worktree);
    if (shouldEmit) {
        emitSignal({ type: signalType, project_key: projectKey, payload: signalPayload });
    }
}

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false; // non-fatal — process not running
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
            // Corrupted lock file — replace
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
    } catch { /* non-fatal — cleanup failure is not critical */ }
}

function persistSessionStart(projectKey: string, sessionID: string): void {
    const sessionStartPath = join(HARNESS_DIR, 'logs/sessions', `session_start_${projectKey}.json`);
    if (existsSync(sessionStartPath)) {
        try {
            const current = JSON.parse(readFileSync(sessionStartPath, 'utf-8')) as { sessionID?: string };
            if (current?.sessionID === sessionID) return;
        } catch {
            // non-fatal — overwrite malformed file
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
    if (typeof err === 'string') return err.slice(0, MAX_ERROR_MESSAGE_LENGTH);
    if (err instanceof Error) return err.message?.slice(0, MAX_ERROR_MESSAGE_LENGTH) || '';
    const obj = err as Record<string, unknown>;
    if (obj?.message && typeof obj.message === 'string') return obj.message.slice(0, MAX_ERROR_MESSAGE_LENGTH);
    const str = JSON.stringify(err);
    if (str === '{}' || str === '""' || str === '[object Object]') return '';
    return str.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

export const HarnessObserver = async (ctx: { worktree: string; config?: HarnessConfig }) => {
    ensureHarnessDirs();

    const projectKey = getProjectKey(ctx.worktree);
    const errorCounts = new Map<string, number>();
    const harnessSettings = getHarnessSettings(ctx.config);
    const depthTracker = new SubagentDepthTracker(harnessSettings.max_subagent_depth);
    const toolCallCounts = new Map<string, number>();       // key: `${sessionID}::${tool}::${argsFingerprint}`
    const retryCycles = new Map<string, number>();            // key: `${sessionID}::${tool}`
    const fileReadCounts = new Map<string, number>();         // key: `${sessionID}::${filePath}`

    return {
        'tool.execute.after': async (input: { tool: string; sessionID: string; callID: string; args: unknown }, output?: { title?: string; output?: string }) => {
            logger.info('observer', 'tool executed', {
                tool: input.tool,
                args: input.args,
                title: output?.title,
                output_preview: typeof output?.output === 'string' ? output.output.slice(0, MAX_OUTPUT_PREVIEW_LENGTH) : undefined,
            });

            // --- tool_loop detection ---
            const argsFingerprint = JSON.stringify(input.args).slice(0, 200);
            const toolCallKey = `${input.sessionID}::${input.tool}::${argsFingerprint}`;
            const toolCallCount = (toolCallCounts.get(toolCallKey) || 0) + 1;
            toolCallCounts.set(toolCallKey, toolCallCount);
            if (toolCallCount >= harnessSettings.tool_loop_threshold) {
                emitSignal({
                    type: 'tool_loop',
                    project_key: projectKey,
                    session_id: input.sessionID,
                    payload: {
                        description: `Tool '${input.tool}' called ${toolCallCount} times with identical args in session ${input.sessionID}`,
                        tool_name: input.tool,
                        args_fingerprint: argsFingerprint,
                        recurrence_count: toolCallCount,
                    },
                });
                toolCallCounts.delete(toolCallKey);
            }

            // --- retry_storm detection ---
            const isToolError = typeof output?.output === 'string' && (output.output.includes('error') || output.output.includes('Error'));
            const retryKey = `${input.sessionID}::${input.tool}`;
            if (isToolError) {
                const retryCount = (retryCycles.get(retryKey) || 0) + 1;
                retryCycles.set(retryKey, retryCount);
                if (retryCount >= harnessSettings.retry_storm_threshold) {
                    emitSignal({
                        type: 'retry_storm',
                        project_key: projectKey,
                        session_id: input.sessionID,
                        payload: {
                            description: `Tool '${input.tool}' retried ${retryCount} times with errors in session ${input.sessionID}`,
                            tool_name: input.tool,
                            recurrence_count: retryCount,
                        },
                    });
                    retryCycles.delete(retryKey);
                }
            } else {
                retryCycles.delete(retryKey);
            }

            // --- excessive_read detection ---
            const readLikeTools = ['Read', 'Glob', 'Grep'];
            if (readLikeTools.includes(input.tool)) {
                const args = input.args as Record<string, unknown> | null | undefined;
                const filePath = (typeof args?.filePath === 'string' && args.filePath)
                    || (typeof args?.path === 'string' && args.path)
                    || (typeof args?.pattern === 'string' && args.pattern)
                    || JSON.stringify(input.args).slice(0, 100);
                const readKey = `${input.sessionID}::${filePath}`;
                const readCount = (fileReadCounts.get(readKey) || 0) + 1;
                fileReadCounts.set(readKey, readCount);
                if (readCount >= harnessSettings.excessive_read_threshold) {
                    emitSignal({
                        type: 'excessive_read',
                        project_key: projectKey,
                        session_id: input.sessionID,
                        payload: {
                            description: `File/resource '${filePath}' read ${readCount} times in session ${input.sessionID}`,
                            file_path: filePath,
                            recurrence_count: readCount,
                        },
                    });
                    fileReadCounts.delete(readKey);
                }
            }
        },

        event: async ({ event }: { event: { type: string; properties?: Record<string, unknown> } }) => {
            if (event.type === 'session.created') {
                const sessionID = getProp<string>(event, 'sessionID') || 'unknown';
                persistSessionStart(projectKey, sessionID);
                acquireSessionLock(projectKey);
                // Clear tracking maps for this session
                for (const key of [...toolCallCounts.keys()].filter(k => k.startsWith(`${sessionID}::`))) {
                    toolCallCounts.delete(key);
                }
                for (const key of [...retryCycles.keys()].filter(k => k.startsWith(`${sessionID}::`))) {
                    retryCycles.delete(key);
                }
                for (const key of [...fileReadCounts.keys()].filter(k => k.startsWith(`${sessionID}::`))) {
                    fileReadCounts.delete(key);
                }
            }

            if (event.type === 'session.updated') {
                const sessionID = getProp<string>(event, 'sessionID');
                if (sessionID) {
                    persistSessionStart(projectKey, sessionID);
                }
            }

            if (event.type === 'subagent.session.created') {
                const childSessionID = getProp<string>(event, 'sessionID');
                const parentSessionID = getProp<string>(event, 'parentSessionID');
                if (childSessionID && parentSessionID) {
                    depthTracker.registerChild(parentSessionID, childSessionID);
                }
            }

            if (event.type === 'session.deleted') {
                const sessionID = getProp<string>(event, 'sessionID');
                if (sessionID) {
                    depthTracker.cleanup(sessionID);
                    // Clear tracking maps for this session
                    for (const key of [...toolCallCounts.keys()].filter(k => k.startsWith(`${sessionID}::`))) {
                        toolCallCounts.delete(key);
                    }
                    for (const key of [...retryCycles.keys()].filter(k => k.startsWith(`${sessionID}::`))) {
                        retryCycles.delete(key);
                    }
                    for (const key of [...fileReadCounts.keys()].filter(k => k.startsWith(`${sessionID}::`))) {
                        fileReadCounts.delete(key);
                    }
                }
            }

            if (event.type === 'session.idle') {
                logger.info('observer', 'session_idle', {
                    event: 'session_idle',
                    sessionID: getProp<string>(event, 'sessionID'),
                });
                releaseSessionLock(projectKey);
            }

            if (event.type === 'session.error') {
                const err = getProp<unknown>(event, 'error');
                const errorInfo = extractErrorMessage(err);
                if (!errorInfo || isUserInterrupt(err)) return;

                const key = `session_error:${errorInfo.slice(0, MAX_ERROR_KEY_LENGTH)}`;
                const count = (errorCounts.get(key) || 0) + 1;
                errorCounts.set(key, count);

                const sessionID = getProp<string>(event, 'sessionID');

                logger.warn('observer', 'session_error', {
                    sessionID,
                    error: errorInfo,
                    repeat_count: count,
                });

                const shouldEmit = count >= ERROR_REPEAT_THRESHOLD;
                emitSignalWithShadow(projectKey, 'error_repeat', shouldEmit, 'session.error', {
                    error: errorInfo,
                    repeat_count: count,
                }, {
                    description: `Session error repeated ${count} times: ${errorInfo.slice(0, MAX_ERROR_MESSAGE_LENGTH)}`,
                    pattern: key,
                    recurrence_count: count,
                    project_key: projectKey,
                }, sessionID, ctx.config, ctx.worktree);
            }

            if (event.type === 'file.edited') {
                logger.info('observer', 'file_edited', {
                    event: 'file_edited',
                    file: getProp<string>(event, 'file'),
                });
            }

            if (event.type === 'message.part.updated') {
                const part = getProp<{ type: string; text?: string; messageID: string }>(event, 'part');
                if (part?.type === 'text') {
                    const content = part.text || '';
                    if (typeof content === 'string') {
                        const found = FRUSTRATION_KEYWORDS.filter((kw) => content.includes(kw));
                        const shouldEmit = found.length > 0;
                        emitSignalWithShadow(projectKey, 'user_feedback', shouldEmit, 'message.part.updated', {
                            matched_keywords: found,
                            message_id: part.messageID,
                        }, {
                            description: `User frustration detected: ${found.join(', ')}`,
                            pattern: found.join('|'),
                            recurrence_count: 1,
                            project_key: projectKey,
                        }, undefined, ctx.config, ctx.worktree);
                    }
                }
            }
        },
    };
};
