// src/harness/improver.ts — Plugin 3: L5 자가개선 + L6 폐루프 + Step 3 Bridge
import {
    readFileSync, readdirSync, existsSync, writeFileSync,
    renameSync, unlinkSync, mkdirSync,
} from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import type {
    Signal,
    Rule,
    ProjectState,
    MistakeSummaryShadowRecord,
    MistakePatternCandidate,
    AckRecord,
    AckAcceptanceResult,
    MemoryFact,
    FactOriginType,
    FactStatus,
    GateAAlertRecord,
    GateAConditionRecord,
    GateAStatusRecord,
    HotContext,
    HotContextEntry,
    MemoryMetricRecord,
    UpperMemoryExtractShadowRecord,
    CompactionRelevanceShadowRecord,
    RulePruneCandidateRecord,
    CrossProjectPromotionCandidateRecord,
    ConsolidationRecord,
    FactRelation,
} from '../types.js';
import { HARNESS_DIR, THIRTY_DAYS_MS, ensureHarnessDirs, getProjectKey, generateId, rotateHistoryIfNeeded, logger, isPluginSource, appendJsonlRecord } from '../shared/index.js';
import type { HarnessConfig } from '../config/index.js';
import { getHarnessSettings } from '../config/index.js';
import { evaluateCompactingCanary, readRecentCompactingShadowRecords, appendCompactingMismatchRecord } from './canary.js';

// ─── File-level constants ──────────────────────────────
const GIT_COMMAND_TIMEOUT_MS = 5000;
const DIFF_MAX_CHARS = 12000;
const DIFF_MAX_LINES = 400;
const COMPACTION_QUERY_MAX_LENGTH = 1000;
const FACT_KEYWORD_MAX_LENGTH = 200;
// Phase 1a constants
const HOT_CONTEXT_MAX_CHARS = 2000;  // ~500 tokens estimate
const METRICS_MAX_BYTES = 1048576;   // 1MB
const METRICS_ROTATE_DAYS = 30;
const GATE_A_WINDOW = 5;
const GATE_A_THRESHOLDS: Record<GateAConditionRecord['key'], number> = {
    facts_scanned_per_compaction: 80,
    relations_scanned_per_lookup: 30,
    hot_context_build_ms: 500,
    compacting_build_ms: 2000,
    total_fact_count: 100,
};

// ─── Helpers ────────────────────────────────────────────

// #5: 정규식 catastrophic backtracking 방지
// target 길이를 제한하고, 패턴 실행을 보호
// NOTE: enforcer.ts has a similar function with configurable maxLength; the two intentionally differ
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

