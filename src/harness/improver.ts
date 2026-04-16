// src/harness/improver.ts — Plugin 3: L5 자가개선 + L6 폐루프 + Step 3 Bridge
import {
    readFileSync, readdirSync, existsSync, writeFileSync,
    renameSync, unlinkSync, mkdirSync,
} from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import type { Signal, Rule, ProjectState, MistakeSummaryShadowRecord, AckRecord } from '../types.js';
import { HARNESS_DIR, ensureHarnessDirs, getProjectKey, generateId, rotateHistoryIfNeeded, logger, isPluginSource, appendJsonlRecord } from '../shared/index.js';
import type { HarnessConfig } from '../config/index.js';
import { getHarnessSettings } from '../config/index.js';

// ─── Helpers ────────────────────────────────────────────

// #5: 정규식 catastrophic backtracking 방지
// target 길이를 제한하고, 패턴 실행을 보호
const REGEX_MAX_TARGET_LENGTH = 10000; // default, overridden by config

function safeRegexTest(pattern: string, target: string): boolean {
    try {
        // target 길이 제한으로 백트래킹 리스크 완화
        const safeTarget = target.length > REGEX_MAX_TARGET_LENGTH
            ? target.slice(0, REGEX_MAX_TARGET_LENGTH)
            : target;
        return new RegExp(pattern, 'i').test(safeTarget);
    } catch {
        return false;
    }
}

// #7: 과도하게 넓은 패턴 검증
// 최소 3자, 메타문자만으로 구성된 패턴 거부
function isValidPattern(pattern: string): boolean {
    if (!pattern || pattern.length < 3) return false;
    // 메타문자만 있는지 확인 (예: ".", ".*", ".+")
    const metaOnly = pattern.replace(/[.*+?^${}()|[\]\\]/g, '');
    if (metaOnly.length === 0) return false;
    return true;
}

