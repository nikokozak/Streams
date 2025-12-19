import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Mention from '@tiptap/extension-mention';
import Document from '@tiptap/extension-document';
import { useMemo, useEffect, useCallback, useRef } from 'react';
import { Stream, Cell, bridge } from '../types';
import { CellBlock } from '../extensions/CellBlock';
import { CellClipboard } from '../extensions/CellClipboard';
import { CellKeymap, CellKeymapCallbacks } from '../extensions/CellKeymap';
import { useBlockStore } from '../store/blockStore';
import { Editor } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';

/** Save debounce delay in ms - matches Cell component */
const SAVE_DEBOUNCE_MS = 500;

/** Baseline entry for tracking what was last saved */
interface BaselineEntry {
  content: string;
  order: number;
}

interface UnifiedStreamEditorProps {
  stream: Stream;
  onBack: () => void;
  onDelete: () => void;
  onNavigateToStream?: (streamId: string, targetId: string, targetType?: 'cell' | 'source') => void;
  pendingCellId?: string | null;
  pendingSourceId?: string | null;
  onClearPendingCell?: () => void;
  onClearPendingSource?: () => void;
}

const IS_DEV = Boolean((import.meta as any).env?.DEV);

/**
 * Escape a string so it is safe to embed inside a double-quoted HTML attribute value.
 */
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape plain text for safe inclusion inside HTML.
 */
function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Convert a cell to an HTML string wrapped in a cellBlock element.
 */
function cellToHtml(cell: Cell): string {
  const attrs: string[] = [
    'data-cell-block',
    `data-cell-id="${cell.id}"`,
    `data-cell-type="${cell.type}"`,
  ];

  if (cell.modelId) attrs.push(`data-model-id="${escapeHtmlAttribute(cell.modelId)}"`);
  if (cell.originalPrompt) attrs.push(`data-original-prompt="${escapeHtmlAttribute(cell.originalPrompt)}"`);
  if (cell.sourceApp) attrs.push(`data-source-app="${escapeHtmlAttribute(cell.sourceApp)}"`);
  if (cell.blockName) attrs.push(`data-block-name="${escapeHtmlAttribute(cell.blockName)}"`);
  if (cell.processingConfig?.refreshTrigger === 'onStreamOpen') attrs.push('data-is-live="true"');
  if (cell.processingConfig?.refreshTrigger === 'onDependencyChange') attrs.push('data-has-dependencies="true"');

  let content = cell.content || '';
  if (!content.trim()) {
    content = '<p></p>';
  } else if (!content.trimStart().startsWith('<')) {
    content = `<p>${escapeHtmlText(content)}</p>`;
  }

  return `<div ${attrs.join(' ')}>${content}</div>`;
}

/**
 * Build HTML content from all cells.
 */
function buildHtmlFromCells(cells: Cell[]): string {
  const sortedCells = [...cells].sort((a, b) => a.order - b.order);

  if (sortedCells.length === 0) {
    return '<div data-cell-block data-cell-id="empty" data-cell-type="text"><p></p></div>';
  }

  return sortedCells.map(cellToHtml).join('');
}

/**
 * Create a real (UUID-backed) initial cell for a brand-new empty stream.
 * This matches the legacy editor behavior: empty streams still start with one editable cell.
 */
