// src/agents/agents.ts — 에이전트 빌더 + 등록 로직
import { readFileSync } from 'fs';
import { join } from 'path';

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
    // 로컬 플러그인 배포 위치 기준: .opencode/plugins/harness/agents/prompts/
    const promptPath = join(__dirname, 'prompts', filename);
    return readFileSync(promptPath, 'utf-8');
}

export function createOrchestratorAgent(): AgentDefinition {
    return {
        name: 'orchestrator',
        description: '최상위 에이전트 — 판단/라우팅, 대규모 작업은 @builder에게 위임',
        config: {
            prompt: loadPrompt('orchestrator.md'),
            temperature: 0.1,
        },
        mode: 'primary',
    };
}

export function createBuildAgent(): AgentDefinition {
    return {
        name: 'builder',
        description: 'Phase PM — Phase 1~5 관리, 서브에이전트 분배, 완료 시 리셋',
        config: {
            prompt: loadPrompt('builder.md'),
            temperature: 0.1,
        },
        mode: 'subagent',
    };
}

export function createFrontendAgent(): AgentDefinition {
    return {
        name: 'frontend',
        description: '프론트엔드 구현 서브에이전트',
        config: {
            prompt: loadPrompt('frontend.md'),
            temperature: 0.1,
        },
        mode: 'subagent',
        hidden: false,
    };
}

export function createBackendAgent(): AgentDefinition {
    return {
        name: 'backend',
        description: '백엔드 구현 서브에이전트',
        config: {
            prompt: loadPrompt('backend.md'),
            temperature: 0.1,
        },
        mode: 'subagent',
        hidden: false,
    };
}

export function createTesterAgent(): AgentDefinition {
    return {
        name: 'tester',
        description: 'QA 테스트 서브에이전트',
        config: {
            prompt: loadPrompt('tester.md'),
            temperature: 0.1,
        },
        mode: 'subagent',
        hidden: false,
    };
}

export function createReviewerAgent(): AgentDefinition {
    return {
        name: 'reviewer',
        description: '코드 리뷰 서브에이전트 (읽기 전용)',
        config: {
            prompt: loadPrompt('reviewer.md'),
            temperature: 0.1,
        },
        mode: 'subagent',
        hidden: false,
        permission: { file_edit: 'deny' },
    };
}

export function createDesignerAgent(): AgentDefinition {
    return {
        name: 'designer',
        description: 'UI/UX design, review, and implementation specialist',
        config: {
            prompt: loadPrompt('designer.md'),
            temperature: 0.7,
        },
        mode: 'subagent',
        hidden: false,
    };
}

export function createExplorerAgent(): AgentDefinition {
    return {
        name: 'explorer',
        description: '내부 코드베이스 검색 — 파일 위치, 코드 패턴, 심볼 참조 탐색',
        config: {
            prompt: loadPrompt('explorer.md'),
            temperature: 0.1,
        },
        mode: 'subagent',
        hidden: false,
    };
}

export function createLibrarianAgent(): AgentDefinition {
    return {
        name: 'librarian',
        description: '외부 문서/라이브러리 조사 — 공식 문서, GitHub 예시, 버전별 API 확인',
        config: {
            prompt: loadPrompt('librarian.md'),
            temperature: 0.1,
        },
        mode: 'subagent',
        hidden: false,
    };
}

export function createAgents(): AgentDefinition[] {
    return [
        createOrchestratorAgent(),
        createBuildAgent(),
        createFrontendAgent(),
        createBackendAgent(),
        createTesterAgent(),
        createReviewerAgent(),
        createDesignerAgent(),
        createExplorerAgent(),
        createLibrarianAgent(),
    ];
}
