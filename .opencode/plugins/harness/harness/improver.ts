// src/harness/improver.ts — Plugin 3: L5 자가개선 + L6 폐루프
import {
    readFileSync, readdirSync, existsSync, writeFileSync,
    renameSync, unlinkSync, mkdirSync,
} from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import type { Signal, Rule, ProjectState } from '../types.js';
import { HARNESS_DIR, ensureHarnessDirs, getProjectKey, generateId } from '../shared/index.js';

// ─── Helpers ────────────────────────────────────────────

function safeRegexTest(pattern: string, target: string): boolean {
    try {
        return new RegExp(pattern, 'i').test(target);
    } catch {
        return false;
    }
}

function appendHistory(event: string, data: Record<string, unknown>): void {
    const historyPath = join(HARNESS_DIR, 'rules', 'history.jsonl');
    try {
        mkdirSync(join(HARNESS_DIR, 'rules'), { recursive: true });
        writeFileSync(
            historyPath,
            JSON.stringify({ event, timestamp: new Date().toISOString(), ...data }) + '\n',
            { flag: 'a' },
        );
    } catch {
        /* history 기록 실패는 치명적이지 않음 */
    }
}

function loadJsonFiles<T>(dir: string): T[] {
    if (!existsSync(dir)) return [];
    const items: T[] = [];
    for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        try {
            items.push(JSON.parse(readFileSync(join(dir, file), 'utf-8')));
        } catch { /* 파싱 실패한 파일은 무시 */ }
    }
    return items;
}

// ─── 3.2 signalToRule — pending signal → SOFT 규칙 변환 ─

function mapSignalTypeToScope(signalType: Signal['type']): Rule['pattern']['scope'] {
    switch (signalType) {
        case 'error_repeat': return 'tool';
        case 'user_feedback': return 'prompt';
        case 'fix_commit': return 'file';
        case 'violation': return 'tool';
        default: return 'tool';
    }
}

function ruleExists(patternMatch: string, projectKey: string): boolean {
    for (const type of ['soft', 'hard'] as const) {
        const dir = join(HARNESS_DIR, `rules/${type}`);
        if (!existsSync(dir)) continue;
        for (const file of readdirSync(dir)) {
            if (!file.endsWith('.json')) continue;
            try {
                const rule: Rule = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
                if (rule.pattern.match === patternMatch &&
                    (rule.project_key === projectKey || rule.project_key === 'global')) {
                    return true;
                }
            } catch { /* 무시 */ }
        }
    }
    return false;
}

function signalToRule(signal: Signal): void {
    const pattern = signal.payload.pattern || signal.payload.description;
    if (!pattern) return;

    // 중복 체크 (soft + hard 양쪽)
    if (ruleExists(pattern, signal.project_key)) {
        // 중복이면 signal을 ack로만 이동 (규칙 생성 없음)
        return;
    }

    const rule: Rule = {
        id: generateId(),
        type: 'soft',
        project_key: signal.project_key,
        created_at: new Date().toISOString(),
        source_signal_id: signal.id,
        pattern: {
            type: 'code',
            match: pattern,
            scope: mapSignalTypeToScope(signal.type),
        },
        description: signal.payload.description,
        violation_count: 0,
    };

    const rulePath = join(HARNESS_DIR, `rules/soft/${rule.id}.json`);
    mkdirSync(join(HARNESS_DIR, 'rules/soft'), { recursive: true });
    writeFileSync(rulePath, JSON.stringify(rule, null, 2));

    appendHistory('rule_created', {
        rule_id: rule.id,
        signal_id: signal.id,
        pattern: rule.pattern.match,
        scope: rule.pattern.scope,
    });
}

// ─── 3.3 promoteRules — SOFT→HARD 자동 승격 ───────────

function promoteRules(projectKey: string): void {
    const softDir = join(HARNESS_DIR, 'rules/soft');
    const hardDir = join(HARNESS_DIR, 'rules/hard');
    if (!existsSync(softDir)) return;
    mkdirSync(hardDir, { recursive: true });

    for (const file of readdirSync(softDir)) {
        if (!file.endsWith('.json')) continue;
        const filePath = join(softDir, file);
        let rule: Rule;
        try {
            rule = JSON.parse(readFileSync(filePath, 'utf-8'));
        } catch { continue; }

        // 조건: violation_count >= 2 + scope !== 'prompt' + 프로젝트 일치
        if (rule.violation_count < 2) continue;
        if (rule.pattern.scope === 'prompt') continue;
        if (rule.project_key !== projectKey && rule.project_key !== 'global') continue;

        // HARD로 승격
        rule.type = 'hard';
        rule.promoted_at = new Date().toISOString();
        rule.violation_count = 0; // v3 버그 W3 수정: 승격 시 리셋

        const hardPath = join(hardDir, file);
        writeFileSync(hardPath, JSON.stringify(rule, null, 2));
        unlinkSync(filePath); // soft에서 삭제

        appendHistory('rule_promoted', {
            rule_id: rule.id,
            pattern: rule.pattern.match,
            scope: rule.pattern.scope,
            promoted_at: rule.promoted_at,
        });
    }
}

