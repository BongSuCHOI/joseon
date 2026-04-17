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
};

export function getHarnessSettings(config?: HarnessConfig): Required<HarnessSettings> {
    return { ...DEFAULT_HARNESS_SETTINGS, ...config?.harness };
}
