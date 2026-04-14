// src/agents/agents.ts — 에이전트 빌더 + 등록 로직
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
        description: '최상위 에이전트 — 판단/라우팅, 대규모 작업은 @builder에게 위임',
        config: { prompt: loadPrompt('orchestrator.md'), temperature: 0.1 },
        mode: 'primary',
    };
}

function createBuilderDef(): AgentDefinition {
    return {
        name: 'builder',
        description: 'Phase PM — Phase 1~5 관리, 서브에이전트 분배, 완료 시 리셋',
        config: { prompt: loadPrompt('builder.md'), temperature: 0.1 },
        mode: 'subagent',
    };
}

function createFrontendDef(): AgentDefinition {
    return {
        name: 'frontend',
        description: '프론트엔드 구현 서브에이전트',
        config: { prompt: loadPrompt('frontend.md'), temperature: 0.1 },
        mode: 'subagent',
        hidden: false,
    };
}

function createBackendDef(): AgentDefinition {
    return {
        name: 'backend',
        description: '백엔드 구현 서브에이전트',
        config: { prompt: loadPrompt('backend.md'), temperature: 0.1 },
        mode: 'subagent',
        hidden: false,
    };
}

function createTesterDef(): AgentDefinition {
    return {
        name: 'tester',
        description: 'QA 테스트 서브에이전트',
        config: { prompt: loadPrompt('tester.md'), temperature: 0.1 },
        mode: 'subagent',
        hidden: false,
    };
}

function createReviewerDef(): AgentDefinition {
    return {
        name: 'reviewer',
        description: '코드 리뷰 서브에이전트 (읽기 전용)',
        config: { prompt: loadPrompt('reviewer.md'), temperature: 0.1 },
        mode: 'subagent',
        hidden: false,
        permission: { file_edit: 'deny' },
    };
}

function createDesignerDef(): AgentDefinition {
    return {
        name: 'designer',
        description: 'UI/UX 기획 및 디자인 시스템 설계자 — 아이디어 제안, DESIGN.md 작성, 시각적 리뷰 (코드 작성 X)',
        config: { prompt: loadPrompt('designer.md'), temperature: 0.7 },
        mode: 'subagent',
        hidden: false,
    };
}

function createExplorerDef(): AgentDefinition {
    return {
        name: 'explorer',
        description: '내부 코드베이스 검색 — 파일 위치, 코드 패턴, 심볼 참조 탐색',
        config: { prompt: loadPrompt('explorer.md'), temperature: 0.1 },
        mode: 'subagent',
        hidden: false,
    };
}

function createLibrarianDef(): AgentDefinition {
    return {
        name: 'librarian',
        description: '외부 문서/라이브러리 조사 — 공식 문서, GitHub 예시, 버전별 API 확인',
        config: { prompt: loadPrompt('librarian.md'), temperature: 0.1 },
        mode: 'subagent',
    };
}

function createCoderDef(): AgentDefinition {
    return {
        name: 'coder',
        description: '기계적 실행 전용 서브에이전트 — 단순 다중 파일 수정, 일괄 변경, 빠른 타이핑',
        config: { prompt: loadPrompt('coder.md'), temperature: 0.1 },
        mode: 'subagent',
        hidden: false,
    };
}

function createAdvisorDef(): AgentDefinition {
    return {
        name: 'advisor',
        description: '수석 아키텍트 및 시스템 분석가 — 심층 분석, 아키텍처 자문, 복잡한 디버깅',
        config: { prompt: loadPrompt('advisor.md'), temperature: 0.1 },
        mode: 'subagent',
        hidden: false,
        permission: { file_edit: 'deny' },
    };
}

export function createAgents(config?: HarnessConfig): AgentDefinition[] {
    const defs = [
        createOrchestratorDef(),
        createBuilderDef(),
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
