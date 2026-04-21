export interface ModelEntry {
    id: string;
    variant?: string;
}

export interface AgentOverrideConfig {
    model?: string | Array<string | ModelEntry>;
    temperature?: number;
    hidden?: boolean;
    variant?: string;
    skills?: string[];
    mcps?: string[];
    options?: Record<string, unknown>;
    prompt?: string;
    append_prompt?: string;
    deny_tools?: string[];
}

export interface FallbackConfig {
    enabled?: boolean;
    chains?: Record<string, string[]>;
}

export interface HarnessSettings {
    soft_to_hard_threshold?: number;
    escalation_threshold?: number;
    max_recovery_stages?: number;
    history_max_bytes?: number;
    regex_max_length?: number;
    scaffold_match_ratio?: number;
    search_max_results?: number;
    max_subagent_depth?: number;
    ack_guard_enabled?: boolean;
    semantic_compacting_enabled?: boolean;
    prune_guard_enabled?: boolean;
    cross_project_promotion_guard_enabled?: boolean;
    auto_update_checker_enabled?: boolean;
    candidate_threshold?: number;
    canary_enabled?: boolean;
    compacting_canary_enabled?: boolean;
    tool_loop_threshold?: number;
    retry_storm_threshold?: number;
    excessive_read_threshold?: number;
    fact_ttl_days?: number;
    fact_ttl_extend_threshold?: number;
    // Phase 1a settings
    hot_context_enabled?: boolean;
    rich_fact_metadata_enabled?: boolean;
    confidence_threshold_active?: number;
    boundary_hint_enabled?: boolean;
    gate_a_monitoring_enabled?: boolean;
}

export interface HarnessConfig {
    agents?: Record<string, AgentOverrideConfig>;
    harness?: HarnessSettings;
    fallback?: FallbackConfig;
}

export const DEFAULT_HARNESS_SETTINGS: Required<HarnessSettings> = {
    soft_to_hard_threshold: 2,
    escalation_threshold: 3,
    max_recovery_stages: 5,
    history_max_bytes: 1048576,
    regex_max_length: 10000,
    scaffold_match_ratio: 0.6,
    search_max_results: 10,
    max_subagent_depth: 3,
    ack_guard_enabled: false,
    semantic_compacting_enabled: false,
    prune_guard_enabled: false,
    cross_project_promotion_guard_enabled: false,
    auto_update_checker_enabled: false,
    candidate_threshold: 3,
    canary_enabled: false,
    compacting_canary_enabled: false,
    tool_loop_threshold: 5,
    retry_storm_threshold: 3,
    excessive_read_threshold: 4,
    fact_ttl_days: 30,
    fact_ttl_extend_threshold: 5,
    // Phase 1a defaults (all off)
    hot_context_enabled: false,
    rich_fact_metadata_enabled: false,
    confidence_threshold_active: 0.7,
    boundary_hint_enabled: false,
    gate_a_monitoring_enabled: false,
};

export function getHarnessSettings(config?: HarnessConfig): Required<HarnessSettings> {
    return { ...DEFAULT_HARNESS_SETTINGS, ...config?.harness };
}
