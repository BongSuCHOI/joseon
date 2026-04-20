// src/harness/canary.ts — Step 5f: Metadata-based canary evaluation for
// low-confidence deterministic phase/signal decisions.
// All canary functions are isolated here to avoid growing improver.ts further
// and to keep dependency graphs clean (no circular deps).
import { join } from 'path';
import type { ShadowDecisionRecord, CanaryMismatchRecord, CompactionRelevanceShadowRecord, CompactingCanaryMismatchRecord } from '../types.js';
import type { HarnessConfig } from '../config/index.js';
import { getHarnessSettings } from '../config/index.js';
import { HARNESS_DIR, getProjectKey, generateId, appendJsonlRecord, readJsonlFile, logger } from '../shared/index.js';

// ─── Constants ─────────────────────────────────────────────

const RECENT_RECORDS_COUNT = 50;
const CONFIDENCE_HIGH_FREQ = 5;
const CONFIDENCE_LOW_FREQ = 3;
const CONFIDENCE_HIGH = 0.7;
const CONFIDENCE_MEDIUM = 0.5;
const CONFIDENCE_LOW = 0.3;
const MISMATCH_CONFIDENCE_THRESHOLD = 0.7;
const PROMOTION_MISMATCH_RATE = 0.3;

// ─── Paths ─────────────────────────────────────────────

function phaseSignalShadowPath(worktree: string): string {
    return join(HARNESS_DIR, 'projects', getProjectKey(worktree), 'phase-signal-shadow.jsonl');
}

export function getCanaryMismatchesPath(worktree: string): string {
    return join(HARNESS_DIR, 'projects', getProjectKey(worktree), 'canary-mismatches.jsonl');
}

// ─── 2.1 Shadow record reader ──────────────────────────

export function readRecentShadowRecords(worktree: string, count: number): ShadowDecisionRecord[] {
    const filePath = phaseSignalShadowPath(worktree);
    const all = readJsonlFile<ShadowDecisionRecord>(filePath);
    return all.slice(-count).reverse();
}

// ─── 3.1 Low-confidence proxy detection ────────────────

export function isLowConfidenceProxy(record: ShadowDecisionRecord): string | null {
    if (record.kind === 'phase') {
        const ctx = record.context as Record<string, unknown> | undefined;
        if (ctx?.transition_status === 'blocked') return 'phase_blocked';
        if ((record.deterministic.phase_from ?? 0) > (record.deterministic.phase_to ?? 0)) return 'phase_regression';
    }

    if (record.kind === 'signal') {
        if (record.deterministic.signal_type === 'user_feedback') return 'user_feedback';
        if (record.deterministic.signal_type === 'error_repeat') {
            const ctx = record.context as Record<string, unknown> | undefined;
            if (ctx?.repeat_count === 2) return 'error_pre_alert';
        }
    }

    return null;
}

// ─── 4.1 Phase hint computation ────────────────────────

export function computePhaseHint(record: ShadowDecisionRecord): string {
    const ctx = record.context as Record<string, unknown> | undefined;
    if (ctx?.transition_status === 'blocked') return 'blocked_gate';
    if ((record.deterministic.phase_from ?? 0) > (record.deterministic.phase_to ?? 0)) return 'regression';
    if ((record.deterministic.phase_from ?? 0) < (record.deterministic.phase_to ?? 0)) return 'forward';
    return 'same';
}

// ─── 4.2 Signal relevance computation ──────────────────

export function computeSignalRelevance(record: ShadowDecisionRecord): string {
    const signalType = record.deterministic.signal_type;

    if (signalType === 'user_feedback') {
        const ctx = record.context as Record<string, unknown> | undefined;
        const matchedKeywords = (ctx?.matched_keywords as unknown[]) ?? [];
        if (matchedKeywords.length >= 2) return 'high';
        if (matchedKeywords.length === 1) return 'medium';
        return 'low';
    }

    if (signalType === 'error_repeat') {
        const ctx = record.context as Record<string, unknown> | undefined;
        const repeatCount = (ctx?.repeat_count as number) ?? 0;
        if (repeatCount >= 2) return 'high';
        return 'low';
    }

    return 'low';
}

// ─── 4.3 Confidence computation ────────────────────────

