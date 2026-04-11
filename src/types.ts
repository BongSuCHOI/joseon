// src/types.ts — 모든 플러그인 간의 계약 (contract)
// 플러그인별 축소 버전 재정의 금지. 반드시 import해서 사용.

export interface Signal {
    id: string;
    type: 'fix_commit' | 'error_repeat' | 'user_feedback' | 'violation';
    project_key: string;
    session_id?: string;
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
        status: 'effective' | 'warning' | 'needs_promotion';
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
