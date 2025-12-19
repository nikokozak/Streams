import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Mention from '@tiptap/extension-mention';
import Document from '@tiptap/extension-document';
import { useMemo, useEffect, useCallback, useRef } from 'react';
import { Stream, Cell } from '../types';
import { CellBlock } from '../extensions/CellBlock';
import { useBlockStore } from '../store/blockStore';
import { Editor } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';

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

      cells.push({
        id: node.attrs.id || `cell-${index}`,
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
 * Slice 02: Editable with store sync (no persistence yet).
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
  const cellCount = useBlockStore((s) => s.blockOrder.length);

  // Track if we've initialized the store for this stream
  const initializedStreamId = useRef<string | null>(null);

  // Build initial HTML from cells
  const initialHtml = useMemo(() => buildHtmlFromCells(stream.cells), [stream.cells]);

  // Handle editor updates - extract cells and sync to store
  const handleUpdate = useCallback(({ editor }: { editor: Editor }) => {
    const extractedCells = extractCellsFromDoc(editor);

    if (IS_DEV) {
      console.log('[UnifiedStreamEditor] onUpdate: extracted', extractedCells.length, 'cells');
    }

    // Update each cell in the store
    // Note: We're updating in-memory only, no persistence yet (Slice 03)
    for (const cell of extractedCells) {
      if (cell.id) {
        const existingBlock = getBlock(cell.id);
        if (existingBlock) {
          const nextContent = cell.content ?? existingBlock.content;
          const nextOrder = cell.order ?? existingBlock.order;

          // CRITICAL: Don't update unchanged blocks.
          // updateBlock() bumps updatedAt and triggers store subscribers.
          if (existingBlock.content !== nextContent || existingBlock.order !== nextOrder) {
            updateBlock(cell.id, {
              content: nextContent,
              order: nextOrder,
            });
          }
        }
        // Note: We don't add new blocks here yet - that requires Enter key handling (Slice 04)
      }
    }
  }, [getBlock, updateBlock]);

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
      CellBlock,
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
    },
    onUpdate: handleUpdate,
  });

  // Initialize store with stream data on mount
  useEffect(() => {
    if (stream.id !== initializedStreamId.current) {
      if (IS_DEV) {
        console.log('[UnifiedStreamEditor] Initializing store for stream:', stream.id);
      }
      loadStream(stream.id, stream.cells);
      initializedStreamId.current = stream.id;
    }
  }, [stream.id, stream.cells, loadStream]);

  return (
    <div className="stream-editor">
      <header className="stream-header">
        <button onClick={onBack} className="back-button">
          &larr; Back
        </button>
        <h1 className="stream-title-editable">{stream.title}</h1>
        <span className="stream-hint">Editing enabled (changes not saved)</span>
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
              Editing enabled. Changes sync to store (no persistence yet).
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
