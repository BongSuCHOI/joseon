// src/index.ts — OpenCode Plugin 진입점
// export default { id, server() } 패턴 (OpenCode v1 플러그인 형식)

import { HarnessObserver } from './harness/observer.js';
import { HarnessEnforcer } from './harness/enforcer.js';
import { HarnessImprover } from './harness/improver.js';
import { HarnessOrchestrator } from './orchestrator/orchestrator.js';
import { mergeEventHandlers, parseList } from './shared/index.js';
import { createAgents } from './agents/agents.js';
import type { AgentDefinition } from './agents/agents.js';
import { loadConfig } from './config/index.js';
import { createAllHooks, createForegroundFallbackController } from './hooks/index.js';

function buildToolPermissions(denyTools: string[] | undefined): Record<string, string> {
    const permissions: Record<string, string> = {};
    if (!denyTools || denyTools.length === 0) return permissions;
    for (const tool of denyTools) {
        permissions[tool] = 'deny';
    }
    return permissions;
}

function buildMcpPermissions(allowedMcps: string[] | undefined, allMcpNames: string[]): Record<string, string> {
    const permissions: Record<string, string> = {};
    if (allMcpNames.length === 0) return permissions;
    const resolved = parseList(allowedMcps ?? [], allMcpNames);
    for (const mcp of allMcpNames) {
        permissions[`${mcp}_*`] = resolved.includes(mcp) ? 'allow' : 'deny';
    }
    return permissions;
}

function buildSkillPermissions(allowedSkills: string[] | undefined, allSkillNames: string[]): Record<string, string> {
    const permissions: Record<string, string> = {};
    if (allSkillNames.length === 0) return permissions;
    const resolved = parseList(allowedSkills ?? [], allSkillNames);
    if (resolved.length === 0) {
        permissions['skill'] = 'deny';
        return permissions;
    }
    permissions['skill'] = 'allow';
    if (!resolved.includes('*')) {
        for (const skill of allSkillNames) {
            if (!resolved.includes(skill)) {
                permissions[`skill.${skill}`] = 'deny';
            }
        }
    }
    return permissions;
}

export default {
  id: "my-harness",
  server: async (input: { project: unknown; client: unknown; $: unknown; directory: string; worktree: string }) => {
    const worktree = input.worktree || input.directory || process.cwd();
    const ctx = { worktree };
    const harnessConfig = loadConfig(worktree);
    const agents = createAgents(harnessConfig);
    const agentsByName = Object.fromEntries(agents.map((agent) => [agent.name, agent])) as Record<string, AgentDefinition>;
    const fallbackEnabled = harnessConfig?.fallback?.enabled ?? true;
    const foregroundFallback = createForegroundFallbackController(worktree, fallbackEnabled);
    const sessionAgents = new Map<string, string>();
    const observerHooks = await HarnessObserver(ctx);
    const enforcerHooks = await HarnessEnforcer(ctx, harnessConfig);
    const improverHooks = await HarnessImprover(ctx, harnessConfig);
    const orchestratorHooks = await HarnessOrchestrator(ctx);
    const extraHooks = createAllHooks({
      worktree: input.worktree,
      harnessConfig,
      agentsByName,
      foregroundFallback,
      sessionAgents,
      fallbackEnabled,
      client: input.client,
    });

    const allHooks = [observerHooks, enforcerHooks, improverHooks, orchestratorHooks, extraHooks];
    const merged = mergeEventHandlers(...allHooks);

    const result: Record<string, unknown> = { ...observerHooks, ...enforcerHooks, ...improverHooks, ...orchestratorHooks };
    for (const [key, handler] of Object.entries(merged)) {
      result[key] = handler;
    }

    (result as Record<string, unknown>).config = async (opencodeConfig: Record<string, unknown>) => {
      const agentOverrides = harnessConfig?.agents ?? {};

      const allMcpNames = extractKnownMcpNames(opencodeConfig);
      const allSkillNames = extractKnownSkillNames(opencodeConfig);

      if (!opencodeConfig.agent) {
        opencodeConfig.agent = {};
      }
      const agentMap = opencodeConfig.agent as Record<string, unknown>;
      for (const agent of agents) {
        const mergedPermission = { ...agent.permission };

        const overrides = agentOverrides[agent.name];
        const mcpPerms = buildMcpPermissions(overrides?.mcps, allMcpNames);
        for (const [key, value] of Object.entries(mcpPerms)) {
          if (mergedPermission[key] === undefined) {
            mergedPermission[key] = value;
          }
        }

        const skillPerms = buildSkillPermissions(overrides?.skills, allSkillNames);
        for (const [key, value] of Object.entries(skillPerms)) {
          if (mergedPermission[key] === undefined) {
            mergedPermission[key] = value;
          }
        }

        const toolPerms = buildToolPermissions(overrides?.deny_tools);
        for (const [key, value] of Object.entries(toolPerms)) {
          if (mergedPermission[key] === undefined) {
            mergedPermission[key] = value;
          }
        }

        const { config: agentConfig, _modelArray, _fallbackChain, ...rest } = agent;
        const pluginAgent = {
          ...rest,
          ...agentConfig,
          permission: mergedPermission,
        };
        const existingAgent = agentMap[agent.name];
        if (!existingAgent || typeof existingAgent !== 'object') {
          agentMap[agent.name] = pluginAgent;
          continue;
        }

        const existingRecord = existingAgent as Record<string, unknown>;
        const existingPermission = existingRecord.permission && typeof existingRecord.permission === 'object'
          ? existingRecord.permission as Record<string, string>
          : {};
        agentMap[agent.name] = {
          ...pluginAgent,
          ...existingRecord,
          permission: {
            ...mergedPermission,
            ...existingPermission,
          },
        };
      }

      if (!opencodeConfig.default_agent) {
        opencodeConfig.default_agent = 'orchestrator';
      }
    };

    return result;
  },
};

function extractKnownMcpNames(opencodeConfig: Record<string, unknown>): string[] {
    const mcp = (opencodeConfig.mcp ?? {}) as Record<string, unknown>;
    const serverMap = (mcp.server ?? {}) as Record<string, unknown>;
    return Object.keys(serverMap).filter(k => typeof k === 'string' && k.length > 0);
}

function extractKnownSkillNames(opencodeConfig: Record<string, unknown>): string[] {
    const skills = opencodeConfig.skill;
    if (!skills || typeof skills !== 'object' || !Array.isArray(skills)) return [];
    return (skills as unknown[]).map(s => {
        if (typeof s === 'string') return s;
        if (typeof s === 'object' && s !== null && 'name' in s) return String((s as { name: unknown }).name);
        return null;
    }).filter((s): s is string => s !== null && s.length > 0);
}