function createBootstrapCell(streamId: string): Cell {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    streamId,
    content: '<p></p>',
    type: 'text',
    sourceBinding: null,
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Extract cell data from a TipTap editor document.
 * Returns an array of partial Cell objects with id, type, content, and order.
 */
function extractCellsFromDoc(editor: Editor): Partial<Cell>[] {
  const cells: Partial<Cell>[] = [];
  const { doc, schema } = editor.state;
  const serializer = DOMSerializer.fromSchema(schema);

  doc.forEach((node, _offset, index) => {
    if (node.type.name === 'cellBlock') {
      // Serialize the cellBlock's content (not the cellBlock itself) to HTML
      const contentFragment = node.content;
      const domFragment = serializer.serializeFragment(contentFragment);

      // Convert DOM fragment to HTML string
      const tempDiv = document.createElement('div');
      tempDiv.appendChild(domFragment);
      const html = tempDiv.innerHTML;

      const id: string | null = node.attrs.id ?? null;
      if (!id) {
        if (IS_DEV) {
          console.warn('[UnifiedStreamEditor] cellBlock missing attrs.id; skipping during extract');
        }
        return;
      }

      cells.push({
        id,
        type: node.attrs.type || 'text',
        content: html,
        order: index,
        modelId: node.attrs.modelId || undefined,
        originalPrompt: node.attrs.originalPrompt || undefined,
        sourceApp: node.attrs.sourceApp || undefined,
        blockName: node.attrs.blockName || undefined,
        processingConfig: node.attrs.isLive
          ? { refreshTrigger: 'onStreamOpen' }
          : node.attrs.hasDependencies
            ? { refreshTrigger: 'onDependencyChange' }
            : undefined,
      });
    }
  });

  return cells;
}

// Custom document that only allows cellBlocks at the top level
const CustomDocument = Document.extend({
  content: 'cellBlock+',
});

/**
 * Unified stream editor - single TipTap instance for the entire stream.
 * Enables true cross-cell text selection.
 *
 * Slice 01: Read-only render with CellBlock nodes
 * Slice 02: Editable with store sync
 * Slice 03: Persistence with debounced + diff-based saves
 *           - Baseline tracking prevents save storms on load
 *           - Guards against cross-stream writes via streamIdRef
 *           - Flushes pending saves on stream switch and unmount
 * Slice 04: Enter/Backspace/Arrow boundary handling
 *           - Enter at end of cell creates new cellBlock
 *           - Backspace in empty cell at boundary deletes it
 *           - Arrow keys navigate across cell boundaries
 *           - All operations use UUID-based cell identity
 */
export function UnifiedStreamEditor({
  stream,
  onBack,
}: UnifiedStreamEditorProps) {
  // Subscribe to only the stable actions we need.
  // Avoid subscribing to the entire store state object: on every keystroke we call updateBlock,
  // which would otherwise re-render this component and (potentially) churn TipTap options.
  const loadStream = useBlockStore((s) => s.loadStream);
  const getBlock = useBlockStore((s) => s.getBlock);
  const updateBlock = useBlockStore((s) => s.updateBlock);
  const addBlock = useBlockStore((s) => s.addBlock);
  const deleteBlock = useBlockStore((s) => s.deleteBlock);
  const cellCount = useBlockStore((s) => s.blockOrder.length);

  // Track if we've initialized the store for this stream
  const initializedStreamId = useRef<string | null>(null);
  const bootstrapCellRef = useRef<Cell | null>(null);
  const bootstrapStreamIdRef = useRef<string | null>(null);

  // Persistence refs (Slice 03)
  // Baseline tracks what was last saved - used for diffing
  const baselineRef = useRef<Map<string, BaselineEntry>>(new Map());
  // Pending saves (cellId -> latest content/order seen from the editor doc)
  // This avoids relying on store-diffing to decide what to persist.
  const pendingSavesRef = useRef<Map<string, BaselineEntry>>(new Map());
  // Debounce timeout for batching saves
  const saveTimeoutRef = useRef<number | null>(null);
  // Guard against cross-stream writes (stream switch before save completes)
  const streamIdRef = useRef<string>(stream.id);

  // Build initial cells and HTML.
  // Empty streams still need a real UUID-backed cell so persistence works (Swift rejects non-UUID ids).
  const initialCells = useMemo(() => {
    if (stream.cells.length > 0) return stream.cells;

    if (bootstrapStreamIdRef.current !== stream.id) {
      bootstrapCellRef.current = createBootstrapCell(stream.id);
      bootstrapStreamIdRef.current = stream.id;
    }

    return bootstrapCellRef.current ? [bootstrapCellRef.current] : [];
  }, [stream.id, stream.cells]);

  const initialHtml = useMemo(() => buildHtmlFromCells(initialCells), [initialCells]);

  // Keep streamIdRef in sync
  useEffect(() => {
    streamIdRef.current = stream.id;
  }, [stream.id]);

  /**
   * Save pending edited cells (debounced).
   *
   * Why pending ref?
   * - TipTap is the true source-of-truth during editing.
   * - Store updates can be missed or normalized; pending tracks what the editor actually produced.
   * - Swift requires UUID ids; we always map doc index -> store.blockOrder UUID.
   */
  const savePendingCells = useCallback(() => {
    const currentStreamId = streamIdRef.current;

    // Safety check: don't save if stream ID doesn't match
    if (currentStreamId !== stream.id) {
      if (IS_DEV) {
        console.warn('[UnifiedStreamEditor] savePendingCells: streamId mismatch, skipping save');
      }
      return;
    }

    const baseline = baselineRef.current;
    const pending = pendingSavesRef.current;
    const store = useBlockStore.getState();

    let savedCount = 0;

    if (IS_DEV && !window.webkit?.messageHandlers?.bridge) {
      console.warn('[UnifiedStreamEditor] window.webkit.messageHandlers.bridge missing; saveCell will be a no-op (running outside the macOS app?)');
    }

    // Persist only the cells we saw edits for.
    // (We still baseline-diff as a second guard against save storms.)
    pending.forEach((pendingEntry, cellId) => {
      const cell = store.getBlock(cellId);
      if (!cell) return;

      const baselineEntry = baseline.get(cellId);
      const hasChanged =
        !baselineEntry ||
        baselineEntry.content !== pendingEntry.content ||
        baselineEntry.order !== pendingEntry.order;

      if (!hasChanged) {
        pending.delete(cellId);
        return;
      }

      bridge.send({
        type: 'saveCell',
        payload: {
          id: cellId,
          streamId: currentStreamId,
          content: pendingEntry.content,
          type: cell.type,
          order: pendingEntry.order,
          restatement: cell.restatement,
          originalPrompt: cell.originalPrompt,
          modelId: cell.modelId,
          sourceApp: cell.sourceApp,
          references: cell.references,
          blockName: cell.blockName,
          processingConfig: cell.processingConfig,
          modifiers: cell.modifiers,
          versions: cell.versions,
          activeVersionId: cell.activeVersionId,
          sourceBinding: cell.sourceBinding,
        },
      });

      baseline.set(cellId, { content: pendingEntry.content, order: pendingEntry.order });
      pending.delete(cellId);
      savedCount++;
    });

    if (IS_DEV) {
      console.log(`[UnifiedStreamEditor] savePendingCells: saved=${savedCount} pendingRemaining=${pending.size}`);
    }
  }, [stream.id]);

  /**
   * Schedule a debounced save.
   * Cancels any pending save and schedules a new one.
   */
  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    if (IS_DEV) {
      console.log('[UnifiedStreamEditor] scheduleSave');
    }
    saveTimeoutRef.current = window.setTimeout(() => {
      saveTimeoutRef.current = null;
      if (IS_DEV) {
        console.log('[UnifiedStreamEditor] scheduleSave: fired');
      }
      savePendingCells();
    }, SAVE_DEBOUNCE_MS);
  }, [savePendingCells]);

  /**
   * Flush any pending save immediately.
   * Called on blur, stream switch, or unmount.
   */
  const flushPendingSave = useCallback(() => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    // Flush even if we didn't have a timeout; pending edits may still exist.
    savePendingCells();
  }, [savePendingCells]);

  /**
   * Create a new cell after the given cell.
   * Called by CellKeymap when Enter is pressed at the end of a cell.
   * Returns the new cell's UUID.
   */
  const handleCreateCell = useCallback((afterCellId: string): string => {
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Get the order of the cell we're inserting after
    const afterBlock = getBlock(afterCellId);
    const newOrder = afterBlock ? afterBlock.order + 1 : 0;

    const newCell: Cell = {
      id: newId,
      streamId: stream.id,
      content: '<p></p>',
      type: 'text',
      sourceBinding: null,
      order: newOrder,
      createdAt: now,
      updatedAt: now,
    };

    // Add to store
    addBlock(newCell, afterCellId);

    // Use the store's post-insert order (blockStore may renormalize).
    const inserted = useBlockStore.getState().getBlock(newId);
    const insertedOrder = inserted?.order ?? newOrder;

    // Add to baseline (so it doesn't trigger a save until actually edited)
    baselineRef.current.set(newId, { content: newCell.content, order: insertedOrder });

    // Persist to Swift immediately (new cells should save right away)
    bridge.send({
      type: 'saveCell',
      payload: {
        id: newId,
        streamId: stream.id,
        content: newCell.content,
        type: newCell.type,
        order: insertedOrder,
      },
    });

    if (IS_DEV) {
      console.log('[UnifiedStreamEditor] Created new cell:', newId, 'after:', afterCellId);
    }

    return newId;
  }, [stream.id, getBlock, addBlock]);

  /**
   * Delete an empty cell.
   * Called by CellKeymap when Backspace is pressed in an empty cell at the boundary.
   */
  const handleDeleteCell = useCallback((cellId: string) => {
    // Remove from store
    deleteBlock(cellId);

    // Remove from baseline and pending saves
    baselineRef.current.delete(cellId);
    pendingSavesRef.current.delete(cellId);

    // Persist deletion to Swift
    bridge.send({
      type: 'deleteCell',
      payload: { id: cellId },
    });

    if (IS_DEV) {
      console.log('[UnifiedStreamEditor] Deleted cell:', cellId);
    }
  }, [deleteBlock]);

  /**
   * CellKeymap callbacks for Enter/Backspace at cell boundaries.
   * Stable reference to avoid re-creating the extension on every render.
   */
  const cellKeymapCallbacks = useRef<CellKeymapCallbacks>({
    onCreateCell: (afterCellId: string) => handleCreateCell(afterCellId),
    onDeleteCell: (cellId: string) => handleDeleteCell(cellId),
  });

  // Keep callbacks in sync
  useEffect(() => {
    // IMPORTANT: mutate existing object, don't replace it.
    // The extension captured the original object reference via configure();
    // replacing the object would leave the keymap calling stale callbacks.
    cellKeymapCallbacks.current.onCreateCell = handleCreateCell;
    cellKeymapCallbacks.current.onDeleteCell = handleDeleteCell;
  }, [handleCreateCell, handleDeleteCell]);

  // Handle editor updates - extract cells and sync to store, then schedule save
  const handleUpdate = useCallback(({ editor }: { editor: Editor }) => {
    const extractedCells = extractCellsFromDoc(editor);

    if (IS_DEV) {
      console.log('[UnifiedStreamEditor] onUpdate: extracted', extractedCells.length, 'cells');
    }

    let hasChanges = false;

    // Detect structural deletions (e.g., multi-cell selection delete, merges at boundaries).
    // If a cellBlock id disappears from the doc, we must delete it from the store and persist deleteCell.
    // This is required to avoid "looks deleted until reload" bugs.
    const docCellIds = new Set<string>();
    for (const extracted of extractedCells) {
      if (extracted.id) docCellIds.add(extracted.id);
    }

    const { blockOrder } = useBlockStore.getState();
    for (const existingId of blockOrder) {
      if (!docCellIds.has(existingId)) {
        if (IS_DEV) {
          console.log('[UnifiedStreamEditor] Doc removed cellBlock, persisting delete:', existingId);
        }
        handleDeleteCell(existingId);
      }
    }

    // Slice 04: Use cell ID from node attrs (UUID), not positional index.
    // This is critical for supporting cell creation/deletion/reorder.
    for (const extracted of extractedCells) {
      const cellId = extracted.id;
      if (!cellId) continue;

      const existingBlock = getBlock(cellId);
      if (!existingBlock) {
        // Cell exists in doc but not in store.
        // Prefer to self-heal: treat doc as authoritative structure and create a minimal store block.
        if (IS_DEV) {
          console.log('[UnifiedStreamEditor] Cell in doc but not in store; creating:', cellId);
        }
        const now = new Date().toISOString();
        const newCell: Cell = {
          id: cellId,
          streamId: stream.id,
          content: extracted.content ?? '<p></p>',
          type: (extracted.type as Cell['type']) ?? 'text',
          sourceBinding: null,
          order: extracted.order ?? 0,
          createdAt: now,
          updatedAt: now,
        };
        addBlock(newCell);
        // IMPORTANT: don't seed baseline for doc-created cells.
        // If this cell came from a paste of multiple cellBlocks, we need to persist it
        // (Swift requires UUID ids, and this is a *new* cell in the stream).
        pendingSavesRef.current.set(cellId, { content: newCell.content, order: newCell.order });
        hasChanges = true;
        continue;
      }

      const nextContent = extracted.content ?? existingBlock.content;
      const nextOrder = extracted.order ?? existingBlock.order;

      // Track pending edits against baseline (not store) so we don't miss scheduling saves.
      const baselineEntry = baselineRef.current.get(cellId);
      if (!baselineEntry || baselineEntry.content !== nextContent || baselineEntry.order !== nextOrder) {
        pendingSavesRef.current.set(cellId, { content: nextContent, order: nextOrder });
        hasChanges = true;
      }

      // CRITICAL: Don't update unchanged blocks.
      // updateBlock() bumps updatedAt and triggers store subscribers.
      if (existingBlock.content !== nextContent || existingBlock.order !== nextOrder) {
        updateBlock(cellId, {
          content: nextContent,
          order: nextOrder,
        });
      }
    }

    // Schedule debounced save if there were changes (Slice 03)
    if (hasChanges) {
      scheduleSave();
    }
  }, [getBlock, updateBlock, scheduleSave]);

  // Create the unified editor
  const editor = useEditor({
    extensions: [
      CustomDocument,
      StarterKit.configure({
        document: false,
        heading: {
          levels: [1, 2, 3],
        },
      }),
      // Must run before CellBlock parse/insert logic so pasted cellBlocks get fresh UUIDs.
      CellClipboard,
      CellBlock,
      CellKeymap.configure({
        callbacks: cellKeymapCallbacks.current,
      }),
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: {
          class: 'cell-image',
          draggable: 'false',
        },
      }),
      Mention.configure({
        HTMLAttributes: {
          class: 'cell-reference',
        },
        renderLabel({ node }) {
          return `@block-${node.attrs.shortId ?? node.attrs.id?.substring(0, 4).toLowerCase() ?? '????'}`;
        },
      }),
    ],
    content: initialHtml,
    editable: true, // Slice 02: Enable editing
    editorProps: {
      attributes: {
        class: 'unified-editor-content',
      },
      // Save immediately when focus leaves the editor (mirrors legacy Cell blur behavior).
      // This makes persistence feel responsive even with debouncing enabled.
      handleDOMEvents: {
        blur: () => {
          flushPendingSave();
          return false;
        },
      },
    },
    onUpdate: handleUpdate,
  });

  // Initialize store with stream data on mount and seed baseline
  useEffect(() => {
    if (stream.id !== initializedStreamId.current) {
      // Flush any pending saves from previous stream before switching
      flushPendingSave();

      if (IS_DEV) {
        console.log('[UnifiedStreamEditor] Initializing store for stream:', stream.id);
      }

      // Load stream data into store (bootstrap empty streams with 1 real cell)
      loadStream(stream.id, initialCells);
      initializedStreamId.current = stream.id;

      // Seed baseline from initial cells to prevent "save storm" on load
      // This ensures we only save cells that actually change after loading
      const baseline = baselineRef.current;
      baseline.clear();
      for (const cell of initialCells) {
        baseline.set(cell.id, { content: cell.content, order: cell.order });
      }

      if (IS_DEV) {
        console.log('[UnifiedStreamEditor] Seeded baseline with', baseline.size, 'cells');
      }
    }
  }, [stream.id, initialCells, loadStream, flushPendingSave]);

  // Cleanup: flush pending saves on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      // Always attempt a final flush (pending saves are ref-based).
      flushPendingSave();
    };
  }, [flushPendingSave]);

  return (
    <div className="stream-editor">
      <header className="stream-header">
        <button onClick={onBack} className="back-button">
          &larr; Back
        </button>
        <h1 className="stream-title-editable">{stream.title}</h1>
        <span className="stream-hint">Unified editor (auto-saves)</span>
      </header>

      <div className="stream-body">
        <div className="stream-content unified-editor-container">
          {editor ? (
            <EditorContent editor={editor} />
          ) : (
            <div className="loading-state">Loading editor...</div>
          )}

          {IS_DEV ? (
            <div
              style={{
                marginTop: '20px',
                padding: '10px',
                background: 'var(--color-surface)',
                borderRadius: '4px',
                fontSize: '12px',
                color: 'var(--color-text-secondary)',
              }}
            >
              <strong>Debug:</strong> {stream.cells.length} cells from stream, {cellCount} in store.
              Persistence enabled (debounced 500ms, diff-based saves).
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