export function computeConfidence(proxyType: string, recentRecords: ShadowDecisionRecord[]): number {
    let frequency = 0;
    for (const r of recentRecords) {
        if (isLowConfidenceProxy(r) === proxyType) {
            frequency++;
        }
    }

    if (frequency >= CONFIDENCE_HIGH_FREQ) return CONFIDENCE_LOW;
    if (frequency < CONFIDENCE_LOW_FREQ) return CONFIDENCE_HIGH;
    return CONFIDENCE_MEDIUM;
}

// ─── 4.4 Evaluate canary ───────────────────────────────

export function evaluateCanary(
    record: ShadowDecisionRecord,
    recentRecords: ShadowDecisionRecord[],
    config?: HarnessConfig,
): { phase_hint?: string; signal_relevance?: string; confidence: number; reason: string } | null {
    const settings = getHarnessSettings(config);
    if (!settings.canary_enabled) return null;

    const proxyType = isLowConfidenceProxy(record);
    if (!proxyType) return null;

    const confidence = computeConfidence(proxyType, recentRecords);

    if (record.kind === 'phase') {
        const phaseHint = computePhaseHint(record);
        return {
            phase_hint: phaseHint,
            confidence,
            reason: `proxy=${proxyType} hint=${phaseHint} freq_based_confidence=${confidence}`,
        };
    }

    if (record.kind === 'signal') {
        const signalRelevance = computeSignalRelevance(record);
        return {
            signal_relevance: signalRelevance,
            confidence,
            reason: `proxy=${proxyType} relevance=${signalRelevance} freq_based_confidence=${confidence}`,
        };
    }

    return null;
}

// ─── 5.4 Append mismatch record ────────────────────────

export function appendMismatchRecord(
    worktree: string,
    record: ShadowDecisionRecord,
    canaryResult: NonNullable<ReturnType<typeof evaluateCanary>>,
): void {
    let isMismatch = false;

    // Phase mismatch: blocked transition AND canary is confident AND confirms blocked
    if (record.kind === 'phase') {
        const ctx = record.context as Record<string, unknown> | undefined;
        if (ctx?.transition_status === 'blocked' && canaryResult.confidence >= MISMATCH_CONFIDENCE_THRESHOLD && canaryResult.phase_hint === 'blocked_gate') {
            isMismatch = true;
        }
    }

    // Signal mismatch: NOT emitted but canary says high/medium relevance with confidence
    if (record.kind === 'signal') {
        if (!record.deterministic.emitted && (canaryResult.signal_relevance === 'high' || canaryResult.signal_relevance === 'medium') && canaryResult.confidence >= MISMATCH_CONFIDENCE_THRESHOLD) {
            isMismatch = true;
        }
    }

    if (!isMismatch) return;

    const mismatch: CanaryMismatchRecord = {
        id: generateId(),
        timestamp: new Date().toISOString(),
        project_key: getProjectKey(worktree),
        proxy_type: isLowConfidenceProxy(record) as CanaryMismatchRecord['proxy_type'],
        deterministic: {
            decision: record.kind === 'phase'
                ? `phase ${record.deterministic.phase_from}->${record.deterministic.phase_to}`
                : `signal ${record.deterministic.signal_type} emitted=${record.deterministic.emitted}`,
            detail: JSON.stringify(record.deterministic),
        },
        canary: {
            phase_hint: canaryResult.phase_hint,
            signal_relevance: canaryResult.signal_relevance,
            confidence: canaryResult.confidence,
            reason: canaryResult.reason,
        },
        shadow_record_id: record.id,
    };

    const mismatchesPath = getCanaryMismatchesPath(worktree);
    appendJsonlRecord(mismatchesPath, mismatch as unknown as Record<string, unknown>);

    logger.info('canary', 'mismatch_detected', {
        proxy_type: mismatch.proxy_type,
        confidence: canaryResult.confidence,
        shadow_id: record.id,
    });
}

// ─── 5.1/5.2 Integration helper ────────────────────────

/**
 * Run canary evaluation on a shadow record and, if applicable,
 * append a mismatch record. Called from observer
 * after their initial shadow append.
 *
 * Returns the updated shadow record with populated shadow block,
 * or null if canary did not run.
 */