// ─── 3.4 evaluateRuleEffectiveness — 30일 효과 측정 ────

function evaluateRuleEffectiveness(): void {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (const type of ['soft', 'hard'] as const) {
        const dir = join(HARNESS_DIR, `rules/${type}`);
        if (!existsSync(dir)) continue;

        for (const file of readdirSync(dir)) {
            if (!file.endsWith('.json')) continue;
            const filePath = join(dir, file);
            let rule: Rule;
            try {
                rule = JSON.parse(readFileSync(filePath, 'utf-8'));
            } catch { continue; }

            const createdMs = new Date(rule.created_at).getTime();
            if (now - createdMs < THIRTY_DAYS_MS) continue; // 30일 미경과

            // Delta 기반 측정 (v3 버그 W3 수정)
            const lastCount = rule.effectiveness?.recurrence_after_rule || 0;
            const delta = rule.violation_count - (rule.effectiveness?.recurrence_after_rule ?? 0);
            // 더 정확하게: 이전 측정 시점의 violation_count를 기억
            // 첫 측정이면 effectiveness가 없으므로 전체 violation_count가 delta
            const actualDelta = rule.effectiveness
                ? rule.violation_count - lastCount
                : rule.violation_count;

            let status: 'effective' | 'warning' | 'needs_promotion';
            if (actualDelta === 0) {
                status = 'effective';
            } else if (actualDelta >= 2) {
                status = 'needs_promotion';
            } else {
                status = 'warning';
            }

            rule.effectiveness = {
                measured_at: new Date().toISOString(),
                recurrence_after_rule: rule.violation_count, // 다음 측정의 기준점
                status,
            };

            try {
                writeFileSync(filePath, JSON.stringify(rule, null, 2));
            } catch { /* 쓰기 실패 시 다음에 재시도 */ }

            appendHistory('rule_evaluated', {
                rule_id: rule.id,
                type,
                delta: actualDelta,
                status,
            });
        }
    }
}

// ─── 3.5 detectFixCommits — fix: 커밋 감지 (Loop 1) ────

function detectFixCommits(worktree: string, projectKey: string): void {
    // 세션 시작 타임스탬프 읽기
    const startPath = join(HARNESS_DIR, 'logs/sessions', `session_start_${projectKey}.json`);
    if (!existsSync(startPath)) return;

    let startTime: string;
    try {
        const startInfo = JSON.parse(readFileSync(startPath, 'utf-8'));
        startTime = startInfo.timestamp;
    } catch { return; }

    // git log --since로 세션 내 fix: 커밋 조회
    let logOutput: string;
    try {
        logOutput = execSync(
            `git log --since="${startTime}" --format="%H|||%s|||" --name-only --no-merges`,
            { cwd: worktree, encoding: 'utf-8', timeout: 5000 },
        );
    } catch {
        // git 실패 시 조용히 스킵 (non-repo, timeout 등)
        return;
    }

    // 파싱: 커밋 해시|||메시지||| 다음 줄에 파일 목록
    const commits = logOutput.split('\n\n').filter(Boolean);
    for (const block of commits) {
        const lines = block.trim().split('\n');
        const header = lines[0];
        if (!header || !header.includes('|||')) continue;

        const [hash, message] = header.split('|||');
        if (!message || !message.startsWith('fix')) continue;

        const files = lines.slice(1).filter((l) => l.trim().length > 0);
        const firstFile = files[0] || '';

        // fix_commit signal 생성
        const signal: Record<string, unknown> = {
            type: 'fix_commit',
            project_key: projectKey,
            payload: {
                description: `fix 커밋 감지: ${message.trim()}`,
                pattern: firstFile || message.trim(),
                source_file: firstFile,
                recurrence_count: 1,
                related_signals: [hash],
            },
        };

        const id = generateId();
        const signalDir = join(HARNESS_DIR, 'signals/pending');
        mkdirSync(signalDir, { recursive: true });
        writeFileSync(
            join(signalDir, `${id}.json`),
            JSON.stringify({ id, status: 'pending', timestamp: new Date().toISOString(), ...signal }, null, 2),
        );
    }
}

// ─── 3.6 updateProjectState — 프로젝트 상태 갱신 ────────

