import type { ToolCategory, TokenOptimizerMetricsRecord } from '../types.js';
import { BUDGET_LIMITS, FILE_DEDUPER_THRESHOLD, METRICS_RECOMMENDATION_WINDOW } from '../shared/constants.js';

/** Token Optimizer feature names that can block */
export type TokenOptimizerFeature = 'pre_tool_guard' | 'loop_budget' | 'file_deduper';

/** Per-session metrics accumulator */
interface SessionMetrics {
    // Block counts per feature
    blocks: Record<TokenOptimizerFeature, number>;
    // Pass counts per feature (calls that were allowed)
    passes: Record<TokenOptimizerFeature, number>;
    // Category-level budget usage: { used, limit } per category
    budgetUsage: Partial<Record<ToolCategory, { used: number; limit: number }>>;
    // Categories where budget was exhausted at least once
    budgetExhaustions: ToolCategory[];
    // Retry after block: times agent retried same category after being blocked
    retriesAfterBlock: number;
    // Total blocks (for retry ratio calculation)
    totalBlocks: number;
}

/** Create a fresh SessionMetrics */
function createEmptyMetrics(): SessionMetrics {
    return {
        blocks: { pre_tool_guard: 0, loop_budget: 0, file_deduper: 0 },
        passes: { pre_tool_guard: 0, loop_budget: 0, file_deduper: 0 },
        budgetUsage: {},
        budgetExhaustions: [],
        retriesAfterBlock: 0,
        totalBlocks: 0,
    };
}

// Module-level maps (shared across enforcer and observer)
const sessionMetrics = new Map<string, SessionMetrics>();
const lastBlockedCategory = new Map<string, ToolCategory | null>();

/** Record a blocked call */
export function recordBlock(sessionId: string, feature: TokenOptimizerFeature, category?: ToolCategory): void {
    const metrics = sessionMetrics.get(sessionId) ?? createEmptyMetrics();
    metrics.blocks[feature]++;
    metrics.totalBlocks++;
    if (category) {
        lastBlockedCategory.set(sessionId, category);
    }
    sessionMetrics.set(sessionId, metrics);
}

/** Record a passed (allowed) call */
export function recordPass(sessionId: string, feature: TokenOptimizerFeature, category?: ToolCategory): void {
    const metrics = sessionMetrics.get(sessionId) ?? createEmptyMetrics();
    metrics.passes[feature]++;
    // Check if this is a retry after a block in the same category
    if (category) {
        const lastBlocked = lastBlockedCategory.get(sessionId);
        if (lastBlocked === category) {
            metrics.retriesAfterBlock++;
            lastBlockedCategory.set(sessionId, null);
        }
    }
    sessionMetrics.set(sessionId, metrics);
}

/** Record budget usage snapshot for a category */
export function recordBudgetUsage(sessionId: string, category: ToolCategory, used: number, limit: number): void {
    const metrics = sessionMetrics.get(sessionId) ?? createEmptyMetrics();
    metrics.budgetUsage[category] = { used, limit };
    if (used >= limit && !metrics.budgetExhaustions.includes(category)) {
        metrics.budgetExhaustions.push(category);
    }
    sessionMetrics.set(sessionId, metrics);
}

/** Record that a file was detected as changed after a deduper block (false positive) */
export function recordDeduperFalsePositive(sessionId: string): void {
    const metrics = sessionMetrics.get(sessionId) ?? createEmptyMetrics();
    // We track this as: block was overridden because file changed
    // This means the block was a false positive
    // We reuse retriesAfterBlock counter since it's "agent successfully re-read after block"
    metrics.retriesAfterBlock++;
    sessionMetrics.set(sessionId, metrics);
}

/** Get the current metrics for a session, then clear the session's tracker state */
export function collectAndClear(sessionId: string): SessionMetrics | null {
    const metrics = sessionMetrics.get(sessionId);
    if (!metrics) return null;
    sessionMetrics.delete(sessionId);
    lastBlockedCategory.delete(sessionId);
    return metrics;
}

/** Clear session tracking data (for session.created / session.deleted) */
export function clearSession(sessionId: string): void {
    sessionMetrics.delete(sessionId);
    lastBlockedCategory.delete(sessionId);
}

// ─── Recommendation Engine (v0.5) ─────────────────────

/** Recommendation produced by analyzing recent session metrics */
export interface TokenOptimizerRecommendation {
    type: 'budget_increase' | 'budget_decrease' | 'pattern_adjust' | 'deduper_adjust';
    feature: string;
    category?: ToolCategory;
    message: string;
    severity: 'info' | 'warning';
}

/**
 * Analyze recent session metrics and produce recommendations.
 * Implements the 3-session rule from §15.2 of the design doc:
 * same pattern observed in 3+ consecutive sessions triggers a recommendation.
 */