export function runCanaryEvaluation(
    worktree: string,
    record: ShadowDecisionRecord,
    config?: HarnessConfig,
): ShadowDecisionRecord | null {
    const recentRecords = readRecentShadowRecords(worktree, RECENT_RECORDS_COUNT);
    const canaryResult = evaluateCanary(record, recentRecords, config);
    if (!canaryResult) return null;

    // Populate shadow block on the record
    const relevanceMap: Record<string, 'relevant' | 'irrelevant' | undefined> = { high: 'relevant', medium: 'relevant', low: 'irrelevant' };
    const evaluated: ShadowDecisionRecord = {
        ...record,
        shadow: {
            status: 'low_confidence',
            phase_hint: canaryResult.phase_hint ? Number(canaryResult.phase_hint) || undefined : undefined,
            signal_relevance: relevanceMap[canaryResult.signal_relevance ?? ''],
            confidence: canaryResult.confidence,
            reason: canaryResult.reason,
        },
    };

    // Append the evaluated shadow record
    const shadowPath = phaseSignalShadowPath(worktree);
    appendJsonlRecord(shadowPath, evaluated as unknown as Record<string, unknown>);

    // Check and record mismatches
    appendMismatchRecord(worktree, record, canaryResult);

    return evaluated;
}

// ─── 6.1/6.2 Canary aggregation report ────────────────

export interface CanaryReport {
    total: number;
    mismatches: number;
    mismatch_rate: number;
    breakdown: Record<string, { total: number; mismatches: number }>;
    promotion_candidates: string[];
}

export function generateCanaryReport(worktree: string): CanaryReport {
    const mismatchesPath = getCanaryMismatchesPath(worktree);
    const shadowPath = phaseSignalShadowPath(worktree);

    // Count canary evaluations from shadow records
    let totalCanaryEvals = 0;
    const canaryEvalByProxy: Record<string, number> = {};

    const shadowRecords = readJsonlFile<ShadowDecisionRecord>(shadowPath);
    for (const r of shadowRecords) {
        if (r.shadow?.status === 'low_confidence') {
            totalCanaryEvals++;
            const proxy = isLowConfidenceProxy(r);
            if (proxy) {
                canaryEvalByProxy[proxy] = (canaryEvalByProxy[proxy] ?? 0) + 1;
            }
        }
    }

    // Count mismatches
    let totalMismatches = 0;
    const mismatchByProxy: Record<string, number> = {};

    const mismatchRecords = readJsonlFile<CanaryMismatchRecord>(mismatchesPath);
    for (const m of mismatchRecords) {
        totalMismatches++;
        mismatchByProxy[m.proxy_type] = (mismatchByProxy[m.proxy_type] ?? 0) + 1;
    }

    // Build breakdown
    const allProxyTypes = new Set([...Object.keys(canaryEvalByProxy), ...Object.keys(mismatchByProxy)]);
    const breakdown: Record<string, { total: number; mismatches: number }> = {};
    for (const proxy of allProxyTypes) {
        breakdown[proxy] = {
            total: canaryEvalByProxy[proxy] ?? 0,
            mismatches: mismatchByProxy[proxy] ?? 0,
        };
    }

    // Promotion candidates: proxy types where mismatch rate > 30% (of total evals for that type)
    const promotionCandidates: string[] = [];
    for (const [proxy, counts] of Object.entries(breakdown)) {
        if (counts.total > 0 && (counts.mismatches / counts.total) > PROMOTION_MISMATCH_RATE) {
            promotionCandidates.push(proxy);
        }
    }

    return {
        total: totalCanaryEvals,
        mismatches: totalMismatches,
        mismatch_rate: totalCanaryEvals > 0 ? totalMismatches / totalCanaryEvals : 0,
        breakdown,
        promotion_candidates: promotionCandidates,
    };
}

// ─── Compacting canary (Step 5b shadow) ────────────────

function compactingShadowPath(worktree: string): string {
    return join(HARNESS_DIR, 'projects', getProjectKey(worktree), 'compacting-relevance-shadow.jsonl');
}

export function getCompactingCanaryMismatchesPath(worktree: string): string {
    return join(HARNESS_DIR, 'projects', getProjectKey(worktree), 'compacting-canary-mismatches.jsonl');
}

// ─── 7.1 Compacting shadow record reader ────────────────

export function readRecentCompactingShadowRecords(worktree: string, count: number): CompactionRelevanceShadowRecord[] {
    const filePath = compactingShadowPath(worktree);
    const all = readJsonlFile<CompactionRelevanceShadowRecord>(filePath);
    return all.slice(-count).reverse();
}

// ─── 7.2 Evaluate compacting canary ─────────────────────

