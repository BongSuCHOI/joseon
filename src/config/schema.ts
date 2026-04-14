export interface AgentOverrideConfig {
    model?: string;
    temperature?: number;
    hidden?: boolean;
}

export interface HarnessSettings {
    soft_to_hard_threshold?: number;
    escalation_threshold?: number;
    max_recovery_stages?: number;
    history_max_bytes?: number;
    regex_max_length?: number;
    scaffold_match_ratio?: number;
    search_max_results?: number;
}

export interface HarnessConfig {
    agents?: Record<string, AgentOverrideConfig>;
    harness?: HarnessSettings;
}

export const DEFAULT_HARNESS_SETTINGS: Required<HarnessSettings> = {
    soft_to_hard_threshold: 2,
    escalation_threshold: 3,
    max_recovery_stages: 5,
    history_max_bytes: 1048576,
    regex_max_length: 10000,
    scaffold_match_ratio: 0.6,
    search_max_results: 10,
};

export function getHarnessSettings(config?: HarnessConfig): Required<HarnessSettings> {
    return { ...DEFAULT_HARNESS_SETTINGS, ...config?.harness };
}
