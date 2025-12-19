# Postmortem + Rollback Plan (Demo Baseline: Dec 10, 2025)

## Executive summary

You had a stable demo build around **Wed Dec 10, 2025**. Since then, a large refactor (UnifiedEditor + atomic cell model + persistence/streaming rewires) landed and produced regressions across:

- AI streaming / regenerate
- prompt refresh (“live” / “refresh” flows)
- cross-stream persistence behavior
- Quick Panel integration correctness

The pragmatic plan is to **roll back to the demo-stable commit**, then re-apply only the genuinely salvageable fixes in small, well-tested slices.

This document identifies:

- **The most likely demo baseline commit**
- **What changed since that baseline**
- **What’s salvageable vs. what should be abandoned**
- **A safe rollback + forward plan**

---

## Baseline candidate (demo build)

### Most likely commit

- **`fc69f2b`** — `2025-12-10 11:18:04 -0500` — `origin/main` / `origin/feature/quick-panel`  
  Message: **“fix: Block references now use shortId consistently”**

Why this is a strong candidate:

- It is the **HEAD of `origin/main`** at the end of the Dec 9–10 work burst.
- There is a noticeable gap after this date before the next wave of changes (Dec 16+), matching your “we didn’t work right after class” memory.

### Nearby commits (if we need to validate)

Key commits immediately preceding `fc69f2b` on `main`:

- `a505260` — “fix: Audit fixes for Quick Panel streaming and UI stability”
- `2d5815c` — “fix: Multiple Quick Panel and live cell improvements”
- `6847a52` — “fix: Pass Quick Panel context to AI when asking questions”
- `7d38f50` — “fix: Insert Quick Panel cells before trailing empty cell”
- `fc04802` — “feat: Implement Quick Panel for global content capture”
- `fd74fa1` — “feat: Add hybrid search and unified side panel”

If `fc69f2b` isn’t exactly the demo build, it’s almost certainly one of the above (or a local unpushed state built on top of them).

---

## What changed after the baseline

### Local `main` only (small)

Local `main` moved from `fc69f2b` → `8e1441a`:

- `8e1441a` — `2025-12-16 18:33:00 -0500` — “feat: Implement audit enhancements (Tasks 1-7)”

This is **post-demo**, but still prior to the large UnifiedEditor/atomic-cell branch work.

### Feature branch work (large refactor)

On `feature/codemirror-editing` you introduced:

- “UnifiedEditor architecture” phases (TipTap schema/extensions, new editor API)
- “Slice 09 – Atomic cell model”
- “Slice 12–16” stream switching / persistence baseline / force-save / streamId filtering / Quick Panel insertion parity
- Various follow-up fixes and debug work around:
  - caret visibility
  - Cmd+Enter wiring
  - AI formatting and streaming stability

This work substantially changed **editor invariants**:

- doc schema shape (`cellBlock` node, `inline*`, atomic model)
- how markdown is parsed/serialized
- how store ↔ editor reconciliation works
- how AI streaming updates are applied to the doc

---

## Root causes (why things regressed)

### 1) Too many invariants changed at once

The atomic cell model implies:

- block structure (headings, list items, code blocks) is no longer represented as nested PM nodes
- markdown parsing must either:
  - flatten block structure into inline nodes, **losing semantics**, or
  - split markdown blocks into multiple cells, requiring grouping/regeneration semantics

This cascades into streaming, persistence, selection/cursor placement, and UI rendering.

### 2) Multiple sources of truth fought each other

The editor doc, Zustand store, and Swift DB state are each capable of “winning” depending on timing. When the app reconstructs the editor doc from stale inputs (e.g. stream props), it can delete cells that Swift is still streaming into.

Symptoms:

- `aiChunk` arrives for a cell id that no longer exists in TipTap
- “regenerate” targets an id that got replaced by splitting logic

### 3) Streaming requires a hard guarantee: “cell exists” + “cell is streaming”

Even small races (doc rebuild, reconciliation, stream switch) can cause:

- updates to be dropped (`Cell not found`)
- updates to be ignored (`Cell not streaming`)
- completion save to be skipped (baseline advanced too early)

---

## What’s salvageable (worth re-applying after rollback)

This is the most important section: we want to salvage fixes that are **architecture-agnostic** and don’t require the UnifiedEditor/atomic model.

### Likely salvageable (high confidence)

- **Swift payload correctness**
  - include `streamId` in streaming/refresh events (prevents cross-stream corruption)
  - request correlation/timeouts for file drops (if implemented)
- **Cross-stream save safety**
  - flush/cancel debounced saves on stream switch
  - guard against stale saves (streamId check)

These are “boring correctness” improvements and generally apply regardless of editor structure.

### Possibly salvageable (needs adaptation)

- quick panel insertion parity logic (depends on store/editor insertion semantics)
- force-save on completion (depends on where the canonical HTML/markdown is sourced)

### Not salvageable (by default)

- anything that assumes `cellBlock` is the top-level atomic unit with `inline*` content
- atomic-only keymap semantics (split/merge based on inline model)
- markdown flattening code / AI formatting hacks that exist solely due to atomic constraints

---

## Rollback plan (safe procedure)

### Goal

Get back to a stable, demo-like state **without losing current work**, then verify required features:

- AI streaming + regenerate
- prompt refresh / live refresh
- Quick Panel insert + drops
- cross-stream save integrity

### Non-destructive approach

1) **Create a new branch at the demo baseline**

- From your current repo state, create a branch from:
  - `fc69f2b` (preferred starting point)

2) **Do not reset main yet**

Keep `main` intact so nothing is lost; work in a new branch (`demo-restore`) and only fast-forward/merge once verified.

3) **Validate “must work” checklist**

Run your manual test scripts:

- AI: Cmd+Enter → stream chunks → completion persists → regenerate works
- Live: open stream triggers refresh
- Quick Panel: insert before trailing empty; file drops attach correctly
- Navigate quickly between streams; ensure no corruption

---

## Next steps

1) Confirm whether `fc69f2b` behaves exactly like the demo build for all “must work” features.
2) If not, test adjacent candidates in this window (same day, earlier):
   - `a505260`, `2d5815c`, `6847a52`, `7d38f50`, `fc04802`
3) Once baseline is confirmed, we’ll generate a **forward re-apply plan**:
   - pick 5–10 salvageable fixes
   - re-implement them as small PRs on the restored baseline
   - keep a tight manual test gate per slice


