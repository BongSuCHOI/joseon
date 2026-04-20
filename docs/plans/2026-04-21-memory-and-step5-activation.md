# Plan: Memory Architecture + Step 5 Activation

**Date:** 2026-04-21
**Seed Data:** `docs/hermes-memory-export.json` (93 facts, 16 memory entries, 13 profile items)

## Goal

Activate all dormant Step 5 features (5a~5h) and implement the missing memory stages (consolidate, relate) using hermes export data as seed. After verification, remove seed data and start fresh with real harness-orchestration data.

## Constraints

- All Step 5 code is already implemented and smoke-tested with synthetic data
- Hermes data is temporary — removed after verification
- `MemoryFact` interface is the contract: `{ id, project_key?, keywords[], content, source_session, created_at }`
- Config toggles live in `HarnessSettings` (src/config/schema.ts)
- Memory files go to `~/.config/opencode/harness/memory/facts/` (one JSON per fact)
- Session logs go to `~/.config/opencode/harness/logs/sessions/` (JSONL)
- Existing 571 assertions must not break

## Task Breakdown

### Phase 0: Infrastructure — Hermes → MemoryFact Converter

**Purpose:** Transform hermes-memory-export.json into harness-native formats (MemoryFact files + session JSONL) so all downstream features have real data to work with.

**Files:**
- NEW: `scripts/seed-hermes-data.ts` — one-time converter script
- Reads: `docs/hermes-memory-export.json`
- Writes: `~/.config/opencode/harness/memory/facts/*.json`, `~/.config/opencode/harness/logs/sessions/hermes-import-*.jsonl`

**Key decisions:**
- Map hermes `facts[]` → individual `MemoryFact` JSON files
- Map `hermes_memory[]` + `user_profile[]` → additional MemoryFact files
- Generate synthetic session JSONL from fact metadata (so `indexSessionFacts()` can re-extract)
- Assign `project_key` heuristically: wp-brandpublic facts → project-scoped, general → `global`
- Categorize hermes `category` field → `keywords[]` for search relevance

**Verification:**
- Script runs without error
- Count of generated MemoryFact files matches expected (93 facts + 16 memory + 13 profile ≈ 122 files)
- Session JSONL files are valid (each line parses as JSON)
- `searchFacts('타이핑 효과')` returns relevant facts
- `searchFacts('Cafe24 SSH')` returns relevant facts

---

### Phase 1: Harness Activation — Step 5a (ack_guard_enabled)

**Purpose:** Enable ack acceptance multi-check guard and verify with hermes data.

**Files:**
- MODIFY: `~/.config/opencode/harness/harness.jsonc` — set `ack_guard_enabled: true`
- READ: `src/harness/improver.ts` — `evaluateAckAcceptance()` (L864+)

**Key changes:**
- Create signals from hermes facts (e.g., "타이핑 효과 금지" pattern)
- Verify ack guard accepts valid signals (rule written + valid + non-superseded)
- Verify ack guard rejects invalid signals

**Verification:**
- Signal → ack → rule pipeline works with guard enabled
- Run `smoke-step5a-foundation.ts` — all assertions pass
- Run `smoke-step5h-ack-acceptance.ts` — all assertions pass

---

### Phase 2: Memory Activation — Step 5b (semantic_compacting_enabled)

**Purpose:** Enable semantic compacting and verify that hermes facts improve compaction quality.

**Files:**
- MODIFY: config — set `semantic_compacting_enabled: true`
- READ: `src/harness/improver.ts` — `rankSemanticFacts()`, `rankSemanticSoftRules()`, `planCompactionSelections()`

**Key changes:**
- With hermes data loaded, verify semantic ranking produces different (better) results than baseline
- Check that project-scoped facts (wp-brandpublic) rank higher than generic facts for wp-brandpublic queries
- Verify duplicate facts (타이핑 효과 ×5, Cafe24 SSH ×3) are handled — this exposes the need for consolidate

**Verification:**
- Run `smoke-step5b-memory-relevance.ts` — all assertions pass
- Manual check: `rankSemanticFacts()` orders wp-brandpublic facts higher for wp-brandpublic query
- Shadow records written to `memory-upper-shadow.jsonl`

