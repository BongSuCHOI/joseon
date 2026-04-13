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
        description: '최상위 에이전트 — 판단/라우팅, 대규모 작업은 @build에게 위임',
        config: {
            prompt: loadPrompt('orchestrator.md'),
            temperature: 0.1,
        },
        mode: 'primary',
    };
}

export function createBuildAgent(): AgentDefinition {
    return {
        name: 'build',
        description: 'Phase PM — Phase 1~5 관리, 서브에이전트 분배, 완료 시 리셋',
        config: {
            prompt: loadPrompt('build.md'),
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
        hidden: true,
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
        hidden: true,
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
        hidden: true,
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

export function createCrossReviewerAgent(): AgentDefinition {
    return {
        name: 'cross-reviewer',
        description: '다른 모델 코드 리뷰 서브에이전트 (최소 권한)',
        config: {
            prompt: loadPrompt('cross-reviewer.md'),
            temperature: 0.1,
        },
        mode: 'subagent',
        hidden: false,
        permission: {
            file_edit: 'deny',
            bash: 'deny',
            task: 'deny',
        },
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
        createCrossReviewerAgent(),
    ];
}
