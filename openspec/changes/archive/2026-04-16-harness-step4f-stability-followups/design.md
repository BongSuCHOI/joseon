## Context

The harness already has the right building blocks: `improver.ts` owns compaction and fix-commit detection, `src/index.ts` owns agent registration and permission synthesis, and `src/hooks/` is the current extension point for prompt/session transforms. The remaining gaps are mostly control-plane issues: compaction needs a hard ceiling, skill exposure needs a dedicated prompt filter, and fallback chains need a runtime consumer rather than dead metadata.

The current codebase also shows an important constraint: OpenCode exposes `experimental.chat.system.transform` and `chat.params`, but it does not provide a direct in-flight model swap API. That means foreground fallback must be implemented as stateful selection for the next foreground request, not as a magical live mutation of an active LLM stream.

## Goals / Non-Goals

**Goals:**
- Keep compaction bounded and prioritize high-value context.
- Preserve the existing fix-commit semantics and make them durable.
- Filter the surfaced skill catalog by agent configuration.
- Consume fallback chains at runtime and advance away from failing primary models.
- Keep the change testable and easy to roll back.

**Non-Goals:**
- No new external dependency.
- No redesign of the core OpenCode prompt engine.
- No new user-facing config surface unless it is required to keep the implementation simple.
- No attempt to mutate an in-flight provider stream.

## Decisions

### 1) Compacting uses priority plus a hard ceiling
We will keep compaction in `src/harness/improver.ts`, but make the injected payload bounded.

Priority order:
1. scaffold
2. hard rules
3. top-N soft rules
4. memory facts

Soft rules and memory facts will be capped using the existing `search_max_results` setting, and the final output will still be subject to a small absolute character ceiling so compaction cannot drift upward over time.

**Alternatives considered:**
- Only cap memory facts: too weak; hard/soft rule volume can still balloon.
- Add a new config setting: cleaner long-term, but not worth the extra surface for a hotfix.

### 2) Fix-commit detection stays message-based
The current `detectFixCommits()` behavior already matches the intended semantics: scan `git log --since`, accept `fix*` commits, and treat the commit message as the signal pattern while keeping `source_file` empty. We will keep that parser semantics and lock it down with regression coverage and docs rather than reintroducing file-path-based matching.

**Alternatives considered:**
- Revert to file-path patterns: rejected because it recreates the original logic bug.
- Add diff mining now: too much scope for this pass.

### 3) Skill filtering happens in the prompt layer, driven by agent config
OpenCode already filters skills through permission rules, but the skill catalog is still built centrally. The new hook will use the agent name captured from `chat.params` and the harness config to post-process the generated system prompt, keeping only the skills permitted by that agent.

Implementation shape:
- `src/hooks/index.ts` accepts harness config and registers the new hook.
- The hook stores per-session agent metadata from `chat.params`.
- `experimental.chat.system.transform` rewrites the skill catalog block for that session.

**Alternatives considered:**
- Rely on existing permission generation only: works functionally, but does not give us the explicit prompt-layer filter requested here.
- Parse and mutate tool registry internals: too brittle.

### 4) Foreground fallback is stateful, not magical
Because OpenCode does not expose a direct model-swap hook for a running stream, foreground fallback will be implemented as a small state machine:

```
chat.params capture
      ↓
session.error / retryable failure
      ↓
advance fallback cursor in project state
      ↓
config callback / next session registration
      ↓
apply next model from resolved chain
```

The runtime state can live in a small project-local JSON file keyed by agent name. The hook records the active session’s agent/model/chain and advances the cursor only on retryable failures. The config callback then consumes that cursor when the next foreground session is registered.

**Alternatives considered:**
- Try to mutate the active stream: not supported by the available API.
- Encode fallback in the provider itself: would couple us to provider-specific behavior.

### 5) Docs refresh is part of the change, but applied last
The implementation will update only the markdown files that are stale after the code lands: `README.md`, `AGENTS.md`, `docs/development-guide.md`, and any other project markdown that still describes the pre-change shape of the harness. This keeps the archive clean while still doing the final sweep the user requested.

## Risks / Trade-offs

- [Risk] The compaction ceiling may trim useful context too aggressively → [Mitigation] keep hard rules and scaffold first, and use soft-rule ordering before trimming memory facts.
- [Risk] Skill filtering may duplicate behavior already provided by permissions → [Mitigation] keep the hook defensive and small; treat permission synthesis as the source of truth.
- [Risk] Foreground fallback only takes effect on the next registration turn → [Mitigation] document the limitation clearly and keep the state file easy to inspect/reset.
- [Risk] Markdown sweep can drift into unrelated docs edits → [Mitigation] only touch stale content that is directly impacted by this change.

## Migration Plan

1. Implement the spec-backed code paths.
2. Update smoke tests for the new hook/filter behavior and the compaction ceiling.
3. Run the project smoke suite.
4. If runtime fallback needs verification beyond smoke, validate in tmux with a forced rate-limit/unavailable scenario.
5. Archive the change.
6. Sweep project markdown files and update stale content.

## Open Questions

- Should foreground fallback advance only on explicit retryable provider failures, or also on repeated local session errors?
- Do we want the compaction ceiling to remain a fixed internal constant, or should it become a documented config setting later if sessions get larger?