---

### Phase 3: New Feature — consolidateFacts()

**Purpose:** Merge duplicate/near-duplicate facts. Hermes data has clear duplicates that prove the feature's value.

**Files:**
- MODIFY: `src/harness/improver.ts` — add `consolidateFacts()` function
- MODIFY: `src/types.ts` — add `ConsolidatedFact` type if needed
- NEW: `src/__tests__/smoke-consolidate.ts` — dedicated smoke test

**Algorithm:**
1. Group facts by content similarity (Jaccard on keywords + content substring overlap)
2. Within each group, pick the most comprehensive fact as canonical
3. Merge keywords from all group members into canonical
4. Write consolidated fact, archive originals to `memory/archive/`
5. Log consolidation shadow record

**Test cases from hermes data:**
- 타이핑 효과 실패: 5 near-identical facts → 1 canonical
- Cafe24 SSH info: 3 overlapping facts → 1 canonical
- 배포 경로 패턴: multiple similar → consolidated
- Unique facts (user preference, environment): unchanged

**Verification:**
- `consolidateFacts()` reduces 122 → ~60 unique facts
- No information loss (canonical contains all keywords)
- Archived originals are recoverable
- Existing 571 assertions still pass
- New smoke test passes

---

### Phase 4: Harness Activation — Step 5c (prune_guard + cross_project_promotion_guard)

**Purpose:** Enable rule lifecycle guards with hermes-derived rules.

**Files:**
- MODIFY: config — set `prune_guard_enabled: true`, `cross_project_promotion_guard_enabled: true`
- READ: `src/harness/improver.ts` — prune/cross-project logic

**Key changes:**
- Create SOFT rules from hermes patterns (타이핑 효과 금지, 배포 안전 규칙, etc.)
- Verify prune guard prevents premature removal of effective rules
- Verify cross-project guard blocks wp-brandpublic-specific rules from going global

**Verification:**
- Run `smoke-step5c-rule-lifecycle.ts` — all assertions pass
- Prune guard blocks removal of rules with recent violations
- Cross-project guard rejects single-project rules for global promotion

---

### Phase 5: Harness Activation — Step 5e (candidate_threshold)

**Purpose:** Adjust and verify mistake pattern candidate grouping.

**Files:**
- MODIFY: config — `candidate_threshold: 3` (already default, verify behavior)
- READ: `src/harness/improver.ts` — candidate logic

**Key changes:**
- Feed hermes mistake patterns (PR 테스트 수정, 타이핑 효과 실패)
- Verify candidates group correctly at threshold=3
- Test with threshold=2 and threshold=5 to confirm sensitivity

**Verification:**
- Run `smoke-step5e-candidates.ts` — all assertions pass
- Threshold=3 correctly groups recurring patterns
- Threshold=2 triggers earlier (more candidates)
- Threshold=5 doesn't trigger (fewer candidates)

---

### Phase 6: Harness Activation — Step 5f (canary_enabled)

**Purpose:** Enable phase/signal canary with real shadow records.

**Files:**
- MODIFY: config — set `canary_enabled: true`
- READ: `src/harness/canary.ts` — `evaluateCanary()`

**Key changes:**
- Phase 0~2 generated shadow records from hermes data
- Canary evaluates these records for mismatches
- Verify confidence scoring works on real data patterns

**Verification:**
- Run `smoke-step5f-canary.ts` — all assertions pass
- Shadow records exist from earlier phases
- Canary produces confidence scores and mismatch records
- Low-frequency patterns get `low_confidence` status

---

### Phase 7: Memory Activation — Step 5g (compacting_canary_enabled)

**Purpose:** Enable compacting relevance canary — the final toggle.

**Files:**
- MODIFY: config — set `compacting_canary_enabled: true`
- READ: `src/harness/canary.ts` — `evaluateCompactingCanary()`

**Key changes:**
- Compaction shadow records already written by Phase 2
- Canary detects rule_omission, fact_omission, rank_inversion
- Verify on hermes data that semantic compacting doesn't lose critical facts

