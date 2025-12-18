# Unified Stream Editor Refactor (Block+ Cells) — Implementation Tasks

This document is a **Claude-Code-friendly**, slice-by-slice playbook to refactor the stream editor to support **true text-editor selection across multiple cells** while preserving your demo-era functionality and avoiding the “spiral of despair”.

## Non-negotiable constraints

- **Do not break the app**: after every slice, the app must still function end-to-end (stream editing, persistence, AI streaming/regenerate, refresh/live, Quick Panel inserts, file drops).
- **No “big bang”**: ship in small slices behind a feature flag and keep rollback easy.
- **One editor instance per stream**: multi-cell selection *requires* a single ProseMirror document, not many independent editors.
- **Keep rich formatting inside a cell**: `cellBlock` must support **`block+`**, not `inline*` (avoid the atomic-inline trap).

## Core idea (what we are building)

### Goal UX

- The stream feels like one continuous editor.
- Users can **drag-select across multiple cells** (like a text editor).
- Arrow keys, backspace/delete, and copy/paste feel natural at boundaries.

### Goal architecture

- Replace the current “one TipTap editor per cell” (`CellEditor`) model with:
  - a single `StreamDoc` (TipTap editor) that contains a list of `cellBlock` nodes
  - each `cellBlock` contains **`block+` content** (paragraphs, headings, lists, code, images)
  - metadata (id/type/modelId/originalPrompt/processingConfig…) is stored as **node attrs**

This achieves selection across cells with native ProseMirror behavior.

---

## Ownership Rules (Store vs TipTap)

These rules define who owns what data and how it flows. APIs should be designed to allow modification of these rules if needed.

### Data ownership

| Data | Owner | Notes |
|------|-------|-------|
| Cell content (text, images, mentions) | TipTap | Source of truth during editing |
| Cell structure (order, which cells exist) | TipTap | Extracted to store for UI |
| Cell attrs (id, type, modelId, etc.) | TipTap node attrs | Round-tripped on save |
| Streaming content (in-progress) | Store | Applied to TipTap on completion |
| Refresh content (in-progress) | Store | Applied to TipTap on completion |
| Error state | Store | Transient, not persisted |
| Focus state | Store | For UI coordination |

### Data flow rules

**Rule 1: During editing, TipTap → Store → Persistence (one direction)**
```
User types → TipTap updates → extract cells → update store → debounced save to Swift
```
Store mirrors TipTap. Never reconcile TipTap FROM store during editing.

**Rule 2: External events write TO TipTap, then normal flow resumes**
```
AI complete → apply content TO TipTap → (Rule 1 kicks in)
Quick Panel → insert cellBlocks TO TipTap → (Rule 1 kicks in)
```

**Rule 3: Store owns transient state that doesn't touch content**
```
Streaming indicator: store.isStreaming(cellId) → CellBlockView reads this
Errors: store.getError(cellId) → CellBlockView reads this
```

**Rule 4: On stream switch, flush and reset**
```
1. Flush pending debounced saves
2. Clear store
3. Load new cells into TipTap
4. Extract to store (for SidePanel, etc.)
```

**Rule 5: Never bidirectional sync**
The previous attempt failed because store and TipTap were both trying to be authoritative. Pick one per scenario and stick to it.

---

## Baseline (what exists today, post-rollback)

You currently have:

- `Web/src/components/StreamEditor.tsx` rendering many `Cell` components
- each `Cell` uses its own TipTap editor via `Web/src/components/CellEditor.tsx`
- grouping/controls are implemented with `Web/src/components/BlockWrapper.tsx`
- AI streaming/refresh is handled via `Web/src/hooks/useBridgeMessages.ts` (store updates + persistence)

This model **cannot** support multi-cell selection robustly because selections cannot cross editor boundaries.

---

## Safety rails (do these first)

### Slice 00 — Add feature flag + dual-renderer scaffold (P0)

**Goal**
- Introduce a runtime flag to switch between:
  - `LegacyStreamEditor` (current, stable)
  - `UnifiedStreamEditor` (new, under construction)

**Non-goals**
- Don’t change any behavior when flag is off.

**Files**
- `Web/src/components/StreamEditor.tsx` (or `App.tsx` if global)
- `Web/src/utils/featureFlags.ts` (new)

**Implementation notes**
- Flag can be:
  - hardcoded `const USE_UNIFIED = false` (initially), or
  - read from `localStorage`, or
  - dev-only query param (recommended)
- Keep the legacy path as default until the end.

**Acceptance**
- App behaves exactly the same with flag off.
- With flag on, you can mount a placeholder component that renders “Unified editor coming soon”.

**Manual tests**
- Open stream, edit, save, switch streams, Quick Panel, AI streaming — all unchanged with flag off.

**STOP CONDITION**
- If any legacy behavior changes with flag off, revert this slice.

