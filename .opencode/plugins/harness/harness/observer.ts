// src/harness/observer.ts — Plugin 1: L1 관측 + L2 신호 변환
import { writeFileSync } from 'fs';
import { join } from 'path';
import { HARNESS_DIR, ensureHarnessDirs, getProjectKey, logEvent, generateId } from '../shared/index.js';

function emitSignal(signal: Record<string, unknown>): void {
    const id = generateId();
    writeFileSync(
        join(HARNESS_DIR, 'signals/pending', `${id}.json`),
        JSON.stringify({ id, status: 'pending', timestamp: new Date().toISOString(), ...signal }, null, 2),
    );
}

export const HarnessObserver = async (ctx: { worktree: string }) => {
    ensureHarnessDirs();

    const projectKey = getProjectKey(ctx.worktree);
    const errorCounts = new Map<string, number>();

    return {
        // L1: 도구 실행 후 기록 (순수 로깅만 담당)
        'tool.execute.after': async (input: { tool: string; sessionID: string; callID: string; args: unknown }, output: { title: string; output: string }) => {
            const date = new Date().toISOString().slice(0, 10);
            logEvent('tools', `${date}.jsonl`, {
                tool: input.tool,
                args: input.args,
                title: output.title,
                output_preview: typeof output.output === 'string' ? output.output.slice(0, 500) : undefined,
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
            }

            // 세션 완료 로깅
            if (event.type === 'session.idle') {
                logEvent('sessions', `${(event.properties as { sessionID?: string })?.sessionID || 'unknown'}.jsonl`, {
                    event: 'session_idle',
                });
            }

            // L2: 세션 에러 감지 + 반복 에러 카운팅
            if (event.type === 'session.error') {
                const date = new Date().toISOString().slice(0, 10);
                const err = (event.properties as { error?: { message?: string } })?.error;
                const errorInfo = err?.message || String(err) || 'unknown';
                const key = `session_error:${String(errorInfo).slice(0, 100)}`;
                const count = (errorCounts.get(key) || 0) + 1;
                errorCounts.set(key, count);

                logEvent('errors', `${date}.jsonl`, {
                    event: 'session_error',
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
                logEvent('sessions', `current.jsonl`, {
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
