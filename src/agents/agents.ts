// src/agents/agents.ts — 에이전트 빌더 + 등록 로직
import { readFileSync } from 'fs';
import { join } from 'path';
import type { HarnessConfig, AgentOverrideConfig } from '../config/index.js';

export interface AgentDefinition {
    name: string;
    description: string;
    config: {
        prompt: string;
        temperature?: number;
        model?: string;
    };
    mode: 'primary' | 'subagent';
    hidden?: boolean;
    permission?: Record<string, string>;
}

function loadPrompt(filename: string): string {
    const promptPath = join(__dirname, 'prompts', filename);
    return readFileSync(promptPath, 'utf-8');
}

function applyOverrides(base: AgentDefinition, overrides?: AgentOverrideConfig): AgentDefinition {
    if (!overrides) return base;
    return {
        ...base,
        hidden: overrides.hidden ?? base.hidden,
        config: {
            ...base.config,
            ...(overrides.model !== undefined && { model: overrides.model }),
            ...(overrides.temperature !== undefined && { temperature: overrides.temperature }),
        },
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
        description: 'UI/UX design, review, and implementation specialist',
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
    return defs.map((d) => applyOverrides(d, config?.agents?.[d.name]));
}