---

## The new editor (build it in controlled increments)

### Slice 01 — Create `UnifiedStreamEditor` (read-only render first) (P0)

**Goal**
- Mount a single TipTap editor for the whole stream that can render all cells in order.
- Initially: **read-only** to validate parsing + layout without persistence risk.

**Files**
- `Web/src/components/UnifiedStreamEditor.tsx` (new)
- `Web/src/extensions/CellBlock.ts` (new)
- `Web/src/extensions/CellBlockView.tsx` (new)
- `Web/src/styles/index.css` (new styles or reuse existing)

**Schema**
- `doc: cellBlock+`
- `cellBlock`:
  - `group: 'block'`
  - `content: 'block+'`  ✅ (critical: **not** inline-only)
  - attrs: `id`, `type`, `modelId`, `originalPrompt`, `sourceApp`, `blockName`, `processingConfig` (or `isLive`), etc.

**Parsing**
- For each existing cell:
  - create a `cellBlock` node with attrs from the cell model
  - parse `cell.content` (HTML) into ProseMirror block nodes using `DOMParser.fromSchema(...)`
  - insert those nodes as the `cellBlock` content

**NodeView**
- Render structure similar to current `BlockWrapper`:
  - left-side controls (info button, drag handle, live icon)
  - `NodeViewContent` as the editable content area
- Controls must use `contentEditable={false}` and should not block text selection.

**Acceptance**
- With flag on: the full stream renders inside one editor.
- Clicking/drag-selecting across multiple cells highlights as one selection (even if read-only).
- No crashes on existing streams containing mentions/images.

**Manual tests**
- Drag-select across 2–3 cells.
- Copy selection; paste into a plain text field; verify output is reasonable.

**STOP CONDITION**
- If parsing existing HTML fails for common cells (AI responses, images, mentions), stop and fix parsing before proceeding.

---

### Slice 02 — Make `UnifiedStreamEditor` editable + emit `onCellsChange` (P0)

**Goal**
- Allow edits within the unified doc.
- Convert doc → array of cells (id, html, type, order, attrs) on update.
- Do **not** persist yet; just log and update store in-memory.

**Files**
- `Web/src/components/UnifiedStreamEditor.tsx`
- `Web/src/store/blockStore.ts` (only if needed for integration)

**Doc→Cells extraction**
- Iterate top-level `cellBlock` nodes, in order:
  - `id` from attrs
  - `type` from attrs
  - `order` = index
  - `html` = `DOMSerializer.fromSchema(schema).serializeFragment(cellBlock.content)`
  - include metadata attrs you want to round-trip

**Store update**
- When unified editor changes:
  - update store blocks + order so SidePanel/search/overlay still work.
  - DO NOT call `bridge.saveCell` yet (until we confirm stability).

**Acceptance**
- Typing edits update the UI.
- SidePanel reflects the updated content (since store updates).
- No selection glitches when editing across boundaries.

**Manual tests**
- Edit multiple cells, reorder by dragging (if supported yet), switch focus around.

---

### Slice 03 — Persistence wiring (debounced + diffed) (P0)

**Goal**
- Reintroduce persistence safely:
  - debounced saves
  - save only changed cells
  - stream switch safety

**Files**
- `Web/src/components/StreamEditor.tsx` (or `UnifiedStreamEditor.tsx`, but keep ownership clear)
- `Web/src/store/blockStore.ts` (if baseline/diff storage lives here)

**Key invariants**
- No cross-stream writes:
  - cancel/flush debounced saves on stream change
  - guard by `streamId`
- No save storms on load:
  - seed baseline from TipTap-extracted content after initial hydration

**Acceptance**
- Editing in unified mode persists to Swift correctly.
- Switching streams quickly does not corrupt other streams.

**Manual tests**
- Type then immediately switch streams; verify no phantom edits appear.
- Quit/reopen app; edits persist.

---

## Keyboard + boundary semantics (keep it close to current behavior)

### Slice 04 — Enter/Backspace/Arrow boundary rules (P0)

**Goal**
- Restore the “cell-based” feel while still allowing rich formatting inside a cell.

**Rules (recommended)**
- **Enter**
  - If cursor is at end of the current cell *and* you’re in the last block of that cell: create a new `cellBlock` after it.
  - Otherwise: default ProseMirror behavior (new paragraph, list continuation, etc.)
- **Backspace**
  - If at start of the first block in a cell and the cell is empty: delete cell and move to previous cell end.
  - If at start and non-empty: merge with previous cell (optional; can defer).
- **ArrowUp/ArrowDown**
  - At start/end of cell: move selection into previous/next cell’s nearest position.

**Files**
- `Web/src/extensions/CellKeymap.ts` (new)
- `UnifiedStreamEditor.tsx` (register extension)