export function analyzeAndRecommend(
    recentRecords: TokenOptimizerMetricsRecord[],
    currentBudgetLimits: Record<ToolCategory, number> = BUDGET_LIMITS,
    currentDeduperThreshold: number = FILE_DEDUPER_THRESHOLD,
): TokenOptimizerRecommendation[] {
    if (recentRecords.length < 3) return [];

    const recommendations: TokenOptimizerRecommendation[] = [];
    const last = recentRecords.slice(-METRICS_RECOMMENDATION_WINDOW);

    // ─── 1. Block rate analysis (per feature) ─────────
    const avgBlockRate = last.reduce((s, r) => s + r.block_rate, 0) / last.length;
    if (avgBlockRate > 0.3 && consecutivePattern(last, r => r.block_rate > 0.3) >= 3) {
        recommendations.push({
            type: 'pattern_adjust',
            feature: 'pre_tool_guard',
            message: `평균 차단율 ${(avgBlockRate * 100).toFixed(1)}% (>30%). 정상 작업이 차단되고 있을 가능성. 위험 패턴 조정 검토 필요.`,
            severity: 'warning',
        });
    }

    // ─── 2. Retry-after-block rate (오탐율) ──────────
    const avgRetryRate = last.reduce((s, r) => s + r.retry_after_block_rate, 0) / last.length;
    if (avgRetryRate > 0.8 && consecutivePattern(last, r => r.retry_after_block_rate > 0.8) >= 3) {
        recommendations.push({
            type: 'pattern_adjust',
            feature: 'all',
            message: `차단 후 재시도율 ${(avgRetryRate * 100).toFixed(1)}% (>80%). 에이전트가 진짜 필요한 작업을 차단당하고 있음. 임계값 완화 검토.`,
            severity: 'warning',
        });
    }

    // ─── 3. Per-category budget analysis ─────────────
    const categories: ToolCategory[] = ['search', 'read', 'test', 'write', 'other'];
    for (const cat of categories) {
        const limit = currentBudgetLimits[cat];
        const sessionsWithUsage = last.filter(r => r.budget_usage[cat]);
        if (sessionsWithUsage.length < 3) continue;

        // Budget exhaustion check
        const exhaustCount = sessionsWithUsage.filter(r =>
            r.budget_exhaustions.includes(cat),
        ).length;
        if (exhaustCount >= 3) {
            const avgUsage = sessionsWithUsage.reduce((s, r) => {
                const u = r.budget_usage[cat];
                return s + (u ? u.used / u.limit : 0);
            }, 0) / sessionsWithUsage.length;
            recommendations.push({
                type: 'budget_increase',
                feature: 'loop_budget',
                category: cat,
                message: `${cat} 예산 ${limit}회가 최근 ${exhaustCount}/${sessionsWithUsage.length}세션에서 소진. 평균 사용률 ${(avgUsage * 100).toFixed(0)}%. ${limit}→${Math.ceil(limit * 1.5)} 상향 검토.`,
                severity: 'warning',
            });
        }

        // Budget underutilization check
        const avgUsageRate = sessionsWithUsage.reduce((s, r) => {
            const u = r.budget_usage[cat];
            return s + (u ? u.used / u.limit : 0);
        }, 0) / sessionsWithUsage.length;
        if (avgUsageRate < 0.25 && consecutivePattern(
            sessionsWithUsage,
            r => { const u = r.budget_usage[cat]; return u ? u.used / u.limit < 0.25 : true; },
        ) >= 3) {
            recommendations.push({
                type: 'budget_decrease',
                feature: 'loop_budget',
                category: cat,
                message: `${cat} 평균 사용률 ${(avgUsageRate * 100).toFixed(0)}% (<25%). ${limit}→${Math.ceil(limit * 0.6)} 하향 검토.`,
                severity: 'info',
            });
        }
    }

    // ─── 4. File deduper false positive analysis ──────
    const deduperBlockRate = last.reduce((s, r) => {
        const total = r.file_deduper_blocks + r.file_deduper_passes;
        return s + (total > 0 ? r.file_deduper_blocks / total : 0);
    }, 0) / last.length;
    // High retry rate after deduper block suggests false positives
    if (avgRetryRate > 0.2 && deduperBlockRate > 0.1 &&
        consecutivePattern(last, r => r.file_deduper_blocks > 0 && r.retry_after_block_rate > 0.2) >= 3) {
        recommendations.push({
            type: 'deduper_adjust',
            feature: 'file_deduper',
            message: `file_deduper 차단 후 재시도율이 높음. 임계값 ${currentDeduperThreshold}→${currentDeduperThreshold + 2} 상향 검토.`,
            severity: 'info',
        });
    }

    return recommendations;
}

/** Count how many consecutive records (from the end) match a predicate */
function consecutivePattern<T>(records: T[], pred: (r: T) => boolean): number {
    let count = 0;
    for (let i = records.length - 1; i >= 0; i--) {
        if (pred(records[i])) count++;
        else break;
    }
    return count;
}
