import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Mention from '@tiptap/extension-mention';
import Document from '@tiptap/extension-document';
import { useMemo } from 'react';
import { Stream, Cell } from '../types';
import { CellBlock } from '../extensions/CellBlock';

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
 * NOTE: We're building HTML strings for TipTap initialization, so *any* unescaped quotes
 * or angle brackets in metadata can break parsing (or worse).
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
 * Escape plain text for safe inclusion inside HTML (e.g., when wrapping plain text in <p>).
 */
function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Convert a cell to an HTML string wrapped in a cellBlock element.
 * The cellBlock attributes are stored as data-* attributes.
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

  // Ensure cell content has at least a paragraph for proper block+ structure
  let content = cell.content || '';
  if (!content.trim()) {
    content = '<p></p>';
  } else if (!content.trimStart().startsWith('<')) {
    // Wrap plain text in paragraph
    content = `<p>${escapeHtmlText(content)}</p>`;
  }

  return `<div ${attrs.join(' ')}>${content}</div>`;
}

/**
 * Build HTML content from all cells.
 */
function buildHtmlFromCells(cells: Cell[]): string {
  // Sort cells by order
  const sortedCells = [...cells].sort((a, b) => a.order - b.order);

  // If no cells, create one empty cellBlock
  if (sortedCells.length === 0) {
    return '<div data-cell-block data-cell-id="empty" data-cell-type="text"><p></p></div>';
  }

  return sortedCells.map(cellToHtml).join('');
}

// Custom document that only allows cellBlocks at the top level
const CustomDocument = Document.extend({
  content: 'cellBlock+',
});

/**
 * Unified stream editor - single TipTap instance for the entire stream.
 * Enables true cross-cell text selection.
 *
 * Slice 01: Read-only rendering to validate parsing and layout.
 */
export function UnifiedStreamEditor({
  stream,
  onBack,
}: UnifiedStreamEditorProps) {
  // Build initial HTML from cells
  const initialHtml = useMemo(() => buildHtmlFromCells(stream.cells), [stream.cells]);

  // Create the unified editor
  const editor = useEditor({
    extensions: [
      // Custom document that requires cellBlock+ at top level
      CustomDocument,
      // StarterKit without document (we use CustomDocument)
      StarterKit.configure({
        document: false,
        heading: {
          levels: [1, 2, 3],
        },
      }),
      // CellBlock node for wrapping cells
      CellBlock,
      // Image support
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: {
          class: 'cell-image',
          draggable: 'false',
        },
      }),
      // Mention support for @block-references
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
    // Slice 01: Start read-only to validate parsing
    editable: false,
    editorProps: {
      attributes: {
        class: 'unified-editor-content',
      },
    },
  });

  return (
    <div className="stream-editor">
      <header className="stream-header">
        <button onClick={onBack} className="back-button">
          &larr; Back
        </button>
        <h1 className="stream-title-editable">{stream.title}</h1>
        <span className="stream-hint">Unified Editor (read-only preview)</span>
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
              <strong>Debug:</strong> {stream.cells.length} cells loaded. Drag-select across cells to test cross-cell selection.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
