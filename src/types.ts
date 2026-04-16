// src/types.ts — 모든 플러그인 간의 계약 (contract)
// 플러그인별 축소 버전 재정의 금지. 반드시 import해서 사용.

export interface Signal {
    id: string;
    type: 'fix_commit' | 'error_repeat' | 'user_feedback' | 'violation';
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

export interface PhaseHistoryEntry {
    phase: number;
    entered_at: string;
    completed_at?: string;
}

export interface PhaseState {
    current_phase: number;        // 1~5
    phase_history: PhaseHistoryEntry[];
    qa_test_plan_exists: boolean;
    incomplete_phase?: number;    // 마지막 history entry에 completed_at 없으면 설정
}

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

export interface AckRecord {
    signal_id: string;
    project_key: string;
    timestamp: string;
    state: 'written' | 'accepted';
    signal_type: Signal['type'];
    guard_enabled: boolean;
    acceptance_check: 'rule_written';
    accepted: boolean;
    reason: string;
}