function loadJsonlRecords<T>(filePath: string): T[] {
    if (!existsSync(filePath)) return [];

    try {
        return readFileSync(filePath, 'utf-8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as T);
    } catch {
        return [];
    }
}

/** Type-safe wrapper to avoid repeating `as unknown as Record<string, unknown>` */
const appendRecord = (filePath: string, data: unknown) =>
    appendJsonlRecord(filePath, data as Record<string, unknown>);

function loadProjectRules(type: 'soft' | 'hard', projectKey: string): Rule[] {
    return loadJsonFiles<Rule>(join(HARNESS_DIR, `rules/${type}`))
        .filter((r) => r.project_key === projectKey || r.project_key === 'global');
}

function getMistakeShadowPath(projectKey: string): string {
    return join(HARNESS_DIR, 'projects', projectKey, 'mistake-pattern-shadow.jsonl');
}

function getAckStatusPath(projectKey: string): string {
    return join(HARNESS_DIR, 'projects', projectKey, 'ack-status.jsonl');
}

function getUpperMemoryShadowPath(projectKey: string): string {
    return join(HARNESS_DIR, 'projects', projectKey, 'memory-upper-shadow.jsonl');
}

function getCompactionShadowPath(projectKey: string): string {
    return join(HARNESS_DIR, 'projects', projectKey, 'compacting-relevance-shadow.jsonl');
}

function getRulePruneCandidatePath(projectKey: string): string {
    return join(HARNESS_DIR, 'projects', projectKey, 'rule-prune-candidates.jsonl');
}

function getCrossProjectPromotionCandidatePath(): string {
    return join(HARNESS_DIR, 'projects', 'global', 'cross-project-promotion-candidates.jsonl');
}

const GIT_HASH_REGEX = /^[a-f0-9]{7,64}$/i;

function isValidGitHash(hash: string): boolean {
    return GIT_HASH_REGEX.test(hash);
}

export function buildMistakeSummary(message: string, files: string[], diffText: string): { mistake_summary: string; ambiguous: boolean } {
    const diffLines = diffText.split('\n');
    const tooLarge = diffText.length > DIFF_MAX_CHARS || diffLines.length > DIFF_MAX_LINES;
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

// ─── Step 5e: Pattern identity computation + candidate grouping ────

const CONVENTIONAL_COMMIT_PREFIX = /^(?:fix|chore|refactor|feat|docs|test|style|perf|build|ci|revert)(?:\([^)]*\))?:\s*/i;

export function computePatternIdentity(message: string, files: string[]): { identity: string; keyword: string; paths: string[] } {
    // 1. Strip conventional commit prefix
    const stripped = message.replace(CONVENTIONAL_COMMIT_PREFIX, '').trim();

    // 2. Extract first significant word (alphanumeric, >= 2 chars)
    let keyword = 'unknown';
    if (stripped) {
        const wordMatch = stripped.match(/[a-zA-Z0-9]{2,}/);
        if (wordMatch) {
            keyword = wordMatch[0].toLowerCase();
        }
    }

    // 3. Normalize each file path to top 2 directory segments
    const normalizedPaths = files
        .map((filePath) => {
            const segments = filePath.split('/');
            if (segments.length <= 2) return segments.join('/');
            return segments.slice(0, 2).join('/');
        });

    // 4. Sort and deduplicate
    const paths = [...new Set(normalizedPaths)].sort();

    // 5. Return identity
    return {
        identity: keyword + '::' + paths.join(','),
        keyword,
        paths,
    };
}

function getMistakeCandidatePath(projectKey: string): string {
    return join(HARNESS_DIR, 'projects', projectKey, 'mistake-pattern-candidates.jsonl');
}

function readMistakeCandidateRecords(projectKey: string): MistakePatternCandidate[] {
    return loadJsonlRecords<MistakePatternCandidate>(getMistakeCandidatePath(projectKey));
}

function findOrCreateCandidate(
    projectKey: string,
    patternIdentity: { identity: string; keyword: string; paths: string[] },
    shadowRecord: MistakeSummaryShadowRecord,
    threshold: number,
): void {
    const candidates = readMistakeCandidateRecords(projectKey);
    // Find the most recent version of the candidate (append-only JSONL — last entry wins)
    const existing = candidates.findLast(c => c.pattern_identity === patternIdentity.identity);

    if (existing) {
        // Update existing candidate
        if (!existing.source_shadow_ids.includes(shadowRecord.id)) {
            existing.source_shadow_ids.push(shadowRecord.id);
        }
        existing.repetition_count += 1;
        if (!existing.mistake_summary_samples.includes(shadowRecord.mistake_summary) && existing.mistake_summary_samples.length < 3) {
            existing.mistake_summary_samples.push(shadowRecord.mistake_summary);
        }
        // Append-only JSONL: append updated record (last entry wins on read)
        appendRecord(getMistakeCandidatePath(projectKey), existing);
    } else if (shadowRecord.affected_files.length > 0 || shadowRecord.commit_message.trim().length > 0) {
        // Only create a new candidate if there's meaningful data
        const candidate: MistakePatternCandidate = {
            id: generateId(),
            project_key: projectKey,
            timestamp: new Date().toISOString(),
            pattern_identity: patternIdentity.identity,
            pattern_keyword: patternIdentity.keyword,
            pattern_paths: patternIdentity.paths,
            source_shadow_ids: [shadowRecord.id],
            repetition_count: 1,
            candidate_threshold: threshold,
            status: 'pending',
            mistake_summary_samples: [shadowRecord.mistake_summary].slice(0, 3),
        };
        appendRecord(getMistakeCandidatePath(projectKey), candidate);
    }
}

export function groupMistakeCandidates(projectKey: string, config?: HarnessConfig): void {
    const settings = getHarnessSettings(config);
    const threshold = settings.candidate_threshold;

    const shadowRecords = loadJsonlRecords<MistakeSummaryShadowRecord>(getMistakeShadowPath(projectKey));
    // Filter out ambiguous records
    const nonAmbiguous = shadowRecords.filter((r) => !r.ambiguous);

    // Group by pattern identity
    const groups = new Map<string, MistakeSummaryShadowRecord[]>();
    for (const record of nonAmbiguous) {
        const pattern = computePatternIdentity(record.commit_message, record.affected_files);
        const existing = groups.get(pattern.identity);
        if (existing) {
            existing.push(record);
        } else {
            groups.set(pattern.identity, [record]);
        }
    }

    // For each group with count >= threshold, create/update candidate
    for (const [identity, groupRecords] of groups.entries()) {
        if (groupRecords.length < threshold) continue;

        // Use the latest record as the representative
        const latest = groupRecords[groupRecords.length - 1];
        const pattern = computePatternIdentity(latest.commit_message, latest.affected_files);

        // Check all records in the group against candidates
        for (const record of groupRecords) {
            findOrCreateCandidate(projectKey, pattern, record, threshold);
        }
    }
}

export function appendMistakeSummaryShadow(projectKey: string, hash: string, message: string, files: string[], diffText: string, config?: HarnessConfig): MistakeSummaryShadowRecord {
    const normalizedHash = hash.toLowerCase();
    const existing = loadJsonlRecords<MistakeSummaryShadowRecord>(getMistakeShadowPath(projectKey)).find((record) => record.commit_hash.toLowerCase() === normalizedHash);
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

    appendRecord(getMistakeShadowPath(projectKey), record);

    // Step 5e: trigger candidate grouping after non-ambiguous shadow append
    if (!summary.ambiguous) {
        try {
            groupMistakeCandidates(projectKey, config);
        } catch (err) {
            logger.warn('improver', 'candidate grouping failed', { project_key: projectKey, error: err });
        }
    }

    return record;
}

function readFixDiff(worktree: string, hash: string): string {
    if (!isValidGitHash(hash)) return '';

    try {
        return execSync(`git show --format= --unified=1 --stat=0 ${hash}`, {
            cwd: worktree,
            encoding: 'utf-8',
            timeout: GIT_COMMAND_TIMEOUT_MS,
        });
    } catch {
        return '';
    }
}

function appendAckRecord(projectKey: string, record: AckRecord): void {
    appendRecord(getAckStatusPath(projectKey), record);
}

function isPruneCandidateRule(rule: Rule): boolean {
    if (rule.type !== 'soft') return false;
    if (rule.pattern.scope === 'prompt') return false;
    if (rule.violation_count !== 0) return false;
    return Date.now() - parseIsoDate(rule.created_at) >= THIRTY_DAYS_MS;
}

function markPruneCandidates(projectKey: string, pruneGuardEnabled: boolean): void {
    const softRules = loadJsonFiles<Rule>(join(HARNESS_DIR, 'rules/soft'))
        .filter((rule) => rule.project_key === projectKey);

    for (const rule of softRules) {
        if (!isPruneCandidateRule(rule)) continue;

        const timestamp = new Date().toISOString();
        rule.prune_candidate = {
            marked_at: timestamp,
            reason: 'stale_unused_rule',
            guard_enabled: pruneGuardEnabled,
        };

        const rulePath = join(HARNESS_DIR, 'rules/soft', `${rule.id}.json`);
        writeFileSync(rulePath, JSON.stringify(rule, null, 2));

        const record: RulePruneCandidateRecord = {
            id: generateId(),
            project_key: projectKey,
            rule_id: rule.id,
            timestamp,
            pattern_match: rule.pattern.match,
            pattern_scope: rule.pattern.scope,
            reason: rule.prune_candidate.reason,
            guard_enabled: pruneGuardEnabled,
        };

        appendRecord(getRulePruneCandidatePath(projectKey), record);
        appendHistory('rule_prune_candidate_marked', {
            project_key: projectKey,
            rule_id: rule.id,
            pattern: rule.pattern.match,
            scope: rule.pattern.scope,
            reason: record.reason,
            guard_enabled: pruneGuardEnabled,
        });
    }
}

function getExactRuleCandidateKey(rule: Rule): string {
    return [rule.type, rule.pattern.type, rule.pattern.scope, rule.pattern.match].join('::');
}

function recordCrossProjectPromotionCandidates(projectKey: string, guardEnabled: boolean): void {
    const softRules = loadJsonFiles<Rule>(join(HARNESS_DIR, 'rules/soft'))
        .filter((rule) => rule.type === 'soft' && rule.project_key !== 'global');
    if (softRules.length === 0) return;

    const grouped = new Map<string, { pattern_match: string; pattern_scope: Rule['pattern']['scope']; rules: Rule[]; project_keys: Set<string> }>();

    for (const rule of softRules) {
        const candidateKey = getExactRuleCandidateKey(rule);
        const existing = grouped.get(candidateKey);
        if (existing) {
            existing.rules.push(rule);
            existing.project_keys.add(rule.project_key);
            continue;
        }

        grouped.set(candidateKey, {
            pattern_match: rule.pattern.match,
            pattern_scope: rule.pattern.scope,
            rules: [rule],
            project_keys: new Set([rule.project_key]),
        });
    }

    const candidatePath = getCrossProjectPromotionCandidatePath();

    for (const [candidateKey, groupedRule] of grouped.entries()) {
        if (groupedRule.project_keys.size < 2) continue;

        const projectKeys = [...groupedRule.project_keys].map(String).sort();
        const ruleIds = groupedRule.rules.map((rule) => rule.id).sort();

        const record: CrossProjectPromotionCandidateRecord = {
            id: generateId(),
            project_key: 'global',
            timestamp: new Date().toISOString(),
            candidate_key: candidateKey,
            pattern_match: groupedRule.pattern_match,
            pattern_scope: groupedRule.pattern_scope,
            project_keys: projectKeys,
            rule_ids: ruleIds,
            occurrence_count: groupedRule.rules.length,
            guard_enabled: guardEnabled,
        };

        appendRecord(candidatePath, record);
        appendHistory('cross_project_promotion_candidate_recorded', {
            project_key: projectKey,
            candidate_key: candidateKey,
            pattern: groupedRule.pattern_match,
            scope: groupedRule.pattern_scope,
            project_keys: projectKeys,
            rule_ids: ruleIds,
            guard_enabled: guardEnabled,
        });
    }
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

function appendUpperMemoryExtractShadow(projectKey: string, fact: MemoryFact): UpperMemoryExtractShadowRecord {
    const record: UpperMemoryExtractShadowRecord = {
        id: generateId(),
        project_key: projectKey,
        timestamp: new Date().toISOString(),
        stage: 'extract',
        source: 'session_log',
        fact_id: fact.id,
        source_session: fact.source_session,
        keywords: fact.keywords,
        content: fact.content,
    };

    appendRecord(getUpperMemoryShadowPath(projectKey), record);
    return record;
}

function isProjectScopedSessionLog(sessionPath: string, sessionFile: string, projectKey: string): boolean {
    const normalizedFile = sessionFile.toLowerCase();
    const normalizedProjectKey = projectKey.toLowerCase();

    try {
        const lines = readFileSync(sessionPath, 'utf-8').split('\n').filter(Boolean);
        let sawProjectMetadata = false;

        for (const line of lines) {
            const entry = JSON.parse(line);
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

            if (!Object.prototype.hasOwnProperty.call(entry, 'project_key')) continue;
            sawProjectMetadata = true;

            const entryProjectKey = typeof (entry as { project_key?: unknown }).project_key === 'string'
                ? String((entry as { project_key?: string }).project_key).toLowerCase()
                : '';

            if (entryProjectKey !== normalizedProjectKey) return false;
        }

        if (sawProjectMetadata) return true;
    } catch {
        // fall back to safe filename patterns when metadata is unavailable or unreadable
    }

    return normalizedFile.includes(`-${normalizedProjectKey}.jsonl`) ||
        normalizedFile.includes(`_${normalizedProjectKey}.jsonl`) ||
        normalizedFile.startsWith(`${normalizedProjectKey}.jsonl`) ||
        normalizedFile.startsWith(`${normalizedProjectKey}-`) ||
        normalizedFile.startsWith(`${normalizedProjectKey}_`) ||
        normalizedFile.startsWith(`session_${normalizedProjectKey}_`);
}

function parseIsoDate(value?: string): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
}

// ─── Phase 1a: Promotion Control — metadata-based classification ──

export function classifyOriginType(fact: MemoryFact): FactOriginType {
    const content = fact.content.toLowerCase();
    const keywords = fact.keywords.map(k => k.toLowerCase());

    // 1. user_explicit: directive patterns
    const directivePatterns = [/반드시/, /절대/, /항상/, /never/i, /always/i, /must/i, /절대로/, /무조건/];
    if (directivePatterns.some(p => p.test(content))) return 'user_explicit';

    // 2. execution_observed: tool execution result patterns
    if (content.includes('exit code') || content.includes('stdout') || content.includes('stderr')) {
        return 'execution_observed';
    }

    // 3. tool_result: file/search result patterns
    if (keywords.some(k => ['read', 'search', 'grep', 'file'].includes(k))) {
        return 'tool_result';
    }

    // 4. Default
    return 'inferred';
}

export function computeConfidence(originType: FactOriginType): number {
    switch (originType) {
        case 'user_explicit': return 0.9;
        case 'execution_observed': return 0.85;
        case 'tool_result': return 0.8;
        case 'inferred': return 0.5;
    }
}

export function determineFactStatus(confidence: number, threshold: number): FactStatus {
    return confidence >= threshold ? 'active' : 'unreviewed';
}

export function enrichFactMetadata(fact: MemoryFact, settings: { rich_fact_metadata_enabled: boolean; confidence_threshold_active: number }): MemoryFact {
    if (!settings.rich_fact_metadata_enabled) return fact;

    const originType = classifyOriginType(fact);
    const confidence = computeConfidence(originType);
    const status = determineFactStatus(confidence, settings.confidence_threshold_active);

    return {
        ...fact,
        origin_type: originType,
        confidence,
        status,
        updated_at: new Date().toISOString(),
    };
}

// ─── Phase 1a: Hot Context ──────────────────────────────

function getHotContextPath(projectKey: string): string {
    return join(HARNESS_DIR, 'projects', projectKey, 'memory', 'hot-context.json');
}

function getMemoryMetricsPath(projectKey: string): string {
    return join(HARNESS_DIR, 'projects', projectKey, 'memory', 'memory-metrics.jsonl');
}

function getGateAStatusPath(projectKey: string): string {
    return join(HARNESS_DIR, 'projects', projectKey, 'memory', 'gate-a-status.json');
}

function getGateAAlertsPath(projectKey: string): string {
    return join(HARNESS_DIR, 'projects', projectKey, 'memory', 'gate-a-alerts.jsonl');
}

export function generateHotContext(projectKey: string, facts: MemoryFact[]): HotContext {
    // Filter to current project only + active facts (status: 'active' or undefined)
    const activeFacts = facts.filter(f =>
        f.project_key === projectKey &&
        (!f.status || f.status === 'active')
    );

    // Separate contradictions (must_verify) from regular facts
    const contradictions: HotContextEntry[] = activeFacts
        .filter(f => f.must_verify === true)
        .map(f => ({
            id: f.id,
            content: f.content,
            origin_type: f.origin_type ?? 'inferred',
            confidence: f.confidence ?? 0.5,
            must_verify: true,
        }));

    // Regular facts: prioritize by origin_type, confidence, recency
    const regularFacts = activeFacts
        .filter(f => !f.must_verify)
        .sort((a, b) => {
            // user_explicit first
            const aType = a.origin_type ?? 'inferred';
            const bType = b.origin_type ?? 'inferred';
            const typeOrder: Record<string, number> = { user_explicit: 0, execution_observed: 1, tool_result: 2, inferred: 3 };
            const typeDiff = (typeOrder[aType] ?? 3) - (typeOrder[bType] ?? 3);
            if (typeDiff !== 0) return typeDiff;
            // Then by confidence descending
            const confDiff = (b.confidence ?? 0.5) - (a.confidence ?? 0.5);
            if (Math.abs(confDiff) > 0.01) return confDiff;
            // Then by recency
            return (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at);
        });

    // Budget: ~5-10 facts total
    const maxRegular = Math.max(0, 10 - contradictions.length);
    const selectedFacts: HotContextEntry[] = regularFacts.slice(0, maxRegular).map(f => ({
        id: f.id,
        content: f.content,
        origin_type: f.origin_type ?? 'inferred',
        confidence: f.confidence ?? 0.5,
        must_verify: f.must_verify,
    }));

    // Read previous session_count for continuity
    const previous = readHotContext(projectKey);
    const sessionCount = previous ? previous.session_count + 1 : 1;

    return {
        project_key: projectKey,
        generated_at: new Date().toISOString(),
        session_count: sessionCount,
        facts: selectedFacts,
        contradictions,
    };
}

export function writeHotContext(projectKey: string, ctx: HotContext): void {
    const dir = join(HARNESS_DIR, 'projects', projectKey, 'memory');
    mkdirSync(dir, { recursive: true });

    // Enforce character budget
    const serialized = JSON.stringify(ctx);
    if (serialized.length > HOT_CONTEXT_MAX_CHARS) {
        // Truncate facts to fit
        const budget = ctx;
        while (JSON.stringify(budget).length > HOT_CONTEXT_MAX_CHARS && budget.facts.length > 0) {
            budget.facts.pop();
        }
        writeFileSync(getHotContextPath(projectKey), JSON.stringify(budget, null, 2));
    } else {
        writeFileSync(getHotContextPath(projectKey), JSON.stringify(ctx, null, 2));
    }
}

export function readHotContext(projectKey: string): HotContext | null {
    const path = getHotContextPath(projectKey);
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as HotContext;
    } catch {
        return null;
    }
}

