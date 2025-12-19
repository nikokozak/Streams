# UX Polish Tasks (Unified Editor)

This document is a step-by-step execution guide for UI/UX polish work on branch `feature/single-editor-refactor`.

It is written for Claude to implement in small “slices” and for GPT-5.2 to review after each slice.

## Workflow Rules (non-negotiable)

1. **One slice at a time.** Do not bundle multiple slices into one diff.
2. **Stop for approval after each slice.** Claude must provide `git diff` + a short verification checklist and wait for GPT-5.2 approval before:
   - marking the slice “finished”
   - starting the next slice
3. **No scope creep.** If a change seems “adjacent but useful”, ask first.
4. **Preserve invariants.** UUID cell identity, unified doc schema (`doc -> cellBlock+`), and NodeView safety rules must not be broken.

## Scope

### In scope (now)

1. Toast UX improvements (dedupe/cap/copy).
2. Drag reorder polish (selection suppression, autoscroll, clearer target feedback).
3. Overlay focus + keyboard polish.
4. Streaming “thinking” affordance inside a cell (blurred scrolling window or fallback).
5. Side panel focus polish (small, safe).

### Explicitly deferred (do not implement yet)

**Cell-level error overlays / error state machines.**

We have ideas for integrating errors into the “info overlay” design language, but it’s more complex than expected
(especially around deletion/restore semantics and operation context). For now:
- toasts are the primary user-facing error surface
- debugging focuses on making errors visible + copyable

If you are tempted to implement per-cell error UX, stop and ask first.

## Context: Key Files

**Toasts**
- `Web/src/store/toastStore.ts`: global toast state (zustand)
- `Web/src/components/ToastStack.tsx`: bottom-right UI
- `Web/src/styles/index.css`: toast styling

**Unified editor / NodeViews**
- `Web/src/components/UnifiedStreamEditor.tsx`: single-editor persistence + bridge integration
- `Web/src/extensions/CellBlockView.tsx`: cell chrome, overlay toggle, drag reorder implementation
- `Web/src/components/CellOverlay.tsx`: “info overlay” (prompt editing, regenerate, references)

**Store**
- `Web/src/store/blockStore.ts`: canonical cell map/order + streaming/modifying/refresh state

## Slice 1 — Toast UX hardening (dedupe + cap + copy)

### Goal
Make toasts useful for debugging without spamming users during repeated failures.

### Requirements
- Toast stack stays bottom-right, dismissable.
- Prevent toast spam from repeated identical errors:
  - dedupe identical `kind+message` within a short window (e.g. 1500–2500ms)
  - cap total visible toasts (e.g. keep newest 4, drop oldest)
- Add `Copy` affordance for error messages (clipboard write).
- Keep the implementation simple (no external deps).

### Suggested implementation
- In `toastStore.addToast`, before appending:
  - if the last toast has same `kind+message` and `Date.now() - last.createdAt < DEDUPE_MS`, do nothing.
  - if adding would exceed `MAX_TOASTS`, drop from the front.
- In `ToastStack`, add:
  - a “Copy” button (optional; only show for errors/warnings)
  - a “Clear all” button if more than 1 toast (optional)

### Acceptance checks (manual)
- Trigger the same error repeatedly (e.g., disable API key and hit Cmd+Enter several times):
  - only a small number of toasts appear
  - copy works and copies the error string

## Slice 2 — Drag reorder polish (selection suppression + autoscroll + target highlight)

### Goal
Make drag reorder feel deliberate and reduce accidental text selection while dragging.

### Requirements
- Disable text selection during drag reorder.
- Auto-scroll the viewport when dragging near the top/bottom.
- Add subtle hovered-target highlight during dragover (no loud indicator line).
- Must not interfere with persistence (`reorderBlocks` message is still the authoritative persist).

### Suggested implementation
- In `CellBlockView.tsx` drag start/end:
  - toggle `document.body.classList.add('is-cell-dragging')` / remove on cleanup.
- CSS:
  - `.is-cell-dragging { user-select: none; cursor: grabbing; }`
  - `.is-cell-dragging .cell-block-wrapper { cursor: grabbing; }` (optional)
- Autoscroll:
  - start an interval/rAF loop during drag that checks pointer Y proximity to viewport edges and calls `window.scrollBy`.
  - ensure it stops on drag end / idle cleanup.
- Target highlight:
  - track “currently hovered drop target id” (local state or a module-level var), apply a class to the wrapper.

### Acceptance checks (manual)
- Drag reorder with long streams:
  - no accidental text selection while dragging
  - dragging near viewport edges scrolls smoothly
  - reorder still persists reliably

## Slice 3 — Overlay focus + keyboard polish

### Goal
Make overlay interactions predictable and keyboard-friendly without breaking ProseMirror.

### Requirements
- Opening overlay should focus a sensible control (prompt editor if present; otherwise close button).
- ESC behavior remains consistent:
  - ESC closes overlay unless focus is inside the prompt editor; then blur first (existing behavior is fine).
- Overlay must not block editing other cells.

### Suggested implementation
- In `CellOverlay.tsx`, on mount:
  - `requestAnimationFrame` to focus the primary element if present.
- Ensure all overlay root elements remain `contentEditable={false}`.

### Acceptance checks (manual)
- Open overlay and type in prompt editor immediately.
- ESC closes reliably without leaving the editor in a weird selection state.

## Slice 4 — Streaming “thinking window” (blurred scrolling) + fallback

### Goal
Replace “spinner only” with a modern “AI is thinking” affordance inside a cell.

### Requirements
- During streaming/refreshing/modifying, show a subtle internal “thinking” layer:
  - blurred scrolling pseudo-text (not readable)
  - respects `prefers-reduced-motion` (fallback to “Streaming…” + animated dots)
- Must not be part of the ProseMirror doc (pure UI overlay).
- Must not capture clicks/selection (use `pointer-events: none`).

### Suggested implementation
- In `CellBlockView.tsx`, when `showSpinner` is true:
  - render a positioned overlay div in the wrapper with:
    - a vertically animated pseudo-text block
    - `filter: blur(6px)` and `opacity` tuned
    - a mask/gradient for nicer look
- Generate pseudo-text locally (static list of strings is fine; avoid randomness that changes every render).

### Acceptance checks (manual)
- Streaming shows the “thinking” effect.
- Reduced motion users see a simple fallback.
- You can still place cursor and edit other cells.

## Slice 5 — Side panel focus polish (small + safe)

### Goal
Make the outline feel connected to the editor without introducing render loops.

### Requirements
- When focused cell changes, optionally scroll the corresponding outline item into view (debounced).
- Must not subscribe to unstable snapshots or call store getters that allocate every render.

### Suggested implementation
- Keep existing memoization patterns (similar to the `UnifiedStreamSidePanel` comment about unstable snapshots).
- Use refs + `setTimeout` debounce to scroll.

### Acceptance checks (manual)
- Navigate through cells with arrow keys; outline follows focus reasonably.
- No “maximum update depth exceeded” regressions.

## Notes: Why cell-error UX is deferred

We considered multiple designs (persistent banners, error overlays, and integrating errors into the info panel).
The tricky part is defining consistent semantics for “clear” and “retry” across:
- AI think (prompt consumption / type transitions)
- modifiers (transformations with prior content)
- refresh (live blocks)

Until we define a stable “operation context” contract, we’ll keep error UX limited to toasts and revisit later.