export interface CompactingCanaryEvaluation {
    mismatches: Array<{
        type: 'rule_omission' | 'fact_omission' | 'rank_inversion';
        item_id: string;
        item_kind: 'soft_rule' | 'fact';
        detail: string;
    }>;
    confidence: number;
    reason: string;
}

export function evaluateCompactingCanary(
    record: CompactionRelevanceShadowRecord,
    recentRecords: CompactionRelevanceShadowRecord[],
    config?: HarnessConfig,
): CompactingCanaryEvaluation | null {
    const settings = getHarnessSettings(config);
    if (!settings.compacting_canary_enabled) return null;

    const mismatches: CompactingCanaryEvaluation['mismatches'] = [];

    // rule_omission: soft_rule_id in baseline but NOT in applied
    const appliedRuleSet = new Set(record.applied_selection.soft_rule_ids);
    for (const ruleId of record.baseline_selection.soft_rule_ids) {
        if (!appliedRuleSet.has(ruleId)) {
            mismatches.push({
                type: 'rule_omission',
                item_id: ruleId,
                item_kind: 'soft_rule',
                detail: `rule ${ruleId} present in baseline but omitted from applied selection`,
            });
        }
    }

    // fact_omission: fact_id in baseline but NOT in applied
    const appliedFactSet = new Set(record.applied_selection.fact_ids);
    for (const factId of record.baseline_selection.fact_ids) {
        if (!appliedFactSet.has(factId)) {
            mismatches.push({
                type: 'fact_omission',
                item_id: factId,
                item_kind: 'fact',
                detail: `fact ${factId} present in baseline but omitted from applied selection`,
            });
        }
    }

    // rank_inversion: baseline rank 0 (top-1) but semantic rank > 2 (beyond top-3)
    if (record.shadow_candidates.length > 0) {
        // Build baseline rank map: position index in baseline_selection arrays
        const baselineRuleRanks = new Map<string, number>();
        record.baseline_selection.soft_rule_ids.forEach((id, idx) => {
            baselineRuleRanks.set(id, idx);
        });

        // Sort shadow_candidates by metadata_score descending to get semantic rank
        const sortedByScore = [...record.shadow_candidates].sort(
            (a, b) => b.metadata_score - a.metadata_score,
        );

        for (let semanticIdx = 0; semanticIdx < sortedByScore.length; semanticIdx++) {
            const candidate = sortedByScore[semanticIdx];
            if (candidate.candidate_kind === 'soft_rule') {
                const baselineRank = baselineRuleRanks.get(candidate.candidate_id);
                if (baselineRank === 0 && semanticIdx > 2) {
                    mismatches.push({
                        type: 'rank_inversion',
                        item_id: candidate.candidate_id,
                        item_kind: 'soft_rule',
                        detail: `rule ${candidate.candidate_id} baseline_rank=0 (top-1) but semantic_rank=${semanticIdx} (beyond top-3)`,
                    });
                }
            }
        }
    }

    if (mismatches.length === 0) return null;

    // Compute confidence based on omission frequency in recentRecords
    let frequency = 0;
    for (const r of recentRecords) {
        const rAppliedRules = new Set(r.applied_selection.soft_rule_ids);
        const rAppliedFacts = new Set(r.applied_selection.fact_ids);
        for (const ruleId of r.baseline_selection.soft_rule_ids) {
            if (!rAppliedRules.has(ruleId)) { frequency++; break; }
        }
        if (frequency === 0) {
            for (const factId of r.baseline_selection.fact_ids) {
                if (!rAppliedFacts.has(factId)) { frequency++; break; }
            }
        }
    }

    const confidence = computeCompactingConfidence(frequency);

    const reason = `mismatches=${mismatches.length} types=[${mismatches.map(m => m.type).join(',')}] freq=${frequency} confidence=${confidence}`;

    return { mismatches, confidence, reason };
}

/**
 * Compute confidence for compacting canary based on omission frequency.
 * High frequency → low confidence (deterministic is unreliable).
 * Low frequency → high confidence (deterministic is reliable).
 */
function computeCompactingConfidence(frequency: number): number {
    if (frequency >= CONFIDENCE_HIGH_FREQ) return CONFIDENCE_LOW;
    if (frequency < CONFIDENCE_LOW_FREQ) return CONFIDENCE_HIGH;
    return CONFIDENCE_MEDIUM;
}