**Verification:**
- Run `smoke-step5g-compacting-canary.ts` — all assertions pass
- Mismatch records written for any detected inversions
- Confidence scoring reflects real data quality

---

### Phase 8: New Feature — relateFacts()

**Purpose:** Map relationships between consolidated facts.

**Files:**
- MODIFY: `src/harness/improver.ts` — add `relateFacts()` function
- MODIFY: `src/types.ts` — add `FactRelation` type
- NEW: `src/__tests__/smoke-relate.ts` — dedicated smoke test

**Algorithm:**
1. After consolidation, scan fact pairs for shared keywords
2. Classify relationships: `same_topic`, `cause_effect`, `constraint_of`
3. Store as bidirectional edges in `memory/relations.jsonl`
4. Inject related facts into compaction context

**Test cases from hermes data:**
- "WP 배포 환경" ↔ "Cafe24 SSH 접속" ↔ "배포 플로우" → `same_topic`
- "타이핑 효과 실패" ↔ "fade-in 애니메이션 선호" → `cause_effect`
- "에이전트 코어 수정 금지" ↔ "Hermes 업데이트 자동 동의" → `constraint_of`

**Verification:**
- `relateFacts()` produces expected relationships
- Relations file is valid JSONL
- Compaction context includes related facts
- Existing assertions still pass

---

### Phase 9: Cleanup & Fresh Start

**Purpose:** Remove all hermes seed data, reset harness state, verify system works from blank slate.

**Files:**
- RUN: cleanup script (remove hermes-generated facts, sessions, shadows)
- DELETE: `scripts/seed-hermes-data.ts` (one-time use)
- VERIFY: `docs/hermes-memory-export.json` stays (reference only)

**Steps:**
1. Remove `~/.config/opencode/harness/memory/facts/hermes-*.json`
2. Remove `~/.config/opencode/harness/logs/sessions/hermes-import-*.jsonl`
3. Remove `~/.config/opencode/harness/shadow/*-shadow.jsonl` (hermes entries)
4. Keep config toggles enabled (5a~5g all `true`)
5. Keep consolidate/relate code
6. Verify all tests pass on clean state

**Verification:**
- `ls ~/.config/opencode/harness/memory/facts/` — empty or only real data
- All 571+ assertions pass (new tests added)
- System ready to accumulate real harness-orchestration data

---

## Execution Order

```
Phase 0 (converter)  ←  all others depend on this
    ↓
Phase 1 (5a ack)     ─┐
Phase 2 (5b semantic)─┤  ← can run in parallel
Phase 4 (5c guards)  ─┤
Phase 5 (5e candidate)┘
    ↓
Phase 3 (consolidate) ← needs 5b results to see duplicates
    ↓
Phase 6 (5f canary)  ─┐  ← needs shadow records from 0~3
Phase 7 (5g compact) ─┘
    ↓
Phase 8 (relate)      ← needs consolidated facts
    ↓
Phase 9 (cleanup)     ← final
```

## Summary

| Phase | Type | New Code? | Config Toggle |
|-------|------|-----------|---------------|
| 0 | Infrastructure | New script | — |
| 1 | Harness activation | No | `ack_guard_enabled` |
| 2 | Memory activation | No | `semantic_compacting_enabled` |
| 3 | New feature | Yes | — |
| 4 | Harness activation | No | `prune_guard_enabled` + `cross_project_promotion_guard_enabled` |
| 5 | Harness activation | No | `candidate_threshold` (verify) |
| 6 | Harness activation | No | `canary_enabled` |
| 7 | Memory activation | No | `compacting_canary_enabled` |
| 8 | New feature | Yes | — |
| 9 | Cleanup | Script removal | Keep all toggles on |

## Risks

1. **Hermes data may not map cleanly to MemoryFact** — some facts are raw conversation logs, not structured knowledge. Converter needs a cleaning step.
2. **consolidateFacts() similarity threshold** — too aggressive merges different facts, too conservative leaves duplicates. Start conservative.
3. **relateFacts() false positives** — shared keywords don't always mean real relationships. Use minimum shared-keyword count.
4. **Performance with 122 facts** — should be fine, but watch for N² comparisons in consolidate/relate.