export function formatHotContextForCompacting(ctx: HotContext): string {
    // Sanitize: strip harness-bracket headers and common injection patterns from fact content
    const sanitize = (raw: string): string =>
        raw
            .replace(/\[HARNESS[^\]]*\]/gi, '')   // strip [HARNESS ...] headers
            .replace(/#{1,6}\s/g, '')              // strip markdown headers (# ## etc.)
            .replace(/^[-*]\s/gm, '')              // strip markdown list markers (- /*)
            .replace(/^\d+\.\s/gm, '')             // strip numbered list markers (1. 2. etc.)
            .replace(/\s+/g, ' ')                  // collapse all whitespace to single space
            .trim()
            .slice(0, 120);                         // hard truncation

    const lines: string[] = ['[HARNESS HOT CONTEXT — previous session summary]'];

    if (ctx.contradictions.length > 0) {
        lines.push('⚠ Contradictions to verify:');
        for (const c of ctx.contradictions) {
            lines.push(`- [${c.id.slice(0, 8)}] ${sanitize(c.content)} (needs verification)`);
        }
        lines.push('');
    }

    if (ctx.facts.length > 0) {
        lines.push('Key decisions from previous sessions:');
        for (const f of ctx.facts) {
            lines.push(`- [${f.id.slice(0, 8)}] ${sanitize(f.content)}`);
        }
    }

    return lines.join('\n');
}

// ─── Phase 1a: Contradiction Detection ──────────────────

export function detectContradiction(contentA: string, contentB: string): boolean {
    const negationPatterns = [/not/i, /no\b/i, /don'?t/i, /doesn'?t/i, /하지\s*않/, /금지/, /불가/];
    const aHasNeg = negationPatterns.some(p => p.test(contentA));
    const bHasNeg = negationPatterns.some(p => p.test(contentB));
    // Only a contradiction if one has negation and the other doesn't
    return aHasNeg !== bHasNeg;
}

// ─── Phase 1a: 3-layer Weighted Ranking ─────────────────

function getFactTypeMultiplier(fact: MemoryFact): number {
    switch (fact.origin_type) {
        case 'user_explicit': return 1.5;
        case 'execution_observed': return 1.3;
        case 'tool_result': return 1.1;
        default: return 1.0;
    }
}

export function rankFactsWithWeights(
    candidates: Array<{ fact: MemoryFact; metadata_score: number; lexical_score: number }>,
): Array<{ fact: MemoryFact; weighted_score: number }> {
    return candidates.map(c => {
        // Phase 1a-4: Exclude deprecated/superseded from ranking entirely
        if (c.fact.status === 'deprecated' || c.fact.status === 'superseded') {
            return { fact: c.fact, weighted_score: -1 };
        }

        const baseScore = (c.metadata_score + c.lexical_score) / 2;
        const typeMultiplier = getFactTypeMultiplier(c.fact);
        const confidence = c.fact.confidence ?? 0.5;

        // Phase 1a-4: Demote low-confidence unreviewed facts
        const isLowConfUnreviewed = c.fact.status === 'unreviewed' && confidence < 0.5;
        const demotionMultiplier = isLowConfUnreviewed ? 0.1 : 1.0;

        const weightedScore = baseScore * typeMultiplier * confidence * demotionMultiplier;
        return { fact: c.fact, weighted_score: weightedScore };
    }).sort((a, b) => b.weighted_score - a.weighted_score);
}

// ─── Phase 1a: Safety Fuse ──────────────────────────────

export function isPromotionBlocked(rule: Rule, projectKey: string): boolean {
    // scope: 'prompt' rules never promote (existing behavior)
    if (rule.pattern.scope === 'prompt') return true;

    // Scope mismatch: different project
    if (rule.project_key !== 'global' && rule.project_key !== projectKey) return true;

    return false;
}

export function isFactBasedPromotionBlocked(rule: Rule, projectKey: string, facts: MemoryFact[]): boolean {
    // Only check facts belonging to the current project
    const projectFacts = facts.filter(f =>
        f.project_key === projectKey
    );
    // Check if any fact linked to the rule is experimental
    const relatedFacts = projectFacts.filter(f =>
        rule.pattern.match && f.content.toLowerCase().includes(rule.pattern.match.toLowerCase())
    );
    if (relatedFacts.some(f => f.is_experimental === true)) {
        return true;
    }
    return false;
}

// ─── Phase 1a: Memory Metrics ───────────────────────────

export function appendMemoryMetrics(projectKey: string, metrics: MemoryMetricRecord): void {
    const dir = join(HARNESS_DIR, 'projects', projectKey, 'memory');
    mkdirSync(dir, { recursive: true });

    const metricsPath = getMemoryMetricsPath(projectKey);

    // Rotate if file too large
    if (existsSync(metricsPath)) {
        try {
            // Use readFileSync to check size indirectly via line count
            const content = readFileSync(metricsPath, 'utf-8');
            const lines = content.split('\n').filter(Boolean);
            if (content.length > METRICS_MAX_BYTES && lines.length > 10) {
                // Keep only last 30 days
                const cutoff = Date.now() - METRICS_ROTATE_DAYS * 24 * 60 * 60 * 1000;
                const kept = lines.filter(line => {
                    try {
                        const rec = JSON.parse(line);
                        return Date.parse(rec.ts) >= cutoff;
                    } catch { return true; }
                });
                writeFileSync(metricsPath, kept.join('\n') + '\n');
            }
        } catch { /* rotation failure non-fatal */ }
    }

    appendRecord(metricsPath, metrics);
}

