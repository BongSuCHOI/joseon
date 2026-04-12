// src/harness/enforcer.ts — Plugin 2: L4 HARD 차단 + SOFT 위반 추적 + scaffold 차단
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Rule } from '../types.js';
import { HARNESS_DIR, ensureHarnessDirs, getProjectKey } from '../shared/index.js';

function loadRules(type: 'soft' | 'hard', projectKey: string): Rule[] {
    const rules: Rule[] = [];
    const dir = join(HARNESS_DIR, `rules/${type}`);
    if (!existsSync(dir)) return rules;

    for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        try {
            const rule: Rule = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
            if (rule.project_key === 'global' || rule.project_key === projectKey) {
                rules.push(rule);
            }
        } catch {
            /* 파싱 실패한 규칙은 무시 */
        }
    }
    return rules;
}

function loadScaffold(projectKey: string): string[] {
    const patterns: string[] = [];
    const globalPath = join(HARNESS_DIR, 'scaffold/global.md');
    if (existsSync(globalPath)) {
        patterns.push(...extractNeverDoPatterns(readFileSync(globalPath, 'utf-8')));
    }
    const projectPath = join(HARNESS_DIR, `projects/${projectKey}/scaffold.md`);
    if (existsSync(projectPath)) {
        patterns.push(...extractNeverDoPatterns(readFileSync(projectPath, 'utf-8')));
    }
    return patterns;
}

function extractNeverDoPatterns(markdown: string): string[] {
    const patterns: string[] = [];
    let inNeverDo = false;
    for (const line of markdown.split('\n')) {
        if (line.includes('NEVER DO')) inNeverDo = true;
        else if (line.startsWith('#')) inNeverDo = false;
        else if (inNeverDo && line.trim().startsWith('-')) {
            patterns.push(line.trim().slice(1).trim());
        }
    }
    return patterns;
}

// SOFT 규칙 위반 시 violation_count 증가 (차단은 하지 않음)
function incrementViolation(rule: Rule): void {
    const filePath = join(HARNESS_DIR, `rules/${rule.type}/${rule.id}.json`);
    try {
        const current: Rule = JSON.parse(readFileSync(filePath, 'utf-8'));
        current.violation_count = (current.violation_count || 0) + 1;
        current.last_violation_at = new Date().toISOString();
        writeFileSync(filePath, JSON.stringify(current, null, 2));
    } catch {
        /* 파일 접근 실패 시 무시 — 다음 세션에서 재시도 */
    }
}

// 정규식 실행을 try-catch로 보호 (잘못된 패턴에 의한 크래시 방지)
// #5: target 길이 제한으로 catastrophic backtracking 완화
const ENFORCER_REGEX_MAX_LENGTH = 10000;

function safeRegexTest(pattern: string, target: string): boolean {
    try {
        const safeTarget = target.length > ENFORCER_REGEX_MAX_LENGTH
            ? target.slice(0, ENFORCER_REGEX_MAX_LENGTH)
            : target;
        return new RegExp(pattern, 'i').test(safeTarget);
    } catch {
        return false;
    }
}

export const HarnessEnforcer = async (ctx: { worktree: string }) => {
    ensureHarnessDirs();

    const projectKey = getProjectKey(ctx.worktree);
    let hardRules = loadRules('hard', projectKey);
    let softRules = loadRules('soft', projectKey);
    let scaffoldPatterns = loadScaffold(projectKey);

    return {
        // 세션 시작 시 규칙 리로드
        event: async ({ event }: { event: { type: string } }) => {
            if (event.type === 'session.created') {
                hardRules = loadRules('hard', projectKey);
                softRules = loadRules('soft', projectKey);
                scaffoldPatterns = loadScaffold(projectKey);
            }
        },

        // L4: 도구 실행 전 규칙 체크
        'tool.execute.before': async (input: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }) => {
            const argsStr = JSON.stringify(output.args || {});

            // === HARD 규칙: 매칭 시 차단 (throw Error) ===
            for (const rule of hardRules) {
                if (rule.pattern.scope === 'tool') {
                    if (safeRegexTest(rule.pattern.match, input.tool) || safeRegexTest(rule.pattern.match, argsStr)) {
                        throw new Error(
                            `[HARNESS HARD BLOCK] ${rule.description}\nRule: ${rule.id} | Pattern: ${rule.pattern.match}`,
                        );
                    }
                }
                if (rule.pattern.scope === 'file' && ['write', 'edit', 'patch'].includes(input.tool)) {
                    const filePath = (output.args?.filePath as string) || (output.args?.file as string) || '';
                    if (safeRegexTest(rule.pattern.match, filePath)) {
                        throw new Error(
                            `[HARNESS HARD BLOCK] ${rule.description}\nRule: ${rule.id} | File: ${filePath}`,
                        );
                    }
                }
                // scope: 'prompt'인 HARD 규칙은 여기서 처리하지 않음 (컨텍스트 주입으로 처리)
            }

            // === SOFT 규칙: 매칭 시 차단하지 않고 violation_count만 증가 ===
            for (const rule of softRules) {
                // scope: 'prompt'는 도구 실행 시점에 위반을 감지할 수 없으므로 건너뜀
                if (rule.pattern.scope === 'prompt') continue;

                let matched = false;
                if (rule.pattern.scope === 'tool') {
                    matched = safeRegexTest(rule.pattern.match, input.tool) || safeRegexTest(rule.pattern.match, argsStr);
                }
                if (rule.pattern.scope === 'file' && ['write', 'edit', 'patch'].includes(input.tool)) {
                    const filePath = (output.args?.filePath as string) || (output.args?.file as string) || '';
                    matched = safeRegexTest(rule.pattern.match, filePath);
                }
                if (matched) {
                    incrementViolation(rule);
                }
            }

            // === Scaffold NEVER DO 체크 ===
            if (['write', 'edit', 'patch'].includes(input.tool)) {
                const content = ((output.args?.content as string) || (output.args?.newString as string)) || '';
                for (const pattern of scaffoldPatterns) {
                    const keywords = pattern.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
                    const contentLower = content.toLowerCase();
                    const matchCount = keywords.filter((kw) => contentLower.includes(kw)).length;
                    if (keywords.length > 0 && matchCount / keywords.length > 0.6) {
                        throw new Error(
                            `[HARNESS SCAFFOLD VIOLATION] ${pattern}\nMatched keywords: ${matchCount}/${keywords.length}`,
                        );
                    }
                }
            }

            // === 특수 차단: .env 파일 커밋 방지 ===
            if (input.tool === 'bash') {
                const cmd = (output.args?.command as string) || '';
                if (/git\s+(add|commit).*\.env/.test(cmd)) {
                    throw new Error('[HARNESS HARD BLOCK] .env 파일의 git add/commit이 금지되어 있습니다.');
                }
            }

            // === 특수 차단: git push 전 증거 파일 체크 ===
            // 초안에서는 경고만, 오케스트레이션(Step 4)에서 HARD로 전환
            if (input.tool === 'bash') {
                const cmd = (output.args?.command as string) || '';
                if (/git\s+push/.test(cmd)) {
                    // TODO: qa-evidence 파일 존재 확인 → Step 4에서 활성화
                }
            }
        },
    };
};