export function escapeRegexLiteral(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function appendHistory(event: string, data: Record<string, unknown>): void {
    const historyPath = join(HARNESS_DIR, 'rules', 'history.jsonl');
    try {
        mkdirSync(join(HARNESS_DIR, 'rules'), { recursive: true });
        // Phase 5: append 전 로테이션 체크
        rotateHistoryIfNeeded(historyPath);
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

function getMistakeShadowPath(projectKey: string): string {
    return join(HARNESS_DIR, 'projects', projectKey, 'mistake-pattern-shadow.jsonl');
}

function getAckStatusPath(projectKey: string): string {
    return join(HARNESS_DIR, 'projects', projectKey, 'ack-status.jsonl');
}

const GIT_HASH_REGEX = /^[a-f0-9]{7,64}$/i;

function isValidGitHash(hash: string): boolean {
    return GIT_HASH_REGEX.test(hash);
}

export function buildMistakeSummary(message: string, files: string[], diffText: string): { mistake_summary: string; ambiguous: boolean } {
    const diffLines = diffText.split('\n');
    const tooLarge = diffText.length > 12000 || diffLines.length > 400;
    const fileLabel = files.slice(0, 3).join(', ') || 'unknown-files';
    const addedLines = diffLines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
    const removedLines = diffLines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length;
    const hasChanges = addedLines + removedLines > 0;

    if (!hasChanges || tooLarge) {
        return {
            mistake_summary: `Ambiguous fix diff shadow: ${message}; files=${fileLabel}; diff_summary=redacted; added_lines=${addedLines}; removed_lines=${removedLines}`,
            ambiguous: true,
        };
    }

    return {
        mistake_summary: `Fix diff shadow: ${message}; files=${fileLabel}; added_lines=${addedLines}; removed_lines=${removedLines}`,
        ambiguous: false,
    };
}

function readMistakeSummaryShadowRecords(projectKey: string): MistakeSummaryShadowRecord[] {
    const filePath = getMistakeShadowPath(projectKey);
    if (!existsSync(filePath)) return [];

    try {
        return readFileSync(filePath, 'utf-8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as MistakeSummaryShadowRecord);
    } catch {
        return [];
    }
}

export function appendMistakeSummaryShadow(projectKey: string, hash: string, message: string, files: string[], diffText: string): MistakeSummaryShadowRecord {
    const normalizedHash = hash.toLowerCase();
    const existing = readMistakeSummaryShadowRecords(projectKey).find((record) => record.commit_hash.toLowerCase() === normalizedHash);
    if (existing) {
        return existing;
    }

    const summary = buildMistakeSummary(message, files, diffText);
    const record: MistakeSummaryShadowRecord = {
        id: generateId(),
        project_key: projectKey,
        timestamp: new Date().toISOString(),
        commit_hash: normalizedHash,
        commit_message: message,
        affected_files: files,
        mistake_summary: summary.mistake_summary,
        ambiguous: summary.ambiguous,
    };

    appendJsonlRecord(getMistakeShadowPath(projectKey), record as unknown as Record<string, unknown>);
    return record;
}

function readFixDiff(worktree: string, hash: string): string {
    if (!isValidGitHash(hash)) return '';

    try {
        return execSync(`git show --format= --unified=1 --stat=0 ${hash}`, {
            cwd: worktree,
            encoding: 'utf-8',
            timeout: 5000,
        });
    } catch {
        return '';
    }
}

function appendAckRecord(projectKey: string, record: AckRecord): void {
    appendJsonlRecord(getAckStatusPath(projectKey), record as unknown as Record<string, unknown>);
}

export function evaluateAckAcceptance(signal: Signal, ackPath: string): { accepted: boolean; reason: string; acceptance_check: 'rule_written' } {
    if (!existsSync(ackPath)) {
        return { accepted: false, reason: 'written_ack_missing', acceptance_check: 'rule_written' };
    }

    const pattern = signal.payload.pattern || signal.payload.description;
    if (!pattern) {
        return { accepted: false, reason: 'missing_signal_pattern', acceptance_check: 'rule_written' };
    }

    const normalizedPattern = signal.type === 'fix_commit' ? escapeRegexLiteral(pattern) : pattern;
    if (!ruleExists(normalizedPattern, signal.project_key)) {
        return { accepted: false, reason: 'rule_not_persisted', acceptance_check: 'rule_written' };
    }

    return { accepted: true, reason: 'rule_persisted', acceptance_check: 'rule_written' };
}

export function buildFixCommitSignalPayload(message: string, hash: string, files: string[]): Record<string, unknown> {
    const pattern = message.trim();
    return {
        type: 'fix_commit',
        payload: {
            description: `fix 커밋 감지: ${pattern}`,
            pattern,
            source_file: '',
            affected_files: files,
            recurrence_count: 1,
            related_signals: [hash],
        },
    };
}

export function buildBoundedCompactionContext(parts: string[], charCeiling: number): string[] {
    const bounded: string[] = [];
    let used = 0;

    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        if (used >= charCeiling) break;

        const remaining = charCeiling - used;
        const next = trimmed.length <= remaining ? trimmed : `${trimmed.slice(0, Math.max(0, remaining - 1)).trimEnd()}…`;
        if (!next.trim()) break;

        bounded.push(next);
        used += next.length;
    }

    return bounded;
}

// ─── Phase 2: syncRulesMarkdown — .opencode/rules/ 마크다운 동기화 ──

function syncRulesMarkdown(worktree: string): void {
    try {
        const rulesDir = join(worktree, '.opencode', 'rules');
        mkdirSync(rulesDir, { recursive: true });

        // SOFT 규칙 마크다운
        const softRules = loadJsonFiles<Rule>(join(HARNESS_DIR, 'rules/soft'));
        const softPath = join(rulesDir, 'harness-soft-rules.md');
        if (softRules.length > 0) {
            const lines = ['# Harness Rules (auto-generated)', '## SOFT Rules'];
            for (const r of softRules) {
                lines.push(`- [SOFT|${r.pattern.scope}] ${r.description}`);
            }
            writeFileSync(softPath, lines.join('\n') + '\n');
        } else {
            writeFileSync(softPath, '# Harness Rules (auto-generated)\n## SOFT Rules\n<!-- no soft rules yet -->\n');
        }

        // HARD 규칙 마크다운
        const hardRules = loadJsonFiles<Rule>(join(HARNESS_DIR, 'rules/hard'));
        const hardPath = join(rulesDir, 'harness-hard-rules.md');
        if (hardRules.length > 0) {
            const lines = ['# Harness Rules (auto-generated)', '## HARD Rules'];
            for (const r of hardRules) {
                lines.push(`- [HARD|${r.pattern.scope}] ${r.description}`);
            }
            writeFileSync(hardPath, lines.join('\n') + '\n');
        } else {
            writeFileSync(hardPath, '# Harness Rules (auto-generated)\n## HARD Rules\n<!-- no hard rules yet -->\n');
        }
    } catch {
        /* rules 마크다운 동기화 실패는 치명적이지 않음 */
    }
}

// ─── 3.2 signalToRule — pending signal → SOFT 규칙 변환 ──────────────

function mapSignalTypeToScope(signalType: Signal['type']): Rule['pattern']['scope'] {
    switch (signalType) {
        case 'error_repeat': return 'tool';
        case 'user_feedback': return 'prompt';
        case 'fix_commit': return 'tool';
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

function signalToRule(signal: Signal, worktree: string): void {
    const pattern = signal.payload.pattern || signal.payload.description;
    if (!pattern) return;

    const normalizedPattern = signal.type === 'fix_commit' ? escapeRegexLiteral(pattern) : pattern;

    // #7: 과도하게 넓은 패턴 거부
    if (!isValidPattern(normalizedPattern)) {
        appendHistory('rule_rejected', {
            signal_id: signal.id,
            pattern: normalizedPattern,
            reason: 'invalid_or_too_broad_pattern',
        });
        return;
    }

    // skip rules targeting plugin source code (prevent self-blockade)
    const sourceFile = signal.payload.source_file || '';
    if (sourceFile && isPluginSource(sourceFile)) {
        appendHistory('rule_rejected', {
            signal_id: signal.id,
            pattern: normalizedPattern,
            reason: 'targets_plugin_source',
            source_file: sourceFile,
        });
        return;
    }

    // 중복 체크 (soft + hard 양쪽)
    if (ruleExists(normalizedPattern, signal.project_key)) {
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
            match: normalizedPattern,
            scope: mapSignalTypeToScope(signal.type),
        },
        description: signal.payload.description,
        violation_count: 0,
    };

    const rulePath = join(HARNESS_DIR, `rules/soft/${rule.id}.json`);
    mkdirSync(join(HARNESS_DIR, 'rules/soft'), { recursive: true });

    // #1: write 직전에 한 번 더 중복 체크 (TOCTOU 경쟁 완화)
    if (existsSync(rulePath) || ruleExists(normalizedPattern, signal.project_key)) {
        return;
    }

    writeFileSync(rulePath, JSON.stringify(rule, null, 2));

        appendHistory('rule_created', {
            rule_id: rule.id,
            signal_id: signal.id,
            pattern: normalizedPattern,
            scope: rule.pattern.scope,
        });

    // Phase 2: 규칙 생성 후 마크다운 동기화
    syncRulesMarkdown(worktree);
}

// ─── 3.3 promoteRules — SOFT→HARD 자동 승격 ───────────

function promoteRules(projectKey: string, worktree: string, threshold: number): void {
    const softDir = join(HARNESS_DIR, 'rules/soft');
    const hardDir = join(HARNESS_DIR, 'rules/hard');
    if (!existsSync(softDir)) return;
    mkdirSync(hardDir, { recursive: true });

    let promoted = false;

    for (const file of readdirSync(softDir)) {
        if (!file.endsWith('.json')) continue;
        const filePath = join(softDir, file);
        let rule: Rule;
        try {
            rule = JSON.parse(readFileSync(filePath, 'utf-8'));
        } catch { continue; }

        // 조건: violation_count >= 2 + scope !== 'prompt' + 프로젝트 일치
        if (rule.violation_count < threshold) continue;
        if (rule.pattern.scope === 'prompt') continue;
        if (rule.project_key !== projectKey && rule.project_key !== 'global') continue;

        // HARD로 승격
        rule.type = 'hard';
        rule.promoted_at = new Date().toISOString();
        rule.violation_count = 0; // v3 버그 W3 수정: 승격 시 리셋

        const hardPath = join(hardDir, file);
        writeFileSync(hardPath, JSON.stringify(rule, null, 2));
        unlinkSync(filePath); // soft에서 삭제

        promoted = true;

        appendHistory('rule_promoted', {
            rule_id: rule.id,
            pattern: rule.pattern.match,
            scope: rule.pattern.scope,
            promoted_at: rule.promoted_at,
        });
    }

    // Phase 2: 승격 발생 시 마크다운 동기화
    if (promoted) {
        syncRulesMarkdown(worktree);
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
            const actualDelta = rule.effectiveness
                ? rule.violation_count - lastCount
                : rule.violation_count;

            // scope:prompt 규칙은 enforcer에서 위반 감지 불가 → violation_count가 항상 0
            // "effective" 거짓 판정 방지. LLM 기반 감지 도입 시 재검토 (Step 4)
            let status: 'effective' | 'warning' | 'needs_promotion' | 'unmeasurable';
            if (rule.pattern.scope === 'prompt') {
                status = 'unmeasurable';
            } else if (actualDelta === 0) {
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
// Phase 4: COMMIT_START delimiter 기반 파싱으로 고도화

// #6: 명령어 인젝션 방지 — ISO 날짜 형식만 허용
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/;

function isValidTimestamp(ts: unknown): ts is string {
    return typeof ts === 'string' && ISO_DATE_REGEX.test(ts);
}

function detectFixCommits(worktree: string, projectKey: string): void {
    // 세션 시작 타임스탬프 읽기
    const startPath = join(HARNESS_DIR, 'logs/sessions', `session_start_${projectKey}.json`);
    if (!existsSync(startPath)) return;

    let startTime: string;
    try {
        const startInfo = JSON.parse(readFileSync(startPath, 'utf-8'));
        startTime = startInfo.timestamp;
    } catch { return; }

    // #6: timestamp가 ISO 날짜 형식이 아니면 중단
    if (!isValidTimestamp(startTime)) return;

    // Phase 4: COMMIT_START delimiter 기반 파싱
    let logOutput: string;
    try {
        logOutput = execSync(
            `git log --since="${startTime}" --format="COMMIT_START%n%H%n%s" --name-only --no-merges`,
            { cwd: worktree, encoding: 'utf-8', timeout: 5000 },
        );
    } catch {
        // git 실패 시 조용히 스킵 (non-repo, timeout 등)
        return;
    }

    // COMMIT_START delimiter로 명확하게 블록 분리
    const blocks = logOutput.split('COMMIT_START\n').filter(Boolean);
    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 2) continue;

        const hash = lines[0].trim();
        const message = lines[1].trim();
        if (!hash || !message.startsWith('fix')) continue;
        if (!isValidGitHash(hash)) continue;

        const normalizedHash = hash.toLowerCase();
        if (readMistakeSummaryShadowRecords(projectKey).some((record) => record.commit_hash.toLowerCase() === normalizedHash)) {
            continue;
        }

        // 3번째 줄부터 파일 목록
        const files = lines.slice(2).filter((l) => l.trim().length > 0);

        appendMistakeSummaryShadow(projectKey, normalizedHash, message, files, readFixDiff(worktree, hash));

        // fix_commit signal 생성 (message-based contract 유지)
        const signal: Record<string, unknown> = {
            ...buildFixCommitSignalPayload(message, hash, files),
            project_key: projectKey,
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

// ─── Phase 3: Memory Index — 세션 JSONL에서 키워드 추출 ──

const MEMORY_KEYWORDS = [
    /decision:\s*(.+)/i,
    /결정:\s*(.+)/,
    /DECISION:\s*(.+)/,
    /NEVER DO:\s*(.+)/i,
    /ALWAYS:\s*(.+)/i,
    /MUST:\s*(.+)/i,
    /FORBIDDEN:\s*(.+)/i,
    /constraint:\s*(.+)/i,
    /제약:\s*(.+)/,
    /TODO:\s*(.+)/i,
    /FIXME:\s*(.+)/i,
];

interface MemoryFact {
    id: string;
    keywords: string[];
    content: string;
    source_session: string;
    created_at: string;
}

function indexSessionFacts(projectKey: string): void {
    const sessionDir = join(HARNESS_DIR, 'logs/sessions');
    if (!existsSync(sessionDir)) return;

    const factsDir = join(HARNESS_DIR, 'memory/facts');
    mkdirSync(factsDir, { recursive: true });

    // 세션 JSONL 파일 읽기 (모든 세션에서 추출 — 파일명에 projectKey가 없을 수 있음)
    const sessionFiles = readdirSync(sessionDir).filter(
        (f) => f.endsWith('.jsonl'),
    );

    for (const sessionFile of sessionFiles) {
        const sessionPath = join(sessionDir, sessionFile);
        let content: string;
        try {
            content = readFileSync(sessionPath, 'utf-8');
        } catch { continue; }

        const lines = content.split('\n').filter(Boolean);
        const extractedFacts: { keywords: string[]; content: string }[] = [];

        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                const textToSearch = typeof entry === 'string' ? entry : JSON.stringify(entry);

                for (const pattern of MEMORY_KEYWORDS) {
                    const match = textToSearch.match(pattern);
                    if (match && match[1]) {
                        const keyword = match[1].trim().slice(0, 200); // 길이 제한
                        extractedFacts.push({
                            keywords: [pattern.source.replace(/\\s\*\(.*/, '').toLowerCase(), keyword.toLowerCase()],
                            content: keyword,
                        });
                    }
                }
            } catch { /* 파싱 실패 무시 */ }
        }

        // 추출된 fact 저장
        for (const fact of extractedFacts) {
            const id = generateId();
            const factData: MemoryFact = {
                id,
                keywords: [...new Set(fact.keywords)], // 중복 제거
                content: fact.content,
                source_session: sessionFile,
                created_at: new Date().toISOString(),
            };
            writeFileSync(join(factsDir, `${id}.json`), JSON.stringify(factData, null, 2));
        }
    }
}

// ─── Phase 3: Memory Search — 키워드 매칭으로 fact 검색 ──

function searchFacts(query: string, maxResults = 10): MemoryFact[] {
    const factsDir = join(HARNESS_DIR, 'memory/facts');
    if (!existsSync(factsDir)) return [];

    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(Boolean);
    const facts = loadJsonFiles<MemoryFact>(factsDir);

    // 각 fact에 대해 쿼리 단어와 키워드의 교집합 점수 계산
    const scored = facts
        .map((fact) => {
            const factText = `${fact.keywords.join(' ')} ${fact.content}`.toLowerCase();
            const score = queryWords.reduce((acc, word) => acc + (factText.includes(word) ? 1 : 0), 0);
            return { fact, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);

    return scored.map((item) => item.fact);
}

// ─── 3.7 compacting — 컨텍스트 주입 ────────────────────
// Phase 3: Memory Search 결과 주입 추가

function buildCompactionContext(projectKey: string, worktree: string, maxResults: number): string[] {
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
        const prioritizedSoftRules = softRules
            .sort((a, b) => (b.violation_count - a.violation_count) || b.created_at.localeCompare(a.created_at))
            .slice(0, maxResults);
        if (prioritizedSoftRules.length > 0) {
            const descriptions = prioritizedSoftRules.map((r) => `- [SOFT] ${r.description} (scope: ${r.pattern.scope})`).join('\n');
            parts.push(`[HARNESS SOFT RULES — recommended]\n${descriptions}`);
        }
    }

    // Phase 3: Memory Search — 관련 fact 주입
    const queryText = [
        ...hardRules.map((r) => `${r.description} ${r.pattern.match}`),
        ...softRules.map((r) => `${r.description} ${r.pattern.match}`),
    ].join(' ');
    const relevantFacts = searchFacts(queryText, maxResults);
    if (relevantFacts.length > 0) {
        const factLines = relevantFacts.map(
            (f) => `- [${f.source_session}] ${f.content} (keywords: ${f.keywords.join(', ')})`,
        );
        parts.push(`[HARNESS MEMORY — past decisions]\n${factLines.join('\n')}`);
    }

    return buildBoundedCompactionContext(parts, 12000);
}

// ─── 3.1 Main Plugin Export ─────────────────────────────

export const HarnessImprover = async (ctx: { worktree: string }, config?: HarnessConfig) => {
    ensureHarnessDirs();
    const projectKey = getProjectKey(ctx.worktree);
    const settings = getHarnessSettings(config);

    return {
        // event 훅: session.idle에서 L5+L6 처리
        event: async ({ event }: { event: { type: string; properties?: Record<string, unknown> } }) => {
            if (event.type !== 'session.idle') return;

            try {
                // Loop 1: fix: 커밋 감지 → fix_commit signal 생성
                detectFixCommits(ctx.worktree, projectKey);
            } catch (err) {
                logger.error('improver', 'fix commit detection failed', { error: err });
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
                        signalToRule(signal, ctx.worktree);

                        // signal을 ack로 이동 (idempotent: 재시도해도 안전)
                        const ackPath = join(ackDir, file);
                        renameSync(filePath, ackPath);

                        const acceptance = settings.ack_guard_enabled
                            ? evaluateAckAcceptance(signal, ackPath)
                            : { accepted: false, reason: 'guard_disabled', acceptance_check: 'rule_written' as const };

                        appendAckRecord(projectKey, {
                            signal_id: signal.id,
                            project_key: projectKey,
                            timestamp: new Date().toISOString(),
                            state: 'written',
                            signal_type: signal.type,
                            guard_enabled: settings.ack_guard_enabled,
                            acceptance_check: acceptance.acceptance_check,
                            accepted: acceptance.accepted,
                            reason: acceptance.reason,
                        });

                        if (settings.ack_guard_enabled && acceptance.accepted) {
                            appendAckRecord(projectKey, {
                                signal_id: signal.id,
                                project_key: projectKey,
                                timestamp: new Date().toISOString(),
                                state: 'accepted',
                                signal_type: signal.type,
                                guard_enabled: true,
                                acceptance_check: acceptance.acceptance_check,
                                accepted: true,
                                reason: acceptance.reason,
                            });
                        }
                    } catch (err) {
                        logger.error('improver', 'failed to process signal', { file, error: err });
                    }
                }
            }

            // SOFT → HARD 승격
            promoteRules(projectKey, ctx.worktree, settings.soft_to_hard_threshold);

            // 30일 효과 측정
            evaluateRuleEffectiveness();

            // Phase 3: Memory Index — 세션에서 키워드 추출
            try {
                indexSessionFacts(projectKey);
            } catch (err) {
                logger.error('improver', 'memory indexing failed', { error: err });
            }

            // 프로젝트 상태 갱신
            updateProjectState(projectKey, ctx.worktree);
        },

        // compacting 훅: scaffold + 규칙 + memory 컨텍스트 주입
        'experimental.session.compacting': async (_input: unknown, output: { context: string[] }) => {
            const parts = buildCompactionContext(projectKey, ctx.worktree, settings.search_max_results);
            for (const part of parts) {
                output.context.push(part);
            }
        },
    };
};
