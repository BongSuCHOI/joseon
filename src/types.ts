// src/types.ts — 모든 플러그인 간의 계약 (contract)
// 플러그인별 축소 버전 재정의 금지. 반드시 import해서 사용.

export interface Signal {
    id: string;
    type: 'fix_commit' | 'error_repeat' | 'user_feedback' | 'violation' | 'tool_loop' | 'retry_storm' | 'excessive_read';
    project_key: string;
    session_id?: string;
    agent_id?: string;  // Step 4: 오케스트레이터/서브에이전트 식별용
    timestamp: string;
    payload: {
        description: string;
        source_file?: string;
        pattern?: string;
        recurrence_count: number;
        related_signals?: string[];
    };
    status: 'pending' | 'processing' | 'acked' | 'discarded';
}

export interface Rule {
    id: string;
    type: 'soft' | 'hard';
    project_key: string | 'global';
    created_at: string;
    promoted_at?: string;
    source_signal_id: string;
    pattern: {
        type: 'code' | 'behavior';
        match: string;
        scope: 'file' | 'tool' | 'prompt';
    };
    description: string;
    violation_count: number;
    last_violation_at?: string;
    prune_candidate?: {
        marked_at: string;
        reason: string;
        guard_enabled: boolean;
    };
    effectiveness?: {
        measured_at: string;
        recurrence_after_rule: number;
        status: 'effective' | 'warning' | 'needs_promotion' | 'unmeasurable';
    };
}

export interface ProjectState {
    project_key: string;
    project_path: string;
    soft_rule_count: number;
    hard_rule_count: number;
    pending_signal_count: number;
    hard_ratio: number;
    last_improvement_at?: string;
    last_eval_at?: string;
    eval_history: Array<{
        timestamp: string;
        hard_ratio: number;
        total_checks: number;
        passed_checks: number;
    }>;
}

// Step 4: 오케스트레이션 타입

export interface QAFailureDetail {
    timestamp: string;
    message: string;
    agent_id?: string;
}

export interface QAFailures {
    [scenarioId: string]: {
        count: number;
        last_failure_at: string;
        details: QAFailureDetail[];
    };
}

export interface EvalResult {
    total_checks: number;
    passed_checks: number;
    hard_ratio: number;
    failures: Array<{
        rule_id: string;
        description: string;
        timestamp: string;
    }>;
}

export interface ShadowDecisionRecord {
    id: string;
    kind: 'phase' | 'signal';
    project_key: string;
    session_id?: string;
    timestamp: string;
    deterministic: {
        trigger: string;
        phase_from?: number;
        phase_to?: number;
        signal_type?: Signal['type'];
        emitted?: boolean;
    };
    shadow: {
        status: 'recorded' | 'low_confidence' | 'unavailable';
        phase_hint?: number;
        signal_relevance?: 'relevant' | 'irrelevant' | 'unknown';
        confidence: number;
        reason?: string;
        model?: string;
    };
    context?: Record<string, unknown>;
}

export interface MistakeSummaryShadowRecord {
    id: string;
    project_key: string;
    timestamp: string;
    commit_hash: string;
    commit_message: string;
    affected_files: string[];
    mistake_summary: string;
    ambiguous: boolean;
}

export interface MistakePatternCandidate {
    id: string;
    project_key: string;
    timestamp: string;
    pattern_identity: string;
    pattern_keyword: string;
    pattern_paths: string[];
    source_shadow_ids: string[];
    repetition_count: number;
    candidate_threshold: number;
    status: 'pending' | 'accepted' | 'rejected';
    mistake_summary_samples: string[];
}

export interface AckAcceptanceCheckFailure {
    check: string;
    reason: string;
}

export interface AckAcceptanceResult {
    checks_passed: string[];
    checks_failed: AckAcceptanceCheckFailure[];
    verdict: 'accepted' | 'rejected';
    reason: string;
}

export interface AckRecord {
    signal_id: string;
    project_key: string;
    timestamp: string;
    state: 'written' | 'accepted';
    signal_type: Signal['type'];
    guard_enabled: boolean;
    acceptance_check?: 'rule_written';  // deprecated: pre-5h records only
    accepted: boolean;
    reason: string;
    // Step 5h: multi-check acceptance fields
    acceptance_checks_passed?: string[];
    acceptance_checks_failed?: AckAcceptanceCheckFailure[];
    acceptance_verdict?: 'accepted' | 'rejected';
}

// Phase 1a: Fact metadata literal unions
export type FactOriginType = 'user_explicit' | 'execution_observed' | 'tool_result' | 'inferred';
export type FactStatus = 'active' | 'unreviewed' | 'deprecated' | 'superseded';
export type FactSeverity = 'low' | 'medium' | 'high';

export interface MemoryFact {
    id: string;
    project_key?: string;
    keywords: string[];
    content: string;
    source_session: string;
    created_at: string;
    updated_at?: string;        // Phase 1a: revision tracking (updated_at level)
    last_accessed_at?: number;
    access_count?: number;
    // Phase 1a metadata
    origin_type?: FactOriginType;
    confidence?: number;        // 0.0 ~ 1.0
    status?: FactStatus;
    scope?: string;             // project_key-equivalent scope identifier
    evidence_count?: number;
    must_verify?: boolean;
    is_experimental?: boolean;
    severity?: FactSeverity;
    agent_role?: string;
}