function readMemoryMetrics(projectKey: string, limit = GATE_A_WINDOW): MemoryMetricRecord[] {
    const metrics = loadJsonlRecords<MemoryMetricRecord>(getMemoryMetricsPath(projectKey));
    return metrics.slice(-limit);
}

function readGateAStatus(projectKey: string): GateAStatusRecord | null {
    const statusPath = getGateAStatusPath(projectKey);
    if (!existsSync(statusPath)) return null;
    try {
        return JSON.parse(readFileSync(statusPath, 'utf-8')) as GateAStatusRecord;
    } catch {
        return null;
    }
}

function writeGateAStatus(projectKey: string, status: GateAStatusRecord): void {
    const dir = join(HARNESS_DIR, 'projects', projectKey, 'memory');
    mkdirSync(dir, { recursive: true });
    writeFileSync(getGateAStatusPath(projectKey), JSON.stringify(status, null, 2));
}

function appendGateAAlert(projectKey: string, status: GateAStatusRecord): void {
    if (status.status !== 'triggered' || !status.recommended_action) return;
    const alert: GateAAlertRecord = {
        id: generateId(),
        project_key: projectKey,
        timestamp: new Date().toISOString(),
        status: 'triggered',
        reasons: status.reasons,
        recommended_action: status.recommended_action,
        sample_count: status.sample_count,
    };
    appendRecord(getGateAAlertsPath(projectKey), alert);
}

function averageMetric(records: MemoryMetricRecord[], key: GateAConditionRecord['key']): number {
    if (records.length === 0) return 0;
    const total = records.reduce((sum, record) => sum + (record[key] ?? 0), 0);
    return total / records.length;
}

export function evaluateGateAStatus(projectKey: string, records: MemoryMetricRecord[]): GateAStatusRecord | null {
    if (records.length === 0) return null;

    const conditions = (Object.entries(GATE_A_THRESHOLDS) as Array<[GateAConditionRecord['key'], number]>).map(([key, threshold]) => {
        const averageValue = averageMetric(records, key);
        return {
            key,
            average_value: Number(averageValue.toFixed(2)),
            threshold,
            met: averageValue > threshold,
            near_threshold: averageValue >= threshold * 0.8,
        } satisfies GateAConditionRecord;
    });

    const metConditions = conditions.filter((condition) => condition.met).map((condition) => condition.key);
    const nearThresholdConditions = conditions
        .filter((condition) => !condition.met && condition.near_threshold)
        .map((condition) => condition.key);

    let status: GateAStatusRecord['status'] = 'healthy';
    if (metConditions.length >= 2) {
        status = 'triggered';
    } else if (metConditions.length === 1) {
        status = 'candidate';
    } else if (nearThresholdConditions.length > 0) {
        status = 'watch';
    }

    const reasons = conditions
        .filter((condition) => condition.met || condition.near_threshold)
        .map((condition) => `${condition.key} avg ${condition.average_value} / threshold ${condition.threshold}${condition.met ? ' (met)' : ' (watch)'}`);

    return {
        project_key: projectKey,
        evaluated_at: new Date().toISOString(),
        sample_count: records.length,
        status,
        conditions,
        met_conditions: metConditions,
        near_threshold_conditions: nearThresholdConditions,
        reasons,
        recommended_action: status === 'triggered'
            ? 'Phase 1b (minimal SQLite) 검토 권장'
            : undefined,
    };
}

export function evaluateAndPersistGateA(projectKey: string, enabled: boolean): GateAStatusRecord | null {
    if (!enabled) return null;

    const metrics = readMemoryMetrics(projectKey);
    const nextStatus = evaluateGateAStatus(projectKey, metrics);
    if (!nextStatus) return null;

    const previous = readGateAStatus(projectKey);
    const becameTriggered = nextStatus.status === 'triggered' && previous?.status !== 'triggered';
    const firstTriggeredAt = becameTriggered
        ? nextStatus.evaluated_at
        : previous?.first_triggered_at;
    const lastAlertedAt = becameTriggered
        ? nextStatus.evaluated_at
        : previous?.last_alerted_at;

    const statusToPersist: GateAStatusRecord = {
        ...nextStatus,
        first_triggered_at: firstTriggeredAt,
        last_alerted_at: lastAlertedAt,
    };

    writeGateAStatus(projectKey, statusToPersist);

    if (becameTriggered) {
        appendGateAAlert(projectKey, statusToPersist);
        logger.warn('improver', 'Gate A triggered', {
            project_key: projectKey,
            reasons: statusToPersist.reasons,
        });
    }

    return statusToPersist;
}

function formatGateAAdvisory(status: GateAStatusRecord): string {
    const reasons = status.reasons.length > 0
        ? status.reasons.map((reason) => `- ${reason}`).join('\n')
        : '- memory metrics threshold met';

    return [
        '[HARNESS MEMORY GATE A]',
        'Phase 1b 후보 상태입니다. 최소 SQLite 도입 검토를 권장합니다.',
        reasons,
    ].join('\n');
}

export function collectMemoryMetrics(
    projectKey: string,
    sessionStartTime: number,
    hotContextBuildMs: number,
    compactingBuildMs: number,
): MemoryMetricRecord {
    const loadStart = Date.now();

    const factsDir = join(HARNESS_DIR, 'memory/facts');
    const archiveDir = join(HARNESS_DIR, 'memory/archive');
    const relationsPath = join(HARNESS_DIR, 'memory/relations.jsonl');

    // Project-aware: count only current project's facts
    const allActiveFacts = existsSync(factsDir) ? loadJsonFiles<MemoryFact>(factsDir) : [];
    const projectFacts = allActiveFacts.filter(f =>
        f.project_key === projectKey
    );
    const archiveCount = existsSync(archiveDir)
        ? readdirSync(archiveDir)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                try {
                    return JSON.parse(readFileSync(join(archiveDir, f), 'utf-8')) as MemoryFact;
                } catch { return null; }
            })
            .filter(f => f && f.project_key === projectKey)
            .length
        : 0;
    const relations = loadJsonlRecords<FactRelation>(relationsPath)
        .filter(r => r.project_key === projectKey);

    const jsonFactLoadMs = Date.now() - loadStart;

    return {
        ts: new Date().toISOString(),
        phase: '1a',
        active_fact_count: projectFacts.length,
        total_fact_count: projectFacts.length + archiveCount,
        relation_count: relations.length,
        revision_count: 0,
        hot_context_build_ms: hotContextBuildMs,
        compacting_build_ms: compactingBuildMs,
        contradiction_count: projectFacts.filter(f => f.must_verify === true).length,
        facts_scanned_per_compaction: projectFacts.length,
        relations_scanned_per_lookup: relations.length,
        json_fact_load_ms: jsonFactLoadMs,
    };
}

// ─── Phase 1a: Boundary Hints ───────────────────────────

export function buildBoundaryHints(facts: MemoryFact[], ranked: Array<{ fact: MemoryFact }>): string[] {
    const hints: string[] = [];
    const factIds = new Set(facts.map(f => f.id));

    for (const entry of ranked) {
        const fact = entry.fact;
        // Count related facts (shared keywords)
        const relatedCount = facts.filter(f =>
            f.id !== fact.id &&
            f.keywords.some(k => fact.keywords.map(kk => kk.toLowerCase()).includes(k.toLowerCase()))
        ).length;

        if (relatedCount > 0) {
            const mustVerifySuffix = fact.must_verify ? ' ⚠ 검증 필요' : '';
            hints.push(`- [${fact.id.slice(0, 8)}] keywords: ${fact.keywords.join(', ')} — 관련 기억 ${relatedCount}건 있음${mustVerifySuffix}`);
        }
    }

    return hints;
}

export function normalizeFactAccess(fact: MemoryFact): MemoryFact {
    return {
        ...fact,
        last_accessed_at: fact.last_accessed_at ?? parseIsoDate(fact.created_at),
        access_count: fact.access_count ?? 0,
    };
}

function getRecentActivityBoost(value?: string): number {
    const parsed = parseIsoDate(value);
    if (!parsed) return 0;

    const ageMs = Date.now() - parsed;
    if (ageMs <= 24 * 60 * 60 * 1000) return 30;
    if (ageMs <= 7 * 24 * 60 * 60 * 1000) return 20;
    if (ageMs <= THIRTY_DAYS_MS) return 10;
    return 0;
}