// ─── 7.3 Append compacting mismatch records ─────────────

export function appendCompactingMismatchRecord(
    worktree: string,
    record: CompactionRelevanceShadowRecord,
    evaluation: CompactingCanaryEvaluation,
): void {
    const mismatchesPath = getCompactingCanaryMismatchesPath(worktree);

    for (const mismatch of evaluation.mismatches) {
        // Determine baseline and applied rank
        let baselineRank = -1;
        let appliedRank = -1;

        if (mismatch.item_kind === 'soft_rule') {
            baselineRank = record.baseline_selection.soft_rule_ids.indexOf(mismatch.item_id);
            appliedRank = record.applied_selection.soft_rule_ids.indexOf(mismatch.item_id);
        } else {
            baselineRank = record.baseline_selection.fact_ids.indexOf(mismatch.item_id);
            appliedRank = record.applied_selection.fact_ids.indexOf(mismatch.item_id);
        }

        const mismatchRecord: CompactingCanaryMismatchRecord = {
            id: generateId(),
            timestamp: new Date().toISOString(),
            project_key: getProjectKey(worktree),
            mismatch_type: mismatch.type,
            item_id: mismatch.item_id,
            item_kind: mismatch.item_kind,
            baseline_rank: baselineRank,
            applied_rank: appliedRank,
            detail: mismatch.detail,
            confidence: evaluation.confidence,
            shadow_record_id: record.id,
        };

        appendJsonlRecord(mismatchesPath, mismatchRecord as unknown as Record<string, unknown>);

        logger.info('compacting-canary', 'mismatch_detected', {
            mismatch_type: mismatch.type,
            item_id: mismatch.item_id,
            confidence: evaluation.confidence,
            shadow_id: record.id,
        });
    }
}

// ─── 7.4 Compacting canary report ───────────────────────

export interface CompactingCanaryReport {
    total: number;
    mismatches: number;
    mismatch_rate: number;
    breakdown: Record<string, { total: number; mismatches: number }>;
    promotion_candidates: string[];
}

export function generateCompactingCanaryReport(worktree: string): CompactingCanaryReport {
    const shadowPath = compactingShadowPath(worktree);
    const mismatchesPath = getCompactingCanaryMismatchesPath(worktree);

    // Count canary evaluations from compacting shadow records
    let totalCanaryEvals = 0;
    const evalByMismatchType: Record<string, number> = {};

    const shadowRecords = readJsonlFile<CompactionRelevanceShadowRecord>(shadowPath);
    for (const r of shadowRecords) {
        if (r.canary?.evaluated === true) {
            totalCanaryEvals++;
            // Track which mismatch types appeared in this evaluation
            const types = new Set(r.canary.mismatches.map(m => m.type));
            for (const t of types) {
                evalByMismatchType[t] = (evalByMismatchType[t] ?? 0) + 1;
            }
            // If no mismatches, still count as evaluated (no type to track)
        }
    }

    // Count mismatches by type
    let totalMismatches = 0;
    const mismatchByType: Record<string, number> = {};

    const mismatchRecords = readJsonlFile<CompactingCanaryMismatchRecord>(mismatchesPath);
    for (const m of mismatchRecords) {
        totalMismatches++;
        mismatchByType[m.mismatch_type] = (mismatchByType[m.mismatch_type] ?? 0) + 1;
    }

    // Build breakdown by mismatch type
    const allTypes = new Set([...Object.keys(evalByMismatchType), ...Object.keys(mismatchByType)]);
    const breakdown: Record<string, { total: number; mismatches: number }> = {};
    for (const t of allTypes) {
        breakdown[t] = {
            total: evalByMismatchType[t] ?? 0,
            mismatches: mismatchByType[t] ?? 0,
        };
    }

    // Promotion candidates: types with >30% mismatch rate
    const promotionCandidates: string[] = [];
    for (const [type, counts] of Object.entries(breakdown)) {
        if (counts.total > 0 && (counts.mismatches / counts.total) > PROMOTION_MISMATCH_RATE) {
            promotionCandidates.push(type);
        }
    }

    return {
        total: totalCanaryEvals,
        mismatches: totalMismatches,
        mismatch_rate: totalCanaryEvals > 0 ? totalMismatches / totalCanaryEvals : 0,
        breakdown,
        promotion_candidates: promotionCandidates,
    };
}
