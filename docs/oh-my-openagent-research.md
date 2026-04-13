# oh-my-openagent (OmO) — Full Research Dump

**Repository**: https://github.com/code-yeongyu/oh-my-openagent  
**Branch**: `dev`  
**Stars**: 51.1k  
**Description**: "omo; the best agent harness - previously oh-my-opencode"

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Plugin Entry Point & Config Callback](#plugin-entry-point--config-callback)
3. [Agent Registration Pattern](#agent-registration-pattern)
4. [Agent Type System](#agent-type-system)
5. [Dynamic Prompt Builder](#dynamic-prompt-builder)
6. [Sisyphus (Primary Orchestrator) — Full Prompt](#sisyphus-primary-orchestrator--full-prompt)
7. [Hephaestus (Autonomous Deep Worker) — Full Prompt](#hephaestus-autonomous-deep-worker--full-prompt)
8. [Atlas (Master Orchestrator for Plans) — Full Prompt](#atlas-master-orchestrator-for-plans--full-prompt)
9. [Prometheus (Strategic Planner) — Full Prompt](#prometheus-strategic-planner--full-prompt)
10. [Oracle (Read-Only Consultant) — Full Prompt](#oracle-read-only-consultant--full-prompt)
11. [Librarian (External Docs/OSS Search) — Full Prompt](#librarian-external-docsoss-search--full-prompt)
12. [Explore (Internal Codebase Grep) — Full Prompt](#explore-internal-codebase-grep--full-prompt)
13. [Metis (Pre-Planning Consultant) — Full Prompt](#metis-pre-planning-consultant--full-prompt)
14. [Momus (Plan Reviewer) — Full Prompt](#momus-plan-reviewer--full-prompt)
15. [Multimodal Looker — Full Prompt](#multimodal-looker--full-prompt)
16. [Sisyphus-Junior (Focused Task Executor) — Full Prompt](#sisyphus-junior-focused-task-executor--full-prompt)
17. [What OmO Has That Slim Removed](#what-omo-has-that-slim-removed)
18. [Key Patterns for Our Implementation](#key-patterns-for-our-implementation)

---

## Architecture Overview

### Source Tree (`src/agents/`)
```
src/
├── index.ts                        # Plugin entry (legacy pattern)
├── plugin-interface.ts             # Creates PluginInterface with config callback
├── create-managers.ts              # Creates BackgroundManager, TmuxSessionManager, configHandler
├── create-hooks.ts                 # All hooks
├── create-tools.ts                 # All tools
├── plugin-handlers/
│   ├── config-handler.ts           # Config callback orchestrator
│   ├── agent-config-handler.ts     # Agent registration into config.agent
│   ├── tool-config-handler.ts      # Tool registration
│   ├── mcp-config-handler.ts       # MCP registration
│   └── command-config-handler.ts   # Command registration
├── agents/
│   ├── index.ts                    # Barrel exports
│   ├── types.ts                    # AgentMode, AgentFactory, AgentPromptMetadata, etc.
│   ├── agent-builder.ts            # buildAgent() factory with category/skill resolution
│   ├── builtin-agents.ts           # createBuiltinAgents() - main agent creation
│   ├── builtin-agents/
│   │   ├── sisyphus-agent.ts       # Sisyphus config with model resolution
│   │   ├── hephaestus-agent.ts     # Hephaestus config
│   │   ├── atlas-agent.ts          # Atlas config
│   │   └── general-agents.ts       # Other agents (oracle, librarian, explore, etc.)
│   ├── sisyphus.ts                 # Sisyphus prompt (Claude-optimized default)
│   ├── sisyphus/
│   │   ├── default.ts              # Sisyphus default prompt (Claude)
│   │   ├── gpt.ts                  # Sisyphus GPT-5 prompt
│   │   ├── gpt-5-4.ts              # Sisyphus GPT-5.4 prompt (8-block architecture)
│   │   └── gemini.ts               # Sisyphus Gemini prompt
│   ├── hephaestus/
│   │   ├── index.ts                # Barrel export
│   │   ├── agent.ts                # createHephaestusAgent()
│   │   ├── gpt.ts                  # GPT prompt (primary for Hephaestus)
│   │   ├── gpt-5-4.ts              # GPT-5.4 prompt
│   │   └── gpt-5-3-codex.ts        # GPT-5.3-Codex prompt
│   ├── atlas/
│   │   ├── index.ts                # Barrel export
│   │   ├── agent.ts                # createAtlasAgent()
│   │   ├── default.ts              # Claude prompt
│   │   ├── default-prompt-sections.ts  # Atlas prompt sections
│   │   ├── shared-prompt.ts        # buildAtlasPrompt() assembler
│   │   ├── prompt-section-builder.ts   # Dynamic sections
│   │   ├── gpt.ts                  # GPT prompt
│   │   └── gemini.ts               # Gemini prompt
│   ├── prometheus/
│   │   ├── index.ts                # Barrel export
│   │   ├── system-prompt.ts        # PROMETHEUS_SYSTEM_PROMPT assembler
│   │   ├── identity-constraints.ts # Core identity + absolute constraints
│   │   ├── interview-mode.ts       # Phase 1: Interview strategies
│   │   ├── plan-generation.ts      # Phase 2: Plan generation + Metis
│   │   ├── plan-template.ts        # Plan markdown template
│   │   ├── high-accuracy-mode.ts   # Phase 3: Momus review loop
│   │   ├── behavioral-summary.ts   # Cleanup + handoff
│   │   ├── gpt.ts                  # GPT-optimized prompt
│   │   └── gemini.ts               # Gemini-optimized prompt
│   ├── oracle.ts                   # createOracleAgent() + dual prompts
│   ├── librarian.ts                # createLibrarianAgent()
│   ├── explore.ts                  # createExploreAgent()
│   ├── metis.ts                    # createMetisAgent()
│   ├── momus.ts                    # createMomusAgent() + dual prompts
│   ├── multimodal-looker.ts        # createMultimodalLookerAgent()
│   ├── sisyphus-junior/
│   │   ├── index.ts                # Barrel export
│   │   ├── agent.ts                # createSisyphusJuniorAgentWithOverrides()
│   │   ├── default.ts              # Claude prompt
│   │   ├── gpt.ts, gpt-5-4.ts, gpt-5-3-codex.ts, gemini.ts
│   ├── dynamic-agent-prompt-builder.ts      # Barrel export
│   ├── dynamic-agent-prompt-types.ts         # Types
│   ├── dynamic-agent-tool-categorization.ts  # Tool categorization
│   ├── dynamic-agent-core-sections.ts        # Core prompt sections
│   ├── dynamic-agent-policy-sections.ts      # Policy prompt sections
│   └── dynamic-agent-category-skills-guide.ts # Category+skills guide
```

### Agent Hierarchy
```
Sisyphus (primary, default agent)
├── Hephaestus (primary, deep worker)
├── Prometheus (subagent, planner)
│   ├── Metis (subagent, pre-planning consultant)
│   └── Momus (subagent, plan reviewer)
├── Atlas (primary, plan orchestrator)
│   └── Sisyphus-Junior (subagent, spawned by category, direct executor)
├── Oracle (subagent, read-only consultant)
├── Librarian (subagent, external search)
├── Explore (subagent, internal search)
└── Multimodal Looker (subagent, media analysis)
```

### Agent Roles Summary

| Agent | Mode | Role | Model | Cost |
|-------|------|------|-------|------|
| Sisyphus | primary | Main orchestrator, routing, delegation | claude-opus-4-6 / kimi-k2.5 / glm-5 | EXPENSIVE |
| Hephaestus | primary | Autonomous deep worker, end-to-end execution | gpt-5.4 | EXPENSIVE |
| Atlas | primary | Plan orchestrator, todo list completion | varies | EXPENSIVE |
| Prometheus | subagent | Strategic planner, interview mode | claude-opus-4-6 | EXPENSIVE |
| Metis | subagent | Pre-planning consultant, gap analysis | varies | EXPENSIVE |
| Momus | subagent | Plan reviewer, blocker-finder | varies | EXPENSIVE |
| Oracle | subagent | Read-only architecture/debugging consultant | varies | EXPENSIVE |
| Librarian | subagent | External docs/OSS code search | varies | CHEAP |
| Explore | subagent | Internal codebase grep/search | varies | FREE |
| Multimodal Looker | subagent | Media analysis (PDFs, images) | varies | CHEAP |
| Sisyphus-Junior | subagent | Focused task executor (category-spawned) | claude-sonnet-4-6 | varies |

---

## Plugin Entry Point & Config Callback

### `src/index.ts` — Plugin Entry Point

```typescript
import type { Plugin } from "@opencode-ai/plugin"

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  // 1. Initialize config context
  initConfigContext("opencode", null)
  
  // 2. Load plugin config from oh-my-openagent.jsonc / oh-my-openagent.json
  const pluginConfig = loadPluginConfig(ctx.directory, ctx)
  
  // 3. Create managers (background, tmux, skill-mcp, CONFIG HANDLER)
  const managers = createManagers({ ctx, pluginConfig, ... })
  
  // 4. Create tools
  const toolsResult = await createTools({ ctx, pluginConfig, managers })
  
  // 5. Create hooks
  const hooks = createHooks({ ctx, pluginConfig, ... })
  
  // 6. Create plugin interface (ALL handlers including config callback)
  const pluginInterface = createPluginInterface({ ctx, pluginConfig, managers, hooks, tools })
  
  return {
    name: "oh-my-openagent",
    ...pluginInterface,    // <-- includes config callback
    
    // Compaction hook inline
    "experimental.session.compacting": async (_input, output) => { ... }
  }
}

export default OhMyOpenCodePlugin
```

### `src/plugin-interface.ts` — Config Callback Wiring

```typescript
export function createPluginInterface(args): PluginInterface {
  return {
    tool: tools,
    "chat.params": ...,
    "chat.headers": ...,
    "command.execute.before": ...,
    "chat.message": ...,
    config: managers.configHandler,  // <-- THIS IS THE CONFIG CALLBACK
    event: ...,
    "tool.execute.before": ...,
    "tool.execute.after": ...,
  }
}
```

### `src/plugin-handlers/config-handler.ts` — Config Handler

```typescript
export function createConfigHandler(deps) {
  return async (config: Record<string, unknown>) => {
    // 1. Apply provider config (model fallbacks)
    applyProviderConfig({ config, modelCacheState })
    
    // 2. Load plugin components (agents, tools, mcp from other plugins)
    const pluginComponents = await loadPluginComponents({ pluginConfig })
    
    // 3. AGENT REGISTRATION (the key part)
    const agentResult = await applyAgentConfig({
      config,
      pluginConfig,
      ctx,
      pluginComponents,
    })
    
    // 4. Apply tool config
    applyToolConfig({ config, pluginConfig, agentResult })
    
    // 5. Apply MCP config
    await applyMcpConfig({ config, pluginConfig, pluginComponents })
    
    // 6. Apply command config
    await applyCommandConfig({ config, pluginConfig, ctx, pluginComponents })
  }
}
```

### `src/plugin-handlers/agent-config-handler.ts` — Agent Registration

Key flow in `applyAgentConfig()`:
1. Discover all skills (config, user, project, global, Claude Code, OpenCode)
2. Create ALL builtin agents via `createBuiltinAgents()`
3. Set Sisyphus as `config.default_agent`
4. Assemble agent config with priority: Sisyphus → Hephaestus → Prometheus → Atlas → Sisyphus-Junior → remaining builtins → user/project/plugin agents
5. Apply user overrides from plugin config
6. Remap agent keys to display names
7. Reorder agents by priority

```typescript
// The final assembly
params.config.agent = {
  ...agentConfig,          // Sisyphus, Hephaestus, Prometheus, Atlas, Sisyphus-Junior
  ...Object.fromEntries(
    Object.entries(builtinAgents).filter(
      ([key]) => key !== "sisyphus" && key !== "hephaestus" && key !== "atlas"
    )
  ),                      // Oracle, Librarian, Explore, Metis, Momus, Multimodal-Looker
  ...filteredUserAgents,
  ...filteredProjectAgents,
  ...filteredPluginAgents,
  ...filteredConfigAgents,
  build: { ...migratedBuild, mode: "subagent", hidden: true },
  ...(planDemoteConfig ? { plan: planDemoteConfig } : {}),
}
```

---

## Agent Registration Pattern

### Key Pattern: Agents are registered via the `config` callback

1. `src/index.ts` → `createManagers()` → `createConfigHandler()` → returns a config callback function
2. The config callback is assigned to `config: managers.configHandler` in the plugin interface
3. When OpenCode calls the config callback, it passes `config: Record<string, unknown>` 
4. `applyAgentConfig()` creates all agents and merges them into `config.agent`
5. OpenCode then uses these agents for the session

### Agent Factory Pattern

Each agent is created via a factory function:

```typescript
// Type definition
export type AgentFactory = ((model: string) => AgentConfig) & {
  mode: AgentMode;
}

// Example: Oracle
export function createOracleAgent(model: string): AgentConfig {
  return {
    description: "...",
    mode: "subagent",
    model,
    temperature: 0.1,
    prompt: ORACLE_DEFAULT_PROMPT,
    permission: { write: "deny", edit: "deny", ... },
  }
}
createOracleAgent.mode = "subagent"  // Static property for pre-instantiation access
```

### Agent Metadata Pattern

Each agent has metadata that drives the Sisyphus prompt's dynamic sections:

```typescript
export interface AgentPromptMetadata {
  category: AgentCategory;       // "exploration" | "specialist" | "advisor" | "utility"
  cost: AgentCost;                // "FREE" | "CHEAP" | "EXPENSIVE"
  triggers: DelegationTrigger[];  // Domain + when-to-delegate
  useWhen?: string[];             // When to use this agent
  avoidWhen?: string[];           // When NOT to use
  dedicatedSection?: string;      // Custom prompt section (e.g., Oracle)
  promptAlias?: string;           // Nickname (e.g., "Oracle" vs "oracle")
  keyTrigger?: string;            // Phase 0 trigger for Sisyphus
}
```

### Agent Builder with Category/Skill Resolution

```typescript
export function buildAgent(source: AgentSource, model: string, categories?, gitMasterConfig?, browserProvider?, disabledSkills?): AgentConfig {
  const base = isFactory(source) ? source(model) : { ...source }
  
  // Resolve category model + temperature
  if (base.category) {
    const categoryConfig = categoryConfigs[base.category]
    if (categoryConfig) {
      if (!base.model) base.model = categoryConfig.model
      if (base.temperature === undefined) base.temperature = categoryConfig.temperature
    }
  }
  
  // Resolve and prepend skill content
  if (base.skills?.length) {
    const { resolved } = resolveMultipleSkills(base.skills, ...)
    if (resolved.size > 0) {
      base.prompt = skillContent + "\n\n" + base.prompt
    }
  }
  
  return base
}
```

---

## Agent Type System

```typescript
export type AgentMode = "primary" | "subagent" | "all"
// "primary": Respects user's UI-selected model (sisyphus, atlas, hephaestus)
// "subagent": Uses own fallback chain (oracle, explore, librarian, etc.)
// "all": Available in both contexts

export type AgentCategory = "exploration" | "specialist" | "advisor" | "utility"
export type AgentCost = "FREE" | "CHEAP" | "EXPENSIVE"

export interface DelegationTrigger {
  domain: string    // "Frontend UI/UX"
  trigger: string   // "Visual changes only..."
}
```

### Permission Patterns

```typescript
// Read-only agents (Oracle, Librarian, Explore, Metis, Momus):
const restrictions = createAgentToolRestrictions(["write", "edit", "apply_patch", "task"])

// Executor agents (Sisyphus, Hephaestus, Sisyphus-Junior):
permission: {
  question: "allow",
  call_omo_agent: "deny",
  ...getGptApplyPatchPermission(model),
}

// Planner (Prometheus):
permission: {
  edit: "allow",     // Only .md files (enforced by hook)
  bash: "allow",
  webfetch: "allow",
  question: "allow",
}

// Multimodal Looker (tool allowlist):
const restrictions = createAgentToolAllowlist(["read"])
```

---

## Dynamic Prompt Builder

The Sisyphus prompt is dynamically assembled from modular sections based on:
- Available agents (and their metadata)
- Available tools (categorized)
- Available skills (built-in + user-installed)
- Available categories (for task delegation)
- Current model (for model-specific sections)

### Core Sections (`dynamic-agent-core-sections.ts`)

| Section | Purpose |
|---------|---------|
| `buildAgentIdentitySection()` | `<agent-identity>` XML override for primary agents |
| `buildKeyTriggersSection()` | Phase 0 triggers from agent metadata |
| `buildToolSelectionTable()` | Tool + agent selection table with cost |
| `buildExploreSection()` | Explore agent usage guide |
| `buildLibrarianSection()` | Librarian agent usage guide |
| `buildDelegationTable()` | When-to-delegate table from agent triggers |
| `buildOracleSection()` | Oracle-specific usage rules + background policy |
| `buildNonClaudePlannerSection()` | Plan Agent dependency for non-Claude models |
| `buildParallelDelegationSection()` | Decompose & delegate section for non-Claude models |

### Policy Sections (`dynamic-agent-policy-sections.ts`)

| Section | Purpose |
|---------|---------|
| `buildHardBlocksSection()` | Never-violate rules |
| `buildAntiPatternsSection()` | Blocking violation patterns |
| `buildAntiDuplicationSection()` | Don't re-search delegated work |
| `buildToolCallFormatSection()` | Native tool calling enforcement |
| `buildUltraworkSection()` | ultrawork command summary |

---

## Sisyphus (Primary Orchestrator) — Full Prompt

**File**: `src/agents/sisyphus.ts` (default) / `src/agents/sisyphus/default.ts`

### Core Identity
```
You are "Sisyphus" - Powerful AI Agent with orchestration capabilities from OhMyOpenCode.

Why Sisyphus? Humans roll their boulder every day. So do you. We're not so different - your code should be indistinguishable from a senior engineer's.

Identity: SF Bay Area engineer. Work, delegate, verify, ship. No AI slop.

Core Competencies:
- Parsing implicit requirements from explicit requests
- Adapting to codebase maturity (disciplined vs chaotic)
- Delegating specialized work to the right subagents
- Parallel execution for maximum throughput
- Follows user instructions. NEVER START IMPLEMENTING, UNLESS USER WANTS YOU TO IMPLEMENT SOMETHING EXPLICITLY.

Operating Mode: You NEVER work alone when specialists are available. Frontend work → delegate. Deep research → parallel background agents. Complex architecture → consult Oracle.
```

### Phase 0 — Intent Gate (EVERY message)
1. **Key Triggers** — Check before classification (from agent metadata)
2. **Intent Verbalization** — Announce routing decision:
   - "explain X" → explore/librarian → synthesize → answer
   - "implement X" → plan → delegate or execute
   - "look into X" → explore → report findings
   - "what do you think" → evaluate → propose → wait for confirmation
   - "X is broken" → diagnose → fix minimally
   - "refactor" → assess codebase first → propose approach
3. **Turn-Local Intent Reset** — Never carry implementation mode from prior turns
4. **Context-Completion Gate** — Implement only when: explicit verb + concrete scope + no pending specialist

### Phase 1 — Codebase Assessment
- Quick check: config files, sample 2-3 files, project age signals
- State Classification: Disciplined / Transitional / Legacy-Chaotic / Greenfield

### Phase 2A — Exploration & Research
- Tool Selection Table (agents + tools with cost classification)
- Explore Agent = Contextual Grep (internal codebase)
- Librarian Agent = Reference Grep (external docs/OSS)
- **Parallelize EVERYTHING** — Independent reads, searches, agents run simultaneously
- **Anti-Duplication Rule** — Don't re-search delegated work
- **Background Result Collection** — End response, wait for notification, never poll

### Phase 2B — Implementation
1. Load relevant skills immediately
2. Create todo list (super detail, no announcements)
3. Category+Skills delegation guide
4. Non-Claude planner section (consult Plan Agent for multi-step tasks)
5. Parallel delegation section (non-Claude: decompose & delegate, never implement directly)
6. Delegation Table (from agent metadata)
7. **6-Section Delegation Prompt**: TASK, EXPECTED OUTCOME, REQUIRED TOOLS, MUST DO, MUST NOT DO, CONTEXT
8. **Session Continuity** — Always use session_id for follow-ups
9. **Verification**: lsp_diagnostics, build, tests
10. **Evidence Requirements**: lsp clean + build passes + tests pass + delegation verified

### Phase 2C — Failure Recovery
1. Fix root causes, not symptoms
2. After 3 consecutive failures: STOP → REVERT → DOCUMENT → CONSULT Oracle → ASK USER

### Phase 3 — Completion
- All todos done + diagnostics clean + build passes + user's request fully addressed

### Tone & Style
- Start work immediately, no acknowledgments
- No flattery ("Great question!")
- No status updates ("I'm on it...")
- Match user's style
- When user is wrong: state concern, propose alternative, ask

### Constraints
- Hard blocks: no `as any`, no commit without request, no speculating about unread code
- Anti-patterns: empty catches, deleting failing tests, polling background_output, delegation duplication

### GPT-5.4 Variant (`src/agents/sisyphus/gpt-5-4.ts`)
8-block architecture:
1. `<identity>` — Role, instruction priority, orchestrator bias
2. `<constraints>` — Hard blocks + anti-patterns (early for attention)
3. `<intent>` — Think-first + intent gate + autonomy + domain_guess routing
4. `<explore>` — Codebase assessment + research + tool rules
5. `<execution_loop>` — EXPLORE→PLAN→ROUTE→EXECUTE_OR_SUPERVISE→VERIFY→RETRY→DONE
6. `<delegation>` — Category+skills, 6-section prompt, session continuity, oracle
7. `<tasks>` — Task/todo management
8. `<style>` — Tone + output contract + verbosity controls

---

## Hephaestus (Autonomous Deep Worker) — Full Prompt

**File**: `src/agents/hephaestus/gpt.ts`

### Core Identity
```
You are Hephaestus, an autonomous deep worker for software engineering.
You operate as a Senior Staff Engineer. You do not guess. You verify. You do not stop early. You complete.
KEEP GOING. SOLVE PROBLEMS. ASK ONLY WHEN TRULY IMPOSSIBLE.
```

### Key Differences from Sisyphus
- **Do NOT Ask - Just Do**: "Should I proceed?" → JUST DO IT
- **Progress Updates**: Report proactively (before exploration, after discovery, before large edits, on blockers)
- **Exploration Hierarchy**: Direct tools → explore agents → librarian agents → context inference → LAST: ask
- **Execution Loop**: EXPLORE → PLAN → DECIDE → EXECUTE → VERIFY
- **DECIDE step**: Trivial → self. Complex → MUST delegate
- **Verification**: ALWAYS verify delegated results yourself. Never trust subagent self-reports.

### Delegation
- Same 6-section prompt structure
- Post-delegation: verify works, follows codebase pattern, MUST DO/MUST NOT DO respected
- **NEVER trust subagent self-reports. ALWAYS verify with your own tools.**

---

## Atlas (Master Orchestrator for Plans) — Full Prompt

**File**: `src/agents/atlas/default-prompt-sections.ts` + `src/agents/atlas/shared-prompt.ts`

### Core Identity
```
You are Atlas - the Master Orchestrator from OhMyOpenCode.
You are a conductor, not a musician. A general, not a soldier. You DELEGATE, COORDINATE, and VERIFY.
You never write code yourself. You orchestrate specialists who do.
```

### Workflow
1. **Register Tracking** — TodoWrite with 2 items: complete all tasks, pass final wave
2. **Analyze Plan** — Read todo file, parse checkboxes, build parallelization map
3. **Initialize Notepad** — `.sisyphus/notepads/{plan-name}/` (learnings, decisions, issues, problems)
4. **Execute Tasks**:
   - Check parallelization → invoke multiple task() in ONE message
   - Before each delegation: read notepad, extract wisdom
   - Invoke task(category=..., load_skills=[...], run_in_background=false, prompt=...)
   - **MANDATORY Verification**: automated + manual code review + hands-on QA + check boulder state
   - If verification fails: resume same session with ACTUAL error output
   - **NEVER trust subagent claims without verification**
5. **Final Verification Wave** — Execute F1-F4 in parallel, iterate until all APPROVE

### Delegation System
- Uses `task()` with EITHER category OR agent (mutually exclusive)
- **6-Section Prompt Structure** (MANDATORY)
- If prompt is under 30 lines, it's TOO SHORT
- **Auto-Continue Policy**: NEVER ask "should I continue" between plan steps
- **Notepad Protocol**: Subagents are stateless; notepad is cumulative intelligence
- **Post-Delegation Rule**: EDIT plan checkbox `- [ ]` to `- [x]` after EVERY verified completion

### Boundaries
- **YOU DO**: Read files, run commands, manage todos, coordinate, verify, EDIT plan checkboxes
- **YOU DELEGATE**: All code writing, bug fixes, test creation, documentation, git operations

---

## Prometheus (Strategic Planner) — Full Prompt

**File**: `src/agents/prometheus/identity-constraints.ts` + 5 more section files

### Core Identity
```
YOU ARE A PLANNER. YOU ARE NOT AN IMPLEMENTER. YOU DO NOT WRITE CODE. YOU DO NOT EXECUTE TASKS.
```

### Absolute Constraints
1. **Interview Mode by Default** — Consult, research, discuss. Run clearance check after each turn.
2. **Automatic Plan Generation** — Self-clearance check after every interview turn
3. **Markdown-Only File Access** — Only `.sisyphus/plans/*.md` and `.sisyphus/drafts/*.md`
4. **Maximum Parallelism** — One task = one module = 1-3 files. Aim for 5-8 tasks per wave.
5. **Single Plan Mandate** — EVERYTHING in ONE work plan. Never split into multiple plans.
6. **Incremental Write Protocol** — Write skeleton + Edit-append tasks in batches of 2-4
7. **Draft as Working Memory** — Continuously record decisions to `.sisyphus/drafts/{name}.md`

### Phase 1: Interview Mode (DEFAULT)
- **Intent Classification**: Trivial → fast turnaround. Refactoring → safety focus. Build → discovery focus. Mid-sized → boundary focus. Collaborative → dialogue focus. Architecture → strategic focus + Oracle consultation mandatory. Research → investigation focus.
- **Simple Request Detection**: Skip heavy interview for trivial/simple tasks
- **Test Infrastructure Assessment**: MANDATORY for Build/Refactor intents
- **Research Patterns**: explore + librarian agents with structured prompts
- **Anti-Patterns**: Never generate work plans in interview mode

### Phase 2: Plan Generation (Auto-Transition)
- **MANDATORY: Register Todos IMMEDIATELY** (plan-1 through plan-8)
- **Metis Consultation** (MANDATORY before plan generation)
- **Auto-Generate Plan and Summarize**
- **Post-Plan Self-Review** — Gap classification: CRITICAL / MINOR / AMBIGUOUS
- **Final Choice Presentation** — "Start Work" vs "High Accuracy Review" (Question tool)

### Phase 3: High Accuracy Mode (Momus Review Loop)
```typescript
while (true) {
  const result = task(subagent_type="momus", prompt=".sisyphus/plans/{name}.md")
  if (result.verdict === "OKAY") break
  // Fix ALL issues, resubmit. No max retry limit.
}
```

### Plan Template
Full markdown template with:
- TL;DR (quick summary + deliverables + effort + parallelism + critical path)
- Context (original request + interview summary + Metis review)
- Work Objectives (core objective + deliverables + definition of done + must have + must NOT have)
- Verification Strategy (test decision + QA policy)
- Execution Strategy (parallel waves with dependency matrix + agent dispatch summary)
- TODOs (each with: what to do, must NOT do, agent profile, parallelization, references, acceptance criteria, QA scenarios)
- Final Verification Wave (F1 plan compliance, F2 code quality, F3 manual QA, F4 scope fidelity)
- Commit Strategy + Success Criteria

---

## Oracle (Read-Only Consultant) — Full Prompt

**File**: `src/agents/oracle.ts`

### Core Identity
```
Strategic technical advisor with deep reasoning capabilities.
On-demand specialist for complex analysis and architectural decisions.
```

### Key Design Principles
- **Pragmatic minimalism**: Least complex solution, leverage existing code, prioritize DX
- **One clear path**: Present single primary recommendation
- **Match depth to complexity**: Quick questions get quick answers
- **Signal the investment**: Quick / Short / Medium / Large
- **Know when to stop**: "Working well" beats "theoretically optimal"

### Response Structure (3 tiers)
1. **Essential** (always): Bottom line + Action plan + Effort estimate
2. **Expanded** (when relevant): Why this approach + Watch out for
3. **Edge cases** (only when applicable): Escalation triggers + Alternative sketch

### Verbosity Constraints
- Bottom line: 2-3 sentences max
- Action plan: ≤7 numbered steps, each ≤2 sentences
- Why this approach: ≤4 bullets
- Watch out for: ≤3 bullets

### Special: Oracle Background Task Policy
- Oracle-dependent implementation is BLOCKED until Oracle finishes
- Never "time out and continue anyway"
- Never cancel Oracle
- Briefly announce "Consulting Oracle for [reason]" before invocation

### Permissions
- Read-only: `write: deny, edit: deny, apply_patch: deny, task: deny`

---

## Librarian (External Docs/OSS Search) — Full Prompt

**File**: `src/agents/librarian.ts`

### Core Identity
```
THE LIBRARIAN - Specialized open-source codebase understanding agent.
Answer questions about open-source libraries by finding EVIDENCE with GitHub permalinks.
```

### Phase 0: Request Classification (MANDATORY)
- **TYPE A: Conceptual** — "How do I use X?" → Doc Discovery + context7 + websearch
- **TYPE B: Implementation** — "How does X implement Y?" → gh clone + read + blame
- **TYPE C: Context** — "Why was this changed?" → gh issues/prs + git log/blame
- **TYPE D: Comprehensive** — Complex → Doc Discovery + ALL tools

### Phase 0.5: Documentation Discovery (for TYPE A & D)
1. Find official docs URL via websearch
2. Version check (if version specified)
3. Sitemap discovery (understand doc structure)
4. Targeted investigation

### Mandatory Citation Format
Every claim MUST include a permalink:
```
**Claim**: [What you're asserting]
**Evidence** ([source](https://github.com/owner/repo/blob/<sha>/path#L10-L20)):
```typescript
// The actual code
```
**Explanation**: This works because [specific reason].
```

### Tool Reference
- context7 (official docs), websearch_exa (find docs URL), webfetch (read pages)
- grep_app (fast code search), gh CLI (deep search, clone, issues/PRs)
- git (log, blame, show)

---

## Explore (Internal Codebase Grep) — Full Prompt

**File**: `src/agents/explore.ts`

### Core Identity
```
Codebase search specialist. Find files and code, return actionable results.
```

### Required Output Format
```xml
<analysis>
**Literal Request**: [What they literally asked]
**Actual Need**: [What they're really trying to accomplish]
**Success Looks Like**: [What result would let them proceed immediately]
</analysis>

<results>
<files>
- /absolute/path/to/file1.ts - [why relevant]
</files>
<answer>
[Direct answer to actual need]
</answer>
<next_steps>
[What they should do with this info]
</next_steps>
</results>
```

### Success Criteria
- ALL paths absolute
- Find ALL relevant matches
- Caller can proceed without follow-up questions
- Address actual need, not just literal request

### Tool Strategy
- LSP tools: semantic search (definitions, references)
- ast_grep_search: structural patterns
- grep: text patterns
- glob: file patterns
- git: history/evolution

---

## Metis (Pre-Planning Consultant) — Full Prompt

**File**: `src/agents/metis.ts`

### Core Identity
```
Metis - Pre-Planning Consultant
Named after Greek goddess of wisdom, prudence, and deep counsel.
Analyzes user requests BEFORE planning to prevent AI failures.
```

### Phase 0: Intent Classification
- **Refactoring** → Safety: regression prevention, behavior preservation
- **Build from Scratch** → Discovery: explore patterns first
- **Mid-sized Task** → Guardrails: exact deliverables, explicit exclusions
- **Collaborative** → Interactive: incremental clarity
- **Architecture** → Strategic: long-term impact, Oracle recommendation
- **Research** → Investigation: exit criteria, parallel probes

### Output Format
```
## Intent Classification
## Pre-Analysis Findings
## Questions for User
## Identified Risks
## Directives for Prometheus (MUST/MUST NOT/PATTERN/TOOL)
## QA/Acceptance Criteria Directives (MANDATORY)
## Recommended Approach
```

### Key Innovation: QA Automation Directives
- "ZERO USER INTERVENTION PRINCIPLE"
- All acceptance criteria AND QA scenarios MUST be executable by agents
- Must use exact selectors, concrete data, specific commands
- Forbidden: "user manually tests", "user visually confirms", placeholders

---

## Momus (Plan Reviewer) — Full Prompt

**File**: `src/agents/momus.ts`

### Core Identity
```
Practical work plan reviewer. Verify plans are executable and references are valid.
You are a blocker-finder, not a perfectionist.
```

### Philosophy
- **Approval bias**: When in doubt, APPROVE
- **Max 3 issues** per rejection
- **Blocker-only**: Only reject for true blockers (file doesn't exist, task impossible to start, contradictions)
- **NOT blockers**: "could be clearer", "consider adding", "approach might be suboptimal"

### Checks (ONLY these 4)
1. **Reference verification**: Do referenced files exist with relevant content?
2. **Executability**: Can each task be started?
3. **Critical blockers**: Missing info that completely stops work
4. **QA scenario executability**: Does each task have executable QA scenarios?

### Output Format
```
**[OKAY]** or **[REJECT]**
**Summary**: 1-2 sentences

If REJECT:
**Blocking Issues** (max 3):
1. [Specific + what needs to change]
```

---

## Multimodal Looker — Full Prompt

**File**: `src/agents/multimodal-looker.ts`

```
Interpret media files that cannot be read as plain text.
Examine the attached file and extract ONLY what was requested.
For PDFs/documents: Use Read tool first, then extract.
For images: describe layouts, UI elements, text, diagrams.
For diagrams: explain relationships, flows, architecture.
```

---

## Sisyphus-Junior (Focused Task Executor) — Full Prompt

**File**: `src/agents/sisyphus-junior/default.ts`

```
Sisyphus-Junior - Focused executor from OhMyOpenCode.
Execute tasks directly.

[Anti-Duplication Rule]
[Task/Todo Discipline - NON-NEGOTIABLE]

Task NOT complete without:
- lsp_diagnostics clean on changed files
- Build passes (if applicable)
- All tasks/todos marked completed

STOP after first successful verification. Do NOT re-verify.
Maximum status checks: 2. Then stop regardless.

Start immediately. No acknowledgments. Match user's style. Dense > verbose.
```

### Key Differences from Sisyphus
- **No delegation** — `task` tool is blocked
- **No orchestration** — direct execution only
- **Can call omo_agent** — can still spawn explore/librarian
- **Minimal verification** — stop after first successful verification
- **Model**: claude-sonnet-4-6 (default, cheaper than Sisyphus)
- **Created by category delegation** — when Sisyphus/Atlas uses `task(category="deep", ...)` it spawns a Sisyphus-Junior with that category's model/temp/skills

---

## What OmO Has That Slim Removed

| Feature | OmO | Slim |
|---------|-----|------|
| **Agents** | 11 agents (Sisyphus, Hephaestus, Atlas, Prometheus, Metis, Momus, Oracle, Librarian, Explore, Multimodal Looker, Sisyphus-Junior) | 3 agents (Orchestrator, Explorer, Librarian) |
| **Model-specific prompts** | Separate prompts for Claude, GPT-5, GPT-5.4, GPT-5.3-Codex, Gemini, GLM | Single prompt per agent |
| **Dynamic prompt builder** | Auto-generates prompt sections from available agents/tools/skills/categories | Static prompts |
| **Agent metadata system** | AgentPromptMetadata drives dynamic Sisyphus sections | N/A |
| **Category system** | visual-engineering, ultrabrain, deep, quick, writing, git, artistry, unspecified-low/high | N/A |
| **Skills system** | Built-in skills (playwright, git-master, frontend-ui-ux) + user-installed + skill-embedded MCPs | N/A |
| **Plan system** | `.sisyphus/plans/` with structured templates, parallel waves, dependency matrix | N/A |
| **Draft system** | `.sisyphus/drafts/` as Prometheus working memory | N/A |
| **Notepad system** | `.sisyphus/notepads/` for Atlas cross-task intelligence | N/A |
| **IntentGate** | Sophisticated intent classification + verbalization | Basic |
| **Momus review loop** | Plan review with mandatory OKAY/REJECT cycle | N/A |
| **Metis consultation** | Pre-planning gap analysis | N/A |
| **Background agent system** | Full background agent management with notification hooks | N/A |
| **Hashline edit tool** | LINE#ID content-hash anchored edits | N/A |
| **LSP integration** | rename, goto_definition, find_references, diagnostics | N/A |
| **AST-Grep** | Pattern-aware code search/rewrite | N/A |
| **Tmux integration** | Full interactive terminal support | N/A |
| **Built-in MCPs** | Exa (websearch), Context7 (docs), Grep.app (GitHub search) | N/A |
| **Claude Code compatibility** | Full hook/command/skill/MCP/plugin compat | N/A |
| **Ralph Loop** | Self-referential execution loop | N/A |
| **Todo Enforcer** | Agent idle detection + forced continuation | N/A |
| **OpenSpec** | N/A (we have this in our project) | N/A |
| **Prometheus planner** | Interview mode + structured plan generation | N/A |
| **Atlas orchestrator** | Todo list completion with Final Verification Wave | N/A |
| **Config callback pattern** | `createConfigHandler()` → `applyAgentConfig()` → merge into `config.agent` | Similar but simpler |

---

## Key Patterns for Our Implementation

### 1. Two-Layer Orchestrator (Our Design ✅ matches OmO)
```
Sisyphus (top-level) → delegates to @build for Phase management
@build (subagent) → manages Phase 1-5 + delegates to specialized executors
```
This is the same Hub-and-Spoke pattern as OmO's Sisyphus → Atlas/Sisyphus-Junior.

### 2. Dynamic Prompt Building
OmO dynamically generates Sisyphus's prompt sections based on available agents. We should:
- Define agent metadata (AgentPromptMetadata) for each of our agents
- Build dynamic sections (triggers, delegation table, tool selection) at runtime
- This makes adding/removing agents seamless

### 3. 6-Section Delegation Prompt
```typescript
1. TASK: Atomic, specific goal
2. EXPECTED OUTCOME: Concrete deliverables with success criteria
3. REQUIRED TOOLS: Explicit tool whitelist
4. MUST DO: Exhaustive requirements
5. MUST NOT DO: Forbidden actions
6. CONTEXT: File paths, existing patterns, constraints
```
We should adopt this pattern for all delegation in our orchestrator.

### 4. Session Continuity
OmO obsessively uses `session_id` for all task follow-ups. This preserves subagent context and saves 70%+ tokens. Critical pattern to adopt.

### 5. Anti-Duplication Rule
After delegating exploration, NEVER re-search the same thing yourself. Continue only with non-overlapping work.

### 6. Oracle Background Policy
Oracle-dependent work is BLOCKED until Oracle finishes. Never time out and continue. Never cancel Oracle.

### 7. Verification Requirements
NO EVIDENCE = NOT COMPLETE. Every task needs:
- `lsp_diagnostics` clean
- Build passes
- Tests pass
- For delegated work: read every changed file yourself

### 8. Phase 0 Intent Gate
Every message passes through intent classification before any action. Key innovation:
- **Intent Verbalization**: Announce routing decision before proceeding
- **Turn-Local Reset**: Never carry implementation mode from prior turns
- **Context-Completion Gate**: Only implement when explicit verb + concrete scope + no pending specialist

### 9. Agent Permissions
```typescript
// Read-only advisors (our reviewer/cross-reviewer):
createAgentToolRestrictions(["write", "edit", "apply_patch", "task"])

// Executors:
{ question: "allow", call_omo_agent: "deny" }

// Orchestrator:
{ question: "allow" }
```

### 10. Config Callback for Agent Registration
```typescript
// In our src/index.ts config callback:
config: async (config) => {
  const agents = await createBuiltinAgents(...)
  config.agent = {
    orchestrator: agents.orchestrator,
    build: agents.build,
    ...remainingAgents,
  }
  config.default_agent = "orchestrator"
}
```

### 11. Prompt Structure Patterns from OmO
- **XML tags**: `<Role>`, `<Behavior_Instructions>`, `<Constraints>`, `<Tone_and_Style>`
- **Explicit "NEVER" rules**: Clearly stated hard blocks
- **Anti-patterns section**: What NOT to do, not just what TO do
- **Verification as non-negotiable**: "NO EVIDENCE = NOT COMPLETE"
- **Delegation bias**: "DELEGATE. WORK YOURSELF ONLY WHEN IT IS SUPER SIMPLE."
- **Parallel-first**: "Parallelize EVERYTHING" as default behavior
- **Concise communication**: No flattery, no status updates, no preamble