function scoreFactsByQuery(facts: MemoryFact[], query: string): Array<{ fact: MemoryFact; score: number }> {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(Boolean);

    return facts
        .map((fact) => {
            const factText = `${fact.keywords.join(' ')} ${fact.content}`.toLowerCase();
            const score = queryWords.reduce((acc, word) => acc + (factText.includes(word) ? 1 : 0), 0);
            return { fact, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
}

export interface RankedSemanticRuleCandidate {
    rule: Rule;
    metadata_score: number;
    lexical_score: number;
    reasons: string[];
}

export interface RankedSemanticFactCandidate {
    fact: MemoryFact;
    metadata_score: number;
    lexical_score: number;
    reasons: string[];
}

export interface CompactionSelectionPlan {
    baseline_soft_rules: Rule[];
    applied_soft_rules: Rule[];
    semantic_soft_candidates: RankedSemanticRuleCandidate[];
    baseline_facts: MemoryFact[];
    applied_facts: MemoryFact[];
    semantic_fact_candidates: RankedSemanticFactCandidate[];
}

export function selectBaselineSoftRules(softRules: Rule[], maxResults: number): Rule[] {
    return [...softRules]
        .sort((a, b) => (b.violation_count - a.violation_count) || b.created_at.localeCompare(a.created_at))
        .slice(0, maxResults);
}

export function rankSemanticSoftRules(softRules: Rule[], projectKey: string): RankedSemanticRuleCandidate[] {
    return [...softRules]
        .map((rule) => {
            let metadataScore = 0;
            const reasons: string[] = [];

            if (rule.project_key === projectKey) {
                metadataScore += 40;
                reasons.push('project_exact');
            } else if (rule.project_key === 'global') {
                metadataScore += 10;
                reasons.push('project_global');
            }

            if (rule.pattern.scope === 'prompt') {
                metadataScore += 30;
                reasons.push('scope_prompt');
            } else if (rule.pattern.scope === 'tool') {
                metadataScore += 20;
                reasons.push('scope_tool');
            } else {
                metadataScore += 10;
                reasons.push('scope_file');
            }

            if (rule.violation_count > 0) {
                metadataScore += Math.min(rule.violation_count, 5) * 4;
                reasons.push(`violation_count:${rule.violation_count}`);
            }

            const recentViolationBoost = getRecentActivityBoost(rule.last_violation_at);
            if (recentViolationBoost > 0) {
                metadataScore += recentViolationBoost;
                reasons.push(`recent_violation:+${recentViolationBoost}`);
            }

            const recentActivityBoost = getRecentActivityBoost(rule.created_at);
            if (recentActivityBoost > 0) {
                metadataScore += Math.max(5, Math.floor(recentActivityBoost / 2));
                reasons.push(`recent_activity:+${Math.max(5, Math.floor(recentActivityBoost / 2))}`);
            }

            return {
                rule,
                metadata_score: metadataScore,
                lexical_score: 0,
                reasons,
            };
        })
        .sort((a, b) =>
            (b.metadata_score - a.metadata_score) ||
            (b.rule.violation_count - a.rule.violation_count) ||
            b.rule.created_at.localeCompare(a.rule.created_at),
        );
}

export function rankSemanticFacts(facts: MemoryFact[], projectKey: string, query: string): RankedSemanticFactCandidate[] {
    return scoreFactsByQuery(facts, query)
        .map(({ fact, score }) => {
            let metadataScore = 0;
            const reasons: string[] = [];

            if (fact.project_key === projectKey) {
                metadataScore += 40;
                reasons.push('project_exact');
            } else if (!fact.project_key) {
                metadataScore += 5;
                reasons.push('project_legacy');
            }

            const recentActivityBoost = getRecentActivityBoost(fact.created_at);
            if (recentActivityBoost > 0) {
                metadataScore += recentActivityBoost;
                reasons.push(`recent_activity:+${recentActivityBoost}`);
            }

            return {
                fact,
                metadata_score: metadataScore,
                lexical_score: score,
                reasons,
            };
        })
        .sort((a, b) =>
            (b.metadata_score - a.metadata_score) ||
            (b.lexical_score - a.lexical_score) ||
            b.fact.created_at.localeCompare(a.fact.created_at),
        );
}

export function planCompactionSelections(
    projectKey: string,
    softRules: Rule[],
    facts: MemoryFact[],
    query: string,
    maxResults: number,
    semanticCompactingEnabled: boolean,
): CompactionSelectionPlan {
    const baselineSoftRules = selectBaselineSoftRules(softRules, maxResults);
    const semanticSoftCandidates = rankSemanticSoftRules(softRules, projectKey);
    const appliedSoftRules = semanticCompactingEnabled
        ? semanticSoftCandidates.slice(0, maxResults).map((candidate) => candidate.rule)
        : baselineSoftRules;

    const baselineFacts = scoreFactsByQuery(facts, query)
        .slice(0, maxResults)
        .map((item) => item.fact);
    const semanticFactCandidates = rankSemanticFacts(facts, projectKey, query);
    const appliedFacts = semanticCompactingEnabled
        ? semanticFactCandidates.slice(0, maxResults).map((candidate) => candidate.fact)
        : baselineFacts;

    return {
        baseline_soft_rules: baselineSoftRules,
        applied_soft_rules: appliedSoftRules,
        semantic_soft_candidates: semanticSoftCandidates,
        baseline_facts: baselineFacts,
        applied_facts: appliedFacts,
        semantic_fact_candidates: semanticFactCandidates,
    };
}

function appendCompactionShadowRecord(
    projectKey: string,
    query: string,
    maxResults: number,
    filterEnabled: boolean,
    plan: CompactionSelectionPlan,
    config?: HarnessConfig,
    worktree?: string,
): CompactionRelevanceShadowRecord {
    const record: CompactionRelevanceShadowRecord = {
        id: generateId(),
        project_key: projectKey,
        timestamp: new Date().toISOString(),
        filter_enabled: filterEnabled,
        query: query.slice(0, COMPACTION_QUERY_MAX_LENGTH),
        max_results: maxResults,
        baseline_selection: {
            soft_rule_ids: plan.baseline_soft_rules.map((rule) => rule.id),
            fact_ids: plan.baseline_facts.map((fact) => fact.id),
        },
        applied_selection: {
            soft_rule_ids: plan.applied_soft_rules.map((rule) => rule.id),
            fact_ids: plan.applied_facts.map((fact) => fact.id),
        },
        shadow_candidates: [
            ...plan.semantic_soft_candidates.slice(0, maxResults).map((candidate) => ({
                candidate_id: candidate.rule.id,
                candidate_kind: 'soft_rule' as const,
                metadata_score: candidate.metadata_score,
                lexical_score: candidate.lexical_score,
                reasons: candidate.reasons,
            })),
            ...plan.semantic_fact_candidates.slice(0, maxResults).map((candidate) => ({
                candidate_id: candidate.fact.id,
                candidate_kind: 'fact' as const,
                metadata_score: candidate.metadata_score,
                lexical_score: candidate.lexical_score,
                reasons: candidate.reasons,
            })),
        ],
    };

    // Step 5g: Run compacting canary evaluation if enabled
    if (worktree) {
        try {
            const recentRecords = readRecentCompactingShadowRecords(worktree, 50);
            const evaluation = evaluateCompactingCanary(record, recentRecords, config);
            if (evaluation) {
                record.canary = {
                    evaluated: true,
                    mismatches: evaluation.mismatches,
                    confidence: evaluation.confidence,
                    reason: evaluation.reason,
                };
                appendCompactingMismatchRecord(worktree, record, evaluation);
            }
        } catch (err) {
            logger.warn('improver', 'compacting canary evaluation failed', {
                project_key: projectKey,
                error: err,
            });
        }
    }

    appendRecord(getCompactionShadowPath(projectKey), record);
    return record;
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

export function mapSignalTypeToScope(signalType: Signal['type']): Rule['pattern']['scope'] {
    switch (signalType) {
        case 'error_repeat': return 'tool';
        case 'user_feedback': return 'prompt';
        case 'fix_commit': return 'tool';
        case 'violation': return 'tool';
        case 'tool_loop': return 'tool';
        case 'retry_storm': return 'tool';
        case 'excessive_read': return 'tool';
        default: return 'tool';
    }
}

function findRule(patternMatch: string, projectKey: string): Rule | null {
    for (const type of ['soft', 'hard'] as const) {
        const dir = join(HARNESS_DIR, `rules/${type}`);
        if (!existsSync(dir)) continue;
        for (const file of readdirSync(dir)) {
            if (!file.endsWith('.json')) continue;
            try {
                const rule: Rule = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
                if (rule.pattern.match === patternMatch &&
                    (rule.project_key === projectKey || rule.project_key === 'global')) {
                    return rule;
                }
            } catch { /* 무시 */ }
        }
    }
    return null;
}

function ruleExists(patternMatch: string, projectKey: string): boolean {
    return findRule(patternMatch, projectKey) !== null;
}

function validateRuleFields(rule: Rule): boolean {
    return !!(
        rule.id &&
        rule.type &&
        rule.pattern &&
        rule.description
    );
}

export function evaluateAckAcceptance(signal: Signal, _ackPath: string): AckAcceptanceResult {
    const pattern = signal.payload.pattern || signal.payload.description;
    if (!pattern) {
        return {
            checks_passed: [],
            checks_failed: [{ check: 'rule_written', reason: 'missing_signal_pattern' }],
            verdict: 'rejected',
            reason: 'failed: rule_written (missing_signal_pattern)',
        };
    }

    const normalizedPattern = signal.type === 'fix_commit' ? escapeRegexLiteral(pattern) : pattern;

    // Check 1: rule_written
    const rule = findRule(normalizedPattern, signal.project_key);
    if (!rule) {
        return {
            checks_passed: [],
            checks_failed: [{ check: 'rule_written', reason: 'rule_file_not_found' }],
            verdict: 'rejected',
            reason: 'failed: rule_written (rule_file_not_found)',
        };
    }

    // Check 2: rule_valid
    if (!validateRuleFields(rule)) {
        return {
            checks_passed: ['rule_written'],
            checks_failed: [{ check: 'rule_valid', reason: 'rule_missing_required_fields' }],
            verdict: 'rejected',
            reason: 'failed: rule_valid (rule_missing_required_fields)',
        };
    }

    // Check 3: not_prune_candidate
    if (rule.prune_candidate && rule.prune_candidate.guard_enabled !== false) {
        return {
            checks_passed: ['rule_written', 'rule_valid'],
            checks_failed: [{ check: 'not_prune_candidate', reason: 'rule_is_prune_candidate' }],
            verdict: 'rejected',
            reason: 'failed: not_prune_candidate (rule_is_prune_candidate)',
        };
    }

    return {
        checks_passed: ['rule_written', 'rule_valid', 'not_prune_candidate'],
        checks_failed: [],
        verdict: 'accepted',
        reason: 'all_3_checks_passed',
    };
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

        // Phase 1a-7: Safety fuse — check experimental facts and scope mismatch
        if (isPromotionBlocked(rule, projectKey)) continue;
        // Only check facts belonging to the current project
        const allFacts = loadJsonFiles<MemoryFact>(join(HARNESS_DIR, 'memory/facts'))
            .filter(f => f.project_key === projectKey);
        if (isFactBasedPromotionBlocked(rule, projectKey, allFacts)) {
            logger.info('improver', 'promotion blocked: is_experimental=true', {
                rule_id: rule.id,
            });
            continue;
        }

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

function detectFixCommits(worktree: string, projectKey: string, config?: HarnessConfig): void {
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
            { cwd: worktree, encoding: 'utf-8', timeout: GIT_COMMAND_TIMEOUT_MS },
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
        if (loadJsonlRecords<MistakeSummaryShadowRecord>(getMistakeShadowPath(projectKey)).some((record) => record.commit_hash.toLowerCase() === normalizedHash)) {
            continue;
        }

        // 3번째 줄부터 파일 목록
        const files = lines.slice(2).filter((l) => l.trim().length > 0);

        appendMistakeSummaryShadow(projectKey, normalizedHash, message, files, readFixDiff(worktree, hash), config);

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
    const softRules = loadProjectRules('soft', projectKey);
    const hardRules = loadProjectRules('hard', projectKey);
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

function indexSessionFacts(projectKey: string, config?: HarnessConfig): void {
    const sessionDir = join(HARNESS_DIR, 'logs/sessions');
    if (!existsSync(sessionDir)) return;

    const factsDir = join(HARNESS_DIR, 'memory/facts');
    mkdirSync(factsDir, { recursive: true });

    // 현재 프로젝트로 범위가 명확한 세션 JSONL만 읽는다.
    // 애매한 파일까지 읽으면 다른 프로젝트 데이터가 현재 projectKey로 오염될 수 있다.
    const sessionFiles = readdirSync(sessionDir).filter((f) => {
        if (!f.endsWith('.jsonl')) return false;
        return isProjectScopedSessionLog(join(sessionDir, f), f, projectKey);
    });

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
                        const keyword = match[1].trim().slice(0, FACT_KEYWORD_MAX_LENGTH); // 길이 제한
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
            let factData: MemoryFact = {
                id,
                project_key: projectKey,
                keywords: [...new Set(fact.keywords)], // 중복 제거
                content: fact.content,
                source_session: sessionFile,
                created_at: new Date().toISOString(),
                last_accessed_at: Date.now(),
                access_count: 0,
            };
            // Phase 1a-1: Enrich metadata if enabled
            const idxSettings = getHarnessSettings(config);
            factData = enrichFactMetadata(factData, {
                rich_fact_metadata_enabled: idxSettings.rich_fact_metadata_enabled,
                confidence_threshold_active: idxSettings.confidence_threshold_active,
            });
            writeFileSync(join(factsDir, `${id}.json`), JSON.stringify(factData, null, 2));
            try {
                appendUpperMemoryExtractShadow(projectKey, factData);
            } catch (err) {
                logger.warn('improver', 'extract shadow append failed', {
                    project_key: projectKey,
                    source_session: sessionFile,
                    fact_id: factData.id,
                    error: err,
                });
            }
        }
    }
}

// ─── Phase 3: Memory Search — 키워드 매칭으로 fact 검색 ──

function searchFacts(query: string, maxResults = 10): MemoryFact[] {
    const factsDir = join(HARNESS_DIR, 'memory/facts');
    if (!existsSync(factsDir)) return [];
    const facts = loadJsonFiles<MemoryFact>(factsDir);

    return scoreFactsByQuery(facts, query)
        .slice(0, maxResults)
        .map((item) => item.fact);
}

// ─── Phase 3: Memory Consolidation — duplicate fact merging ──

function computeJaccard(a: string[], b: string[]): number {
    const sa = new Set(a.map(k => k.toLowerCase()));
    const sb = new Set(b.map(k => k.toLowerCase()));
    const intersection = [...sa].filter(x => sb.has(x)).length;
    const union = new Set([...sa, ...sb]).size;
    return union === 0 ? 0 : intersection / union;
}

function hasContentOverlap(a: string, b: string): boolean {
    if (a.length < 30 || b.length < 30) return false;
    return a.startsWith(b.slice(0, Math.floor(b.length * 0.6))) ||
           b.startsWith(a.slice(0, Math.floor(a.length * 0.6)));
}

class UnionFind {
    private parent: Map<string, string> = new Map();

    find(x: string): string {
        if (!this.parent.has(x)) this.parent.set(x, x);
        let root = x;
        while (this.parent.get(root) !== root) root = this.parent.get(root)!;
        // path compression
        let current = x;
        while (current !== root) {
            const next = this.parent.get(current)!;
            this.parent.set(current, root);
            current = next;
        }
        return root;
    }

    union(a: string, b: string): void {
        const ra = this.find(a);
        const rb = this.find(b);
        if (ra !== rb) this.parent.set(ra, rb);
    }
}

function getConsolidationShadowPath(projectKey: string): string {
    return join(HARNESS_DIR, `shadow/consolidation-shadow-${projectKey}.jsonl`);
}

function consolidateFacts(projectKey: string, config?: HarnessConfig): void {
    const factsDir = join(HARNESS_DIR, 'memory/facts');
    if (!existsSync(factsDir)) return;

    const allFacts = loadJsonFiles<MemoryFact>(factsDir)
        .filter(f => f.project_key === projectKey);
    if (allFacts.length < 2) return;

    // Build similarity groups via union-find
    const uf = new UnionFind();
    const reasons = new Map<string, string>();

    for (let i = 0; i < allFacts.length; i++) {
        for (let j = i + 1; j < allFacts.length; j++) {
            const a = allFacts[i];
            const b = allFacts[j];
            const jaccardSimilar = computeJaccard(a.keywords, b.keywords) > 0.4;
            const contentSimilar = hasContentOverlap(a.content, b.content);

            if (jaccardSimilar || contentSimilar) {
                const reason = jaccardSimilar && contentSimilar
                    ? 'jaccard+content'
                    : jaccardSimilar ? 'jaccard' : 'content';
                uf.union(a.id, b.id);
                // store the first reason observed for this pair
                const root = uf.find(a.id);
                if (!reasons.has(root)) reasons.set(root, reason);
            }

            // Phase 1a-6: Contradiction surfacing
            if (jaccardSimilar && getHarnessSettings(config).rich_fact_metadata_enabled) {
                if (detectContradiction(a.content, b.content)) {
                    // Mark both facts as needing verification
                    const factsDir = join(HARNESS_DIR, 'memory/facts');
                    for (const fact of [a, b]) {
                        if (!fact.must_verify) {
                            fact.must_verify = true;
                            const factPath = join(factsDir, `${fact.id}.json`);
                            if (existsSync(factPath)) {
                                try {
                                    writeFileSync(factPath, JSON.stringify({ ...fact, must_verify: true }, null, 2));
                                } catch { /* non-fatal */ }
                            }
                        }
                    }
                }
            }
        }
    }

    // Collect groups
    const groups = new Map<string, MemoryFact[]>();
    for (const fact of allFacts) {
        const root = uf.find(fact.id);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root)!.push(fact);
    }

    const archiveDir = join(HARNESS_DIR, 'memory/archive');
    mkdirSync(archiveDir, { recursive: true });

    // Ensure shadow dir exists
    const shadowDir = join(HARNESS_DIR, 'shadow');
    mkdirSync(shadowDir, { recursive: true });

    for (const [root, group] of groups) {
        if (group.length <= 1) continue;

        // Pick canonical: longest content (most information preserved)
        const canonical = group.reduce((best, f) =>
            f.content.length > best.content.length ? f : best, group[0]);

        // Merge keywords from all members (dedup, lowercase)
        const mergedKeywords = [...new Set(group.flatMap(f => f.keywords.map(k => k.toLowerCase())))];

        // Keep most specific project_key (prefer defined string over undefined)
        const bestProjectKey = group
            .map(f => f.project_key)
            .find(pk => pk !== undefined) ?? canonical.project_key;

        // Keep earliest created_at
        const earliestCreatedAt = group
            .map(f => f.created_at)
            .reduce((earliest, at) => at < earliest ? at : earliest, group[0].created_at);

        // Update canonical fact
        const updatedCanonical: MemoryFact = {
            ...canonical,
            project_key: bestProjectKey,
            keywords: mergedKeywords,
            created_at: earliestCreatedAt,
            // Phase 1a-6: inherit must_verify from any member
            must_verify: group.some(f => f.must_verify) ? true : canonical.must_verify,
            // Phase 1a: consolidated fact is inferred
            origin_type: 'inferred' as const,
            updated_at: new Date().toISOString(),
        };

        // Write canonical back
        writeFileSync(
            join(factsDir, `${canonical.id}.json`),
            JSON.stringify(updatedCanonical, null, 2),
        );

        // Archive non-canonical originals
        const archivedIds: string[] = [];
        for (const fact of group) {
            if (fact.id === canonical.id) continue;
            const srcPath = join(factsDir, `${fact.id}.json`);
            const dstPath = join(archiveDir, `${fact.id}.json`);
            if (existsSync(srcPath)) {
                renameSync(srcPath, dstPath);
            }
            archivedIds.push(fact.id);
        }

        // Write consolidation record
        const record: ConsolidationRecord = {
            id: generateId(),
            project_key: projectKey,
            timestamp: new Date().toISOString(),
            group_size: group.length,
            canonical_fact_id: canonical.id,
            archived_fact_ids: archivedIds,
            merged_keywords: mergedKeywords,
            reason: reasons.get(root) ?? 'unknown',
        };

        appendRecord(getConsolidationShadowPath(projectKey), record);
        logger.info('improver', 'consolidated facts', {
            canonical: canonical.id,
            archived: archivedIds,
            reason: record.reason,
        });
    }
}

// ─── 3.6b Fact Relations — discover relationships between facts ──

function relateFacts(projectKey: string): void {
    const factsDir = join(HARNESS_DIR, 'memory/facts');
    if (!existsSync(factsDir)) return;

    const allFacts = loadJsonFiles<MemoryFact>(factsDir)
        .filter(f => f.project_key === projectKey);
    if (allFacts.length < 2) return;

    const relationsPath = join(HARNESS_DIR, 'memory/relations.jsonl');
    const existingRelations = loadJsonlRecords<FactRelation>(relationsPath);

    // Build set of existing pairs for O(1) lookup
    const existingPairs = new Set<string>();
    for (const rel of existingRelations) {
        // Normalize pair key: always sort alphabetically
        const [lo, hi] = rel.fact_a_id < rel.fact_b_id
            ? [rel.fact_a_id, rel.fact_b_id]
            : [rel.fact_b_id, rel.fact_a_id];
        existingPairs.add(`${lo}::${hi}`);
    }

    const MAX_NEW_RELATIONS = 200;
    let newCount = 0;

    for (let i = 0; i < allFacts.length && newCount < MAX_NEW_RELATIONS; i++) {
        for (let j = i + 1; j < allFacts.length && newCount < MAX_NEW_RELATIONS; j++) {
            const a = allFacts[i];
            const b = allFacts[j];

            // Compute shared keywords (case-insensitive)
            const setA = new Set(a.keywords.map(k => k.toLowerCase()));
            const setB = new Set(b.keywords.map(k => k.toLowerCase()));
            const shared = [...setA].filter(k => setB.has(k));

            // Skip weak connections
            if (shared.length < 2) continue;

            // Check for duplicate
            const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
            const pairKey = `${lo}::${hi}`;
            if (existingPairs.has(pairKey)) continue;

            // Compute strength
            const minLen = Math.min(a.keywords.length, b.keywords.length);
            const strength = minLen > 0 ? shared.length / minLen : 0;

            // Determine relation type
            const sameProject = a.project_key !== undefined
                && b.project_key !== undefined
                && a.project_key === b.project_key;
            const relationType = sameProject ? 'same_topic' : 'shared_keywords';

            const relation: FactRelation = {
                id: generateId(),
                fact_a_id: lo,
                fact_b_id: hi,
                relation_type: relationType,
                shared_keywords: shared,
                strength: Math.min(strength, 1),
                project_key: projectKey,
                timestamp: new Date().toISOString(),
            };

            appendRecord(relationsPath, relation);
            existingPairs.add(pairKey);
            newCount++;
        }
    }

    if (newCount > 0) {
        logger.info('improver', 'discovered fact relations', { count: newCount });
    }
}

// ─── 3.7 compacting — 컨텍스트 주입 ────────────────────
// Phase 3: Memory Search 결과 주입 추가

export function trackFactAccess(facts: MemoryFact[]): void {
    const factsDir = join(HARNESS_DIR, 'memory/facts');
    const now = Date.now();
    for (const fact of facts) {
        const normalized = normalizeFactAccess(fact);
        normalized.access_count = (normalized.access_count ?? 0) + 1;
        normalized.last_accessed_at = now;
        const factPath = join(factsDir, `${fact.id}.json`);
        if (existsSync(factPath)) {
            writeFileSync(factPath, JSON.stringify(normalized, null, 2));
        }
    }
}

export function markFactPruneCandidates(projectKey: string, ttlDays: number, extendThreshold: number, config?: HarnessConfig): void {
    const factsDir = join(HARNESS_DIR, 'memory/facts');
    if (!existsSync(factsDir)) return;

    const now = Date.now();
    const facts = loadJsonFiles<MemoryFact>(factsDir);

    for (const fact of facts) {
        if (fact.project_key !== projectKey) continue;

        const normalized = normalizeFactAccess(fact);

        // Phase 1a-8: status-based cleanup
        const richMetadata = getHarnessSettings(config).rich_fact_metadata_enabled;
        if (richMetadata && fact.status) {
            if (fact.status === 'superseded' || fact.status === 'deprecated') {
                // Immediately archive regardless of TTL
                const srcPath = join(factsDir, `${fact.id}.json`);
                mkdirSync(join(HARNESS_DIR, 'memory/archive'), { recursive: true });
                const dstPath = join(HARNESS_DIR, 'memory/archive', `${fact.id}.json`);
                if (existsSync(srcPath)) {
                    renameSync(srcPath, dstPath);
                    logger.info('improver', 'fact archived by status', {
                        fact_id: fact.id,
                        status: fact.status,
                    });
                }
                continue;
            }
        }

        const accessCount = normalized.access_count ?? 0;
        let effectiveTtlDays = ttlDays;

        // Phase 1a-8: unreviewed + low confidence → half TTL
        if (richMetadata && fact.status === 'unreviewed' && (fact.confidence ?? 0.5) < 0.3) {
            effectiveTtlDays = Math.max(1, Math.floor(ttlDays / 2));
        }

        const effectiveTtlMs = accessCount >= extendThreshold
            ? effectiveTtlDays * 2 * 24 * 60 * 60 * 1000
            : effectiveTtlDays * 24 * 60 * 60 * 1000;

        const createdMs = parseIsoDate(fact.created_at);
        if (accessCount === 0 && (now - createdMs) >= effectiveTtlMs) {
            // Mark for prune by moving to archive (same pattern as rule prune)
            const srcPath = join(factsDir, `${fact.id}.json`);
            const archiveDir = join(HARNESS_DIR, 'memory/archive');
            mkdirSync(archiveDir, { recursive: true });
            const dstPath = join(archiveDir, `${fact.id}.json`);
            if (existsSync(srcPath)) {
                renameSync(srcPath, dstPath);
                logger.info('improver', 'fact pruned by TTL', {
                    fact_id: fact.id,
                    access_count: normalized.access_count,
                    age_days: Math.floor((now - createdMs) / (24 * 60 * 60 * 1000)),
                });
            }
        }
    }
}

export function formatFactLayer(fact: MemoryFact, layer: 1 | 2 | 3, boundaryHintEnabled = false, relatedCount = 0): string {
    const mustVerifySuffix = fact.must_verify ? ' ⚠ 검증 필요' : '';
    const hintSuffix = boundaryHintEnabled && relatedCount > 0 ? ` — 관련 기억 ${relatedCount}건 있음` : '';

    switch (layer) {
        case 1:
            return `- [${fact.id.slice(0, 8)}] keywords: ${fact.keywords.join(', ')}${hintSuffix}${mustVerifySuffix}`;
        case 2: {
            const firstSentence = fact.content.split(/[.!?]\s/)[0] || fact.content;
            return `- [${fact.id.slice(0, 8)}] ${fact.keywords.join(', ')} — ${firstSentence}${hintSuffix}${mustVerifySuffix}`;
        }
        case 3:
            return `- [${fact.source_session}] ${fact.content} (keywords: ${fact.keywords.join(', ')})${mustVerifySuffix}`;
    }
}

function buildCompactionContext(projectKey: string, worktree: string, maxResults: number, semanticCompactingEnabled: boolean, config?: HarnessConfig): string[] {
    const parts: string[] = [];
    const settings = getHarnessSettings(config);

    if (settings.gate_a_monitoring_enabled) {
        const gateAStatus = readGateAStatus(projectKey);
        if (gateAStatus?.status === 'triggered') {
            parts.push(formatGateAAdvisory(gateAStatus));
        }
    }

    // Phase 1a-3: Hot context injection (before scaffold)
    if (settings.hot_context_enabled) {
        const hotCtx = readHotContext(projectKey);
        if (hotCtx) {
            const formatted = formatHotContextForCompacting(hotCtx);
            if (formatted.trim()) {
                parts.push(formatted);
            }
        }
    }

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
    const hardRules = loadProjectRules('hard', projectKey);
    if (hardRules.length > 0) {
        const descriptions = hardRules.map((r) => `- [HARD] ${r.description} (scope: ${r.pattern.scope})`).join('\n');
        parts.push(`[HARNESS HARD RULES — MUST follow]\n${descriptions}`);
    }

    // SOFT 규칙 설명 주입 (scope:prompt의 유일한 강제 수단)
    const softRules = loadProjectRules('soft', projectKey);
    // Phase 1a: Scope facts to current project only
    const allFacts = loadJsonFiles<MemoryFact>(join(HARNESS_DIR, 'memory/facts'));
    const facts = allFacts.filter(f =>
        f.project_key === projectKey || f.project_key === 'global'
    );

    // Phase 3: Memory Search — 관련 fact 주입
    const queryText = [
        ...hardRules.map((r) => `${r.description} ${r.pattern.match}`),
        ...softRules.map((r) => `${r.description} ${r.pattern.match}`),
    ].join(' ');
    const plan = planCompactionSelections(projectKey, softRules, facts, queryText, maxResults, semanticCompactingEnabled);
    try {
        appendCompactionShadowRecord(projectKey, queryText, maxResults, semanticCompactingEnabled, plan, config, worktree);
    } catch (err) {
        logger.warn('improver', 'compaction shadow append failed', {
            project_key: projectKey,
            error: err,
        });
    }

    // Track fact access for TTL management
    if (plan.applied_facts.length > 0) {
        try {
            trackFactAccess(plan.applied_facts);
        } catch (err) {
            logger.warn('improver', 'fact access tracking failed', { error: err });
        }
    }

    if (plan.applied_soft_rules.length > 0) {
        const descriptions = plan.applied_soft_rules.map((r) => `- [SOFT] ${r.description} (scope: ${r.pattern.scope})`).join('\n');
        parts.push(`[HARNESS SOFT RULES — recommended]\n${descriptions}`);
    }

    if (plan.applied_facts.length > 0) {
        if (semanticCompactingEnabled && plan.applied_facts.length > 2) {
            // 3-layer progressive disclosure
            let ranked = plan.semantic_fact_candidates
                .filter(c => plan.applied_facts.some(f => f.id === c.fact.id));

            // Phase 1a-4: Apply weighted ranking when rich metadata enabled
            if (settings.rich_fact_metadata_enabled) {
                const weighted = rankFactsWithWeights(ranked);
                ranked = weighted.map(w => ({
                    fact: w.fact,
                    metadata_score: w.weighted_score,
                    lexical_score: 0,
                    reasons: [],
                }));
            }

            const total = ranked.length;
            const l3End = Math.max(1, Math.ceil(total * 0.3));
            const l2End = Math.min(total, l3End + Math.ceil(total * 0.4));

            const factLines: string[] = [];
            const allAppliedFacts = plan.applied_facts;

            for (let i = 0; i < total; i++) {
                const layer = i < l3End ? 3 : i < l2End ? 2 : 1;
                // Phase 1a-5: compute related count for boundary hints
                const fact = ranked[i].fact;
                const relatedCount = settings.boundary_hint_enabled
                    ? allAppliedFacts.filter(f =>
                        f.id !== fact.id &&
                        f.keywords.some(k => fact.keywords.map(kk => kk.toLowerCase()).includes(k.toLowerCase()))
                    ).length
                    : 0;
                factLines.push(formatFactLayer(ranked[i].fact, layer, settings.boundary_hint_enabled, relatedCount));
            }
            parts.push(`[HARNESS MEMORY — past decisions (layered)]\n${factLines.join('\n')}`);
        } else {
            // Original format — all facts at full detail (L3)
            const factLines = plan.applied_facts.map(
                (f) => formatFactLayer(f, 3),
            );
            parts.push(`[HARNESS MEMORY — past decisions]\n${factLines.join('\n')}`);
        }
    }

    return buildBoundedCompactionContext(parts, DIFF_MAX_CHARS);
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

            const sessionStartTime = Date.now();

            try {
                // Loop 1: fix: 커밋 감지 → fix_commit signal 생성
                detectFixCommits(ctx.worktree, projectKey, config);
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

                        const acceptance: AckAcceptanceResult = settings.ack_guard_enabled
                            ? evaluateAckAcceptance(signal, ackPath)
                            : { checks_passed: [], checks_failed: [], verdict: 'rejected' as const, reason: 'guard_disabled' };

                        appendAckRecord(projectKey, {
                            signal_id: signal.id,
                            project_key: projectKey,
                            timestamp: new Date().toISOString(),
                            state: 'written',
                            signal_type: signal.type,
                            guard_enabled: settings.ack_guard_enabled,
                            accepted: acceptance.verdict === 'accepted',
                            reason: acceptance.reason,
                            acceptance_checks_passed: acceptance.checks_passed,
                            acceptance_checks_failed: acceptance.checks_failed,
                            acceptance_verdict: acceptance.verdict,
                        });

                        if (settings.ack_guard_enabled && acceptance.verdict === 'accepted') {
                            appendAckRecord(projectKey, {
                                signal_id: signal.id,
                                project_key: projectKey,
                                timestamp: new Date().toISOString(),
                                state: 'accepted',
                                signal_type: signal.type,
                                guard_enabled: true,
                                accepted: true,
                                reason: acceptance.reason,
                                acceptance_checks_passed: acceptance.checks_passed,
                                acceptance_checks_failed: acceptance.checks_failed,
                                acceptance_verdict: acceptance.verdict,
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

            // Step 5c: candidate-first rule lifecycle (append-only)
            markPruneCandidates(projectKey, settings.prune_guard_enabled);
            recordCrossProjectPromotionCandidates(projectKey, settings.cross_project_promotion_guard_enabled);

            // Phase 3: Memory Index — 세션에서 키워드 추출
            try {
                indexSessionFacts(projectKey, config);
            } catch (err) {
                logger.error('improver', 'memory indexing failed', { error: err });
            }

            // Phase 3: Memory consolidation — merge duplicate facts
            try {
                consolidateFacts(projectKey, config);
            } catch (err) {
                logger.error('improver', 'fact consolidation failed', { error: err });
            }

            // Phase 3: Fact relations — discover relationships between facts
            try {
                relateFacts(projectKey);
            } catch (err) {
                logger.error('improver', 'fact relation discovery failed', { error: err });
            }

            // Token optimization: TTL-based fact pruning
            try {
                markFactPruneCandidates(projectKey, settings.fact_ttl_days, settings.fact_ttl_extend_threshold, config);
            } catch (err) {
                logger.error('improver', 'fact TTL pruning failed', { error: err });
            }

            // Phase 1a-2: Hot context auto-generation
            let hotContextBuildMs = 0;
            if (settings.hot_context_enabled) {
                try {
                    const hcStart = Date.now();
                    const factsDir = join(HARNESS_DIR, 'memory/facts');
                    const currentFacts = existsSync(factsDir) ? loadJsonFiles<MemoryFact>(factsDir) : [];
                    // Scope to current project only
                    const projectFacts = currentFacts.filter(f =>
                        f.project_key === projectKey
                    );
                    const hotCtx = generateHotContext(projectKey, projectFacts);
                    writeHotContext(projectKey, hotCtx);
                    hotContextBuildMs = Date.now() - hcStart;
                } catch (err) {
                    logger.warn('improver', 'hot context generation failed', { error: err });
                }
            }

            // Phase 1a-10: Memory metrics collection (always active)
            try {
                const metrics = collectMemoryMetrics(projectKey, sessionStartTime, hotContextBuildMs, 0);
                appendMemoryMetrics(projectKey, metrics);
                evaluateAndPersistGateA(projectKey, settings.gate_a_monitoring_enabled);
            } catch (err) {
                logger.warn('improver', 'memory metrics collection failed', { error: err });
            }

            // 프로젝트 상태 갱신
            updateProjectState(projectKey, ctx.worktree);
        },

        // compacting 훅: scaffold + 규칙 + memory 컨텍스트 주입
        'experimental.session.compacting': async (_input: unknown, output: { context: string[] }) => {
            const compactingStart = Date.now();
            const parts = buildCompactionContext(projectKey, ctx.worktree, settings.search_max_results, settings.semantic_compacting_enabled, config);
            for (const part of parts) {
                output.context.push(part);
            }
            const compactingMs = Date.now() - compactingStart;
            // Record compacting build time as a metrics entry
            try {
                const metrics = collectMemoryMetrics(projectKey, compactingStart, 0, compactingMs);
                appendMemoryMetrics(projectKey, metrics);
                const gateAStatus = evaluateAndPersistGateA(projectKey, settings.gate_a_monitoring_enabled);
                if (gateAStatus?.status === 'triggered' && !output.context.some((entry) => entry.includes('[HARNESS MEMORY GATE A]'))) {
                    output.context.unshift(formatGateAAdvisory(gateAStatus));
                }
            } catch { /* non-fatal */ }
        },
    };
};