function updateProjectState(projectKey: string, worktree: string): void {
    const softRules = loadJsonFiles<Rule>(join(HARNESS_DIR, 'rules/soft'))
        .filter((r) => r.project_key === projectKey || r.project_key === 'global');
    const hardRules = loadJsonFiles<Rule>(join(HARNESS_DIR, 'rules/hard'))
        .filter((r) => r.project_key === projectKey || r.project_key === 'global');
    const pendingSignals = loadJsonFiles<Signal>(join(HARNESS_DIR, 'signals/pending'))
        .filter((s) => s.project_key === projectKey);

    const totalRules = softRules.length + hardRules.length;
    const state: ProjectState = {
        project_key: projectKey,
        project_path: worktree,
        soft_rule_count: softRules.length,
        hard_rule_count: hardRules.length,
        pending_signal_count: pendingSignals.length,
        hard_ratio: totalRules > 0 ? hardRules.length / totalRules : 0,
        last_improvement_at: new Date().toISOString(),
        eval_history: [],
    };

    const stateDir = join(HARNESS_DIR, 'projects', projectKey);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, 'state.json'), JSON.stringify(state, null, 2));
}

// ─── 3.7 compacting — 컨텍스트 주입 ────────────────────

function buildCompactionContext(projectKey: string, worktree: string): string[] {
    const parts: string[] = [];

    // Scaffold 주입
    const scaffoldFiles = [
        join(HARNESS_DIR, 'scaffold/global.md'),
        join(HARNESS_DIR, `projects/${projectKey}/scaffold.md`),
    ];
    for (const sf of scaffoldFiles) {
        if (existsSync(sf)) {
            const content = readFileSync(sf, 'utf-8');
            if (content.trim()) {
                parts.push(`[HARNESS SCAFFOLD]\n${content}`);
            }
        }
    }

    // HARD 규칙 설명 주입
    const hardRules = loadJsonFiles<Rule>(join(HARNESS_DIR, 'rules/hard'))
        .filter((r) => r.project_key === projectKey || r.project_key === 'global');
    if (hardRules.length > 0) {
        const descriptions = hardRules.map((r) => `- [HARD] ${r.description} (scope: ${r.pattern.scope})`).join('\n');
        parts.push(`[HARNESS HARD RULES — MUST follow]\n${descriptions}`);
    }

    // SOFT 규칙 설명 주입 (scope:prompt의 유일한 강제 수단)
    const softRules = loadJsonFiles<Rule>(join(HARNESS_DIR, 'rules/soft'))
        .filter((r) => r.project_key === projectKey || r.project_key === 'global');
    if (softRules.length > 0) {
        const descriptions = softRules.map((r) => `- [SOFT] ${r.description} (scope: ${r.pattern.scope})`).join('\n');
        parts.push(`[HARNESS SOFT RULES — recommended]\n${descriptions}`);
    }

    return parts;
}

// ─── 3.1 Main Plugin Export ─────────────────────────────

export const HarnessImprover = async (ctx: { worktree: string }) => {
    ensureHarnessDirs();
    const projectKey = getProjectKey(ctx.worktree);

    return {
        // event 훅: session.idle에서 L5+L6 처리
        event: async ({ event }: { event: { type: string; properties?: Record<string, unknown> } }) => {
            if (event.type !== 'session.idle') return;

            try {
                // Loop 1: fix: 커밋 감지 → fix_commit signal 생성
                detectFixCommits(ctx.worktree, projectKey);
            } catch (err) {
                console.error('[harness] fix commit detection failed:', err);
            }

            // pending signal → SOFT 규칙 변환
            const pendingDir = join(HARNESS_DIR, 'signals/pending');
            const ackDir = join(HARNESS_DIR, 'signals/ack');
            mkdirSync(ackDir, { recursive: true });

            if (existsSync(pendingDir)) {
                const signalFiles = readdirSync(pendingDir).filter((f) => f.endsWith('.json'));
                for (const file of signalFiles) {
                    const filePath = join(pendingDir, file);
                    try {
                        const signal: Signal = JSON.parse(readFileSync(filePath, 'utf-8'));
                        if (signal.project_key !== projectKey) continue;

                        // signal → rule 변환 (중복이면 rule 생성 생략)
                        signalToRule(signal);

                        // signal을 ack로 이동 (idempotent: 재시도해도 안전)
                        renameSync(filePath, join(ackDir, file));
                    } catch (err) {
                        console.error(`[harness] failed to process signal ${file}:`, err);
                    }
                }
            }

            // SOFT → HARD 승격
            promoteRules(projectKey);

            // 30일 효과 측정
            evaluateRuleEffectiveness();

            // 프로젝트 상태 갱신
            updateProjectState(projectKey, ctx.worktree);
        },

        // compacting 훅: scaffold + 규칙 컨텍스트 주입
        'experimental.session.compacting': async (_input: unknown, output: { context: string[] }) => {
            const parts = buildCompactionContext(projectKey, ctx.worktree);
            for (const part of parts) {
                output.context.push(part);
            }
        },
    };
};
