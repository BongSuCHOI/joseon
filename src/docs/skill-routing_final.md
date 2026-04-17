# Superpowers Skill Routing

Reference table for which agents use which superpowers skills and how. This
is a developer-facing document — skills themselves are invoked by reading
their `SKILL.md` and applying the procedure, not by `@mention`.

## Skills Adopted

| Skill | Type | Primary Consumer |
|-------|------|------------------|
| `brainstorming` | Flexible | @orchestrator, @advisor |
| `writing-plans` | Flexible | @orchestrator |
| `subagent-driven-development` | Flexible | @orchestrator (absorbed as delegation pattern) |
| `dispatching-parallel-agents` | Flexible | @orchestrator (parallel mode helper) |
| `test-driven-development` | Rigid | @tester, @orchestrator (as invoker) |
| `systematic-debugging` | Flexible | @advisor, @orchestrator |
| `requesting-code-review` | Rigid | @orchestrator (invoker), @reviewer (input contract) |
| `receiving-code-review` | Flexible | @frontend, @backend, @coder |
| `verification-before-completion` | Rigid | all implementation agents |
| `finishing-a-development-branch` | Rigid | @orchestrator (final handoff / closeout checklist) |

## Skills NOT Adopted

- `using-git-worktrees` — not needed (one repo + local dir per project)
- `using-superpowers` — philosophy absorbed into each agent's Operating_Mode section; no separate bootstrap file
- `executing-plans` — only for harnesses without subagent support; OpenCode has subagents
- `writing-skills` — meta-skill for skill authors, not for execution

## Per-Agent Usage

### @orchestrator

Primary skill consumer. Invokes workflows end-to-end or partially.

- Invokes: `brainstorming`, `writing-plans`, `subagent-driven-development`, `dispatching-parallel-agents`, `requesting-code-review`, `finishing-a-development-branch`, `systematic-debugging`, `verification-before-completion`
- Absorbs into delegation pattern: `subagent-driven-development` (context isolation, status protocol, two-stage review, never-retry-same-model)
- Uses `dispatching-parallel-agents` only when subtasks are truly independent
- Treats `finishing-a-development-branch` as a final handoff / closeout checklist, not as git automation
- Passes skill contracts into delegation prompts rather than re-explaining

### @reviewer

Read-only. Does not invoke skills itself.

- Absorbs `requesting-code-review` as **input contract**: expects `WHAT_WAS_IMPLEMENTED` + `PLAN_OR_REQUIREMENTS` + `DIFF_SCOPE` + `DESCRIPTION` from caller
- Absorbs plan-alignment-first checklist from superpowers code-reviewer
- Output severity follows superpowers format: Critical / Important / Minor + Assessment (Ready to merge / With fixes / Not ready)

### @tester

- Follows `test-driven-development` RED → GREEN → REFACTOR reporting format
- Invoked by orchestrator when TDD cycle is active
- When not in TDD mode, still reports regression impact separately from new tests

### @frontend / @backend / @coder

- Aware of `subagent-driven-development` principles: stay in scope, report plan conflicts, verify before declaring done
- Follow `verification-before-completion` checklist before reporting completion
- Use `receiving-code-review` format when addressing review feedback from @reviewer
- Report with Implementer Status Protocol: `DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` / `NEEDS_CONTEXT`

### @advisor

- Invokes `systematic-debugging` for deep debugging requests (4-phase root cause process)
- References `brainstorming` framing for tradeoff analysis and design discussion

### @explorer / @librarian / @designer

- Read-only, workflow-aware. No direct skill invocation.
- Output shape is compatible with `writing-plans` consumption (explorer returns task-ready context packets; librarian separates official vs community sources; designer authors DESIGN.md sections ready for implementation delegation)

## Invocation Rules

1. **Skills are not agents.** Read them, apply their procedure. Do not `@mention` a skill.
2. **Partial workflows are normal.** Don't force `brainstorming` on every task.
3. **Rigid skills are contracts.** If you use TDD, follow RED/GREEN/REFACTOR. Half-measures defeat the point.
4. **Project skills override.** Files in `.opencode/skills/` take precedence over bundled superpowers skills with the same name.
5. **User instructions override skills.** A user instruction like "skip tests" beats any skill that says "always TDD".
6. **Subagents skip auto-activation.** When an agent is dispatched as a subagent with a specific task, it does NOT kick off skill workflows on its own — the controller owns skill activation.
7. **Parallelism is optional.** `dispatching-parallel-agents` is a helper, not a requirement; orchestrator may still use native parallel delegation directly.
8. **Closeout is lightweight.** `finishing-a-development-branch` means final verification and handoff state, not mandatory branch/PR/worktree automation.

## Skill Contracts Quick-Reference

### `requesting-code-review` contract (orchestrator → @reviewer)

Input (orchestrator provides):
- `WHAT_WAS_IMPLEMENTED`: one-line description of the change
- `PLAN_OR_REQUIREMENTS`: reference to the plan/spec/task
- `DIFF_SCOPE`: base ref + head ref, or changed file list / explicit review scope
- `DESCRIPTION`: additional context the reviewer needs

Output (@reviewer returns):
- Strengths (with file:line references)
- Issues: Critical / Important / Minor
- Recommendations
- Assessment: Ready to merge / With fixes / Not ready

### `subagent-driven-development` contract (orchestrator → implementation agents)

Input (orchestrator provides via 6-section prompt):
- Task description (extracted from plan, not dumped)
- Context (architecture, dependencies, patterns)
- Scope boundaries (what NOT to touch)
- Verification expectations

Output (implementation agent returns):
- Status: `DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` / `NEEDS_CONTEXT`
- What was implemented (or attempted)
- Tests run and results
- Files changed
- Self-review findings
- Concerns or issues

### `dispatching-parallel-agents` contract (orchestrator helper)

Use when:
- subtasks are independent
- ownership boundaries are clear
- file overlap is low or zero

After parallel work completes:
- reconcile shared-file overlap
- check for conflicting assumptions
- run review only on the merged result, not per-branch in isolation

### Two-Stage Review

For non-trivial implementation: orchestrator runs spec-compliance review
first, then code-quality review. Skip spec-compliance for mechanical tasks.
Merge both into a single @reviewer pass for moderate changes — just supply
both the plan reference AND the `DIFF_SCOPE`.