export interface HotContextEntry {
    id: string;
    content: string;
    origin_type: FactOriginType;
    confidence: number;
    must_verify?: boolean;
}

export interface HotContext {
    project_key: string;
    generated_at: string;
    session_count: number;
    facts: HotContextEntry[];
    contradictions: HotContextEntry[];
}

export interface MemoryMetricRecord {
    ts: string;
    phase: string;
    active_fact_count: number;
    total_fact_count: number;
    relation_count: number;
    revision_count: number;
    hot_context_build_ms: number;
    compacting_build_ms: number;
    contradiction_count: number;
    // Temp metrics (Phase 1a only)
    facts_scanned_per_compaction?: number;
    relations_scanned_per_lookup?: number;
    json_fact_load_ms?: number;
}

export type GateAStatusLevel = 'healthy' | 'watch' | 'candidate' | 'triggered';

export interface GateAConditionRecord {
    key: 'facts_scanned_per_compaction' | 'relations_scanned_per_lookup' | 'hot_context_build_ms' | 'compacting_build_ms' | 'total_fact_count';
    average_value: number;
    threshold: number;
    met: boolean;
    near_threshold: boolean;
}

export interface GateAStatusRecord {
    project_key: string;
    evaluated_at: string;
    sample_count: number;
    status: GateAStatusLevel;
    conditions: GateAConditionRecord[];
    met_conditions: GateAConditionRecord['key'][];
    near_threshold_conditions: GateAConditionRecord['key'][];
    reasons: string[];
    recommended_action?: string;
    first_triggered_at?: string;
    last_alerted_at?: string;
}

export interface GateAAlertRecord {
    id: string;
    project_key: string;
    timestamp: string;
    status: Extract<GateAStatusLevel, 'triggered'>;
    reasons: string[];
    recommended_action: string;
    sample_count: number;
}

export interface UpperMemoryExtractShadowRecord {
    id: string;
    project_key: string;
    timestamp: string;
    stage: 'extract';
    source: 'session_log';
    fact_id: string;
    source_session: string;
    keywords: string[];
    content: string;
}

export interface CompactionShadowCandidateRecord {
    candidate_id: string;
    candidate_kind: 'soft_rule' | 'fact';
    metadata_score: number;
    lexical_score: number;
    reasons: string[];
}

export interface CompactionRelevanceShadowRecord {
    id: string;
    project_key: string;
    timestamp: string;
    filter_enabled: boolean;
    query: string;
    max_results: number;
    baseline_selection: {
        soft_rule_ids: string[];
        fact_ids: string[];
    };
    applied_selection: {
        soft_rule_ids: string[];
        fact_ids: string[];
    };
    shadow_candidates: CompactionShadowCandidateRecord[];
    canary?: {
        evaluated: boolean;
        mismatches: Array<{
            type: 'rule_omission' | 'fact_omission' | 'rank_inversion';
            item_id: string;
            item_kind: 'soft_rule' | 'fact';
            detail: string;
        }>;
        confidence: number;
        reason: string;
    };
}

export interface RulePruneCandidateRecord {
    id: string;
    project_key: string;
    rule_id: string;
    timestamp: string;
    pattern_match: string;
    pattern_scope: Rule['pattern']['scope'];
    reason: string;
    guard_enabled: boolean;
}

export interface CrossProjectPromotionCandidateRecord {
    id: string;
    project_key: 'global';
    timestamp: string;
    candidate_key: string;
    pattern_match: string;
    pattern_scope: Rule['pattern']['scope'];
    project_keys: string[];
    rule_ids: string[];
    occurrence_count: number;
    guard_enabled: boolean;
}

export interface CanaryMismatchRecord {
    id: string;
    timestamp: string;
    project_key: string;
    proxy_type: 'phase_blocked' | 'phase_regression' | 'user_feedback' | 'error_pre_alert';
    deterministic: {
        decision: string;
        detail: string;
    };
    canary: {
        phase_hint?: string;
        signal_relevance?: string;
        confidence: number;
        reason: string;
    };
    shadow_record_id: string;
}

export interface CompactingCanaryMismatchRecord {
    id: string;
    timestamp: string;
    project_key: string;
    mismatch_type: 'rule_omission' | 'fact_omission' | 'rank_inversion';
    item_id: string;
    item_kind: 'soft_rule' | 'fact';
    baseline_rank: number;
    applied_rank: number;  // -1 if not in applied
    detail: string;
    confidence: number;
    shadow_record_id: string;
}

export interface ConsolidationRecord {
    id: string;
    project_key: string;
    timestamp: string;
    group_size: number;
    canonical_fact_id: string;
    archived_fact_ids: string[];
    merged_keywords: string[];
    reason: string;
}

export interface FactRelation {
    id: string;
    fact_a_id: string;
    fact_b_id: string;
    relation_type: 'same_topic' | 'shared_keywords';
    shared_keywords: string[];
    strength: number; // 0-1 based on overlap ratio
    project_key: string;
    timestamp: string;
}

// ─── Token Optimizer v0 types ──────────────────────────

export type ToolCategory = 'search' | 'read' | 'test' | 'write' | 'other';

export interface DangerPattern {
    regex: RegExp;
    alternative: string;
    label: string;
}