**Acceptance**
- Basic navigation feels like your demo build.
- Multi-cell selection still works (don’t intercept selection dragging).

**Manual tests**
- Create 10 cells via Enter.
- Backspace to delete empty cells at boundaries.
- Arrow up/down across boundaries.

**STOP CONDITION**
- If these shortcuts introduce cursor loss / selection bugs, back them out and re-add one key at a time.

---

## AI / Refresh / Live: keep the proven semantics

Important: your demo baseline did **not** require “stream chunks live into the editor”. It’s fine if the content appears on completion as long as the spinner/indicator is present.

### Slice 05 — Streaming indicators + safe “completion apply” (P0)

**Goal**
- Preserve current behavior:
  - `aiChunk`: update store accumulator (no editor mutation required)
  - `aiComplete`: compute final HTML and apply it into the unified editor cell content (by id)

**Implementation approach**
- Add an `EditorAPI` exposed by `UnifiedStreamEditor` with:
  - `replaceCellHtml(cellId, html, { addToHistory })`
  - `setCellStreaming(cellId, boolean)` (optional; can be derived from store)
- When `useBridgeMessages` receives `aiComplete`:
  - update store cell content (as it does today)
  - call `editorAPI.replaceCellHtml(cellId, finalHtml)` so the doc stays in sync

**Files**
- `Web/src/hooks/useBridgeMessages.ts` (add optional `editorAPI` integration when flag on)
- `Web/src/components/UnifiedStreamEditor.tsx` (implement API)
- `Web/src/extensions/CellBlock.ts` (attrs include `isStreaming?` if you want it in doc)
- `CellBlockView.tsx` (render spinner if streaming/refreshing)

**Acceptance**
- AI “think” works end-to-end in unified mode:
  - shows streaming indicator
  - on completion, content appears in the correct cell
  - regenerate works

**Manual tests**
- Cmd+Enter triggers AI, completion content appears.
- Regenerate changes output and persists after restart.

---

### Slice 06 — Refresh/live blocks (P0)

Same pattern as AI completion:
- refresh chunks can remain store-only
- refresh complete applies final HTML into the correct cell

Acceptance:
- opening a stream with live blocks refreshes them and persists updates
- no cross-stream refresh updates

---

## Quick Panel + drops (must not regress)

### Slice 07 — Quick Panel insertion + image drops in unified mode (P0)

**Goal**
- External insertions should mutate both:
  - store
  - unified editor doc

**Approach**
- When `quickPanelCellsAdded` arrives:
  - compute insertion target id (same logic you have now)
  - insert the new `cellBlock` nodes into the doc at the right position (by finding the target cell node)
- When `imageDropped` arrives:
  - insert an image node into the currently focused selection (ProseMirror handles this well)

**Acceptance**
- Quick Panel inserted cells appear immediately, in correct order.
- Dropped image appears in the intended cell and persists.

---

## Reordering + block controls

### Slice 08 — Reorder inside one editor (P1)

**Goal**
- Preserve your Notion-like drag reorder behavior.

**Approach options**
- **Option A (simplest)**: implement drag handle that sets a “dragged cell id”, and on drop compute target index and reorder `cellBlock` nodes in doc; then persist `reorderBlocks`.
- **Option B**: keep store reorder logic and reflect into editor via a targeted “move cellBlock by id” command.

Acceptance:
- drag reorder works without breaking selection/caret
- persisted order matches DB after restart

---

## Cutover plan (when everything works)

### Slice 09 — Make unified editor the default (P1)

**Goal**
- Flip the flag default to ON only after:
  - all P0 slices pass the checklist for at least a day of normal use

**Acceptance**
- Legacy path still exists as emergency fallback for one sprint.

---

## Acceptance harness (use this at every slice)

### Must-pass checklist

- **Editing**
  - type in multiple cells
  - Enter creates new cell at end of cell
  - Backspace deletes empty cells properly
  - Arrow navigation across cells
- **Selection**
  - drag select across multiple cells
  - copy/paste selection
- **Persistence**
  - edits persist after restart
  - no cross-stream corruption on fast navigation
- **AI**
  - Cmd+Enter think → content appears on completion
  - regenerate works
- **Refresh/live**
  - refresh completes and persists
- **Quick Panel**
  - inserted cells appear in correct position
  - file drops + image drops work

### Stop conditions (when to revert a slice)

- any regression in baseline features under legacy mode
- any “doc rebuild” behavior that deletes cells during AI/refresh completion
- any selection/caret bug that cannot be explained and fixed within the slice

---

## Notes to Claude (process)

- Keep each slice to a single PR with:
  - a short summary
  - file list
  - manual test evidence (screen recording or bullet list)
- Do not proceed to the next slice until Niko confirms.
- Prefer additive changes behind a flag. Delete code only at the end.


