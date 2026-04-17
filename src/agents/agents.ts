// src/agents/agents.ts — agent registration logic
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { HarnessConfig, AgentOverrideConfig, FallbackConfig } from '../config/index.js';
import { logger } from '../shared/logger.js';

export interface AgentDefinition {
    name: string;
    description: string;
    config: {
        prompt: string;
        temperature?: number;
        model?: string;
        variant?: string;
        options?: Record<string, unknown>;
    };
    mode: 'primary' | 'subagent';
    hidden?: boolean;
    permission?: Record<string, string>;
    _modelArray?: string[];
    _fallbackChain?: string[];
}

function loadPrompt(filename: string): string {
    const promptPath = join(__dirname, 'prompts', filename);
    return readFileSync(promptPath, 'utf-8');
}

function resolveModelValue(modelValue: string | { id: string; variant?: string }): string {
    return typeof modelValue === 'string' ? modelValue : modelValue.id;
}

function applyOverrides(
    base: AgentDefinition,
    overrides?: AgentOverrideConfig,
    fallback?: FallbackConfig,
): AgentDefinition {
    if (!overrides && !fallback) return base;

    let modelArray: string[] | undefined;
    let effectiveModel = base.config.model;
    let effectiveVariant = base.config.variant;
    let effectiveOptions = base.config.options;
    let prompt = base.config.prompt;

    if (overrides) {
        if (overrides.model !== undefined) {
            if (Array.isArray(overrides.model)) {
                modelArray = overrides.model.map(resolveModelValue);
                effectiveModel = modelArray[0];
            } else {
                effectiveModel = overrides.model;
            }
        }

        if (overrides.variant !== undefined) {
            effectiveVariant = overrides.variant;
        }

        if (overrides.prompt !== undefined) {
            if (existsSync(overrides.prompt)) {
                try {
                    prompt = readFileSync(overrides.prompt, 'utf-8');
                } catch (err) {
                    logger.warn('agents', `Failed to load prompt file: ${overrides.prompt}`, {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            } else {
                logger.warn('agents', `Prompt file not found, using default: ${overrides.prompt}`);
            }
        }

        if (overrides.append_prompt !== undefined) {
            if (existsSync(overrides.append_prompt)) {
                try {
                    prompt = prompt + '\n\n' + readFileSync(overrides.append_prompt, 'utf-8');
                } catch (err) {
                    logger.warn('agents', `Failed to load append_prompt file: ${overrides.append_prompt}`, {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            } else {
                logger.warn('agents', `append_prompt file not found, skipping: ${overrides.append_prompt}`);
            }
        }

        if (overrides.options !== undefined) {
            effectiveOptions = { ...base.config.options, ...overrides.options };
        }
    }

    let fallbackChain: string[] | undefined;
    if (modelArray && modelArray.length > 1) {
        fallbackChain = modelArray;
    } else if (fallback?.chains?.[base.name]) {
        fallbackChain = fallback.chains[base.name];
    }

    return {
        ...base,
        ...(overrides?.hidden !== undefined && { hidden: overrides.hidden }),
        config: {
            ...base.config,
            prompt,
            ...(effectiveModel !== undefined && { model: effectiveModel }),
            ...(effectiveVariant !== undefined && { variant: effectiveVariant }),
            ...(overrides?.temperature !== undefined && { temperature: overrides.temperature }),
            ...(effectiveOptions !== undefined && { options: effectiveOptions }),
        },
        _modelArray: modelArray,
        _fallbackChain: fallbackChain,
    };
}

function createOrchestratorDef(): AgentDefinition {
    return {
        name: 'orchestrator',
        description: '최상위 라우터 — 대화/단순 요청은 직접 처리하고, 전문 작업은 적절한 서브에이전트로 라우팅',
        config: { prompt: loadPrompt('orchestrator.md'), temperature: 0.1 },
        mode: 'primary',
    };
}

function createFrontendDef(): AgentDefinition {
    return {
        name: 'frontend',
        description: 'UI 구현 전문 서브에이전트',
        config: { prompt: loadPrompt('frontend.md'), temperature: 0.1 },
        mode: 'subagent',
        hidden: false,
    };
}

function createBackendDef(): AgentDefinition {
    return {
        name: 'backend',
        description: '서버 및 비즈니스 로직 구현 전문 서브에이전트',
        config: { prompt: loadPrompt('backend.md'), temperature: 0.1 },
        mode: 'subagent',
        hidden: false,
    };
}

function createTesterDef(): AgentDefinition {
    return {
        name: 'tester',
        description: '테스트 작성과 검증을 맡는 QA 전문 서브에이전트',
        config: { prompt: loadPrompt('tester.md'), temperature: 0.1 },
        mode: 'subagent',
        hidden: false,
    };
}

function createReviewerDef(): AgentDefinition {
    return {
        name: 'reviewer',
        description: '읽기 전용 코드 리뷰 전문 서브에이전트',
        config: { prompt: loadPrompt('reviewer.md'), temperature: 0.1 },
        mode: 'subagent',
        hidden: false,
        permission: { file_edit: 'deny' },
    };
}

function createDesignerDef(): AgentDefinition {
    return {
        name: 'designer',
        description: 'UI/UX 아이디어와 DESIGN.md 작성을 맡는 디자인 전문 서브에이전트',
        config: { prompt: loadPrompt('designer.md'), temperature: 0.7 },
        mode: 'subagent',
        hidden: false,
    };
}

function createExplorerDef(): AgentDefinition {
    return {
        name: 'explorer',
        description: '내부 코드베이스를 읽기 전용으로 탐색하는 검색 전문 서브에이전트',
        config: { prompt: loadPrompt('explorer.md'), temperature: 0.1 },
        mode: 'subagent',
        hidden: false,
        permission: { file_edit: 'deny' },
    };
}

function createLibrarianDef(): AgentDefinition {
    return {
        name: 'librarian',
        description: '외부 문서와 라이브러리를 읽기 전용으로 조사하는 연구 전문 서브에이전트',
        config: { prompt: loadPrompt('librarian.md'), temperature: 0.1 },
        mode: 'subagent',
        permission: { file_edit: 'deny' },
    };
}

function createCoderDef(): AgentDefinition {
    return {
        name: 'coder',
        description: '정확한 지시를 빠르게 실행하는 기계적 편집 전문 서브에이전트',
        config: { prompt: loadPrompt('coder.md'), temperature: 0.1 },
        mode: 'subagent',
        hidden: false,
    };
}

function createAdvisorDef(): AgentDefinition {
    return {
        name: 'advisor',
        description: '아키텍처와 디버깅을 돕는 읽기 전용 전략 자문 서브에이전트',
        config: { prompt: loadPrompt('advisor.md'), temperature: 0.1 },
        mode: 'subagent',
        hidden: false,
        permission: { file_edit: 'deny' },
    };
}

export function createAgents(config?: HarnessConfig): AgentDefinition[] {
    const defs = [
        createOrchestratorDef(),
        createFrontendDef(),
        createBackendDef(),
        createTesterDef(),
        createReviewerDef(),
        createDesignerDef(),
        createExplorerDef(),
        createLibrarianDef(),
        createCoderDef(),
        createAdvisorDef(),
    ];
    return defs.map((d) => applyOverrides(d, config?.agents?.[d.name], config?.fallback));
}
