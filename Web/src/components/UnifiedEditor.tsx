import { useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Document from '@tiptap/extension-document';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';
import { TextSelection } from '@tiptap/pm/state';
import { Node as ProseMirrorNode, Fragment, DOMParser, DOMSerializer } from '@tiptap/pm/model';
import DOMPurify from 'dompurify';
import { CellBlock, CellBlockAttributes } from '../extensions/CellBlock';
import { CellKeymap } from '../extensions/CellKeymap';
import { BlockReference } from '../extensions/BlockReference';
import { createBlockReferenceSuggestion } from '../extensions/BlockReferenceSuggestion';
import { Cell as CellType } from '../types';
import { EditorAPI, InsertableCellData } from '../contexts/EditorContext';

// DOMPurify config for TipTap content
// NOTE: This is more permissive than markdown.ts to support:
// - Custom inline NodeViews (mentions, chips) that use span + data-* attrs
// - Future extension attributes
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'code', 'pre',
    'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'hr', 'del', 's', 'sup', 'sub',
    'span', // For inline NodeViews (mentions, chips, etc.)
  ],
  // Note: 'rel' is required for Link extension's noopener/noreferrer security
  ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'title', 'target', 'rel', 'id'],
  // Allow data-* attributes for custom NodeView extensions (mentions, references)
  ALLOW_DATA_ATTR: true,
};

// Type for tiptap-markdown storage
interface MarkdownStorage {
  getMarkdown: () => string;
  serializer: {
    serialize: (content: ProseMirrorNode | Fragment) => string;
  };
  parser: {
    parse: (content: string, options?: { inline?: boolean }) => string; // Returns HTML
  };
}

/**
 * Convert @block-xxx patterns in HTML to proper span elements for BlockReference parsing.
 * Uses DOM-based approach to only replace in text nodes, skipping:
 * - Inside existing .cell-reference spans (avoid double-wrap)
 * - Inside code/pre elements (preserve code blocks)
 * - Inside anchor elements (don't break links)
 *
 * Supports two formats:
 * - Legacy: @block-xxxx (shortId only, resolved by prefix matching)
 * - New: @block-xxxx:full-uuid (shortId + full UUID for deterministic resolution)
 */
function convertBlockReferencesToSpans(html: string): string {
  // Pattern: @block-{shortId} optionally followed by :{fullUUID}
  // Group 1: shortId (3+ alphanumeric)
  // Group 2: optional full UUID (after colon)
  const REF_PATTERN = /@block-([a-zA-Z0-9]{3,})(?::([a-f0-9-]{36}))?/gi;

  // Parse HTML into DOM
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;

  // Elements to skip (don't replace references inside these)
  const SKIP_TAGS = new Set(['CODE', 'PRE', 'A', 'SCRIPT', 'STYLE']);

  function shouldSkip(node: Node): boolean {
    let current: Node | null = node;
    while (current && current !== tempDiv) {
      if (current.nodeType === Node.ELEMENT_NODE) {
        const el = current as Element;
        // Skip if inside a cell-reference span or skip tag
        if (el.classList?.contains('cell-reference') || SKIP_TAGS.has(el.tagName)) {
          return true;
        }
      }
      current = current.parentNode;
    }
    return false;
  }

  function walkTextNodes(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      // Reset lastIndex before test (global regex maintains state)
      REF_PATTERN.lastIndex = 0;
      if (!REF_PATTERN.test(text)) return;
      if (shouldSkip(node)) return;

      // Reset again before exec loop
      REF_PATTERN.lastIndex = 0;

      // Replace matches with span elements
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = REF_PATTERN.exec(text)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }

        const shortId = match[1].toLowerCase();
        const fullUuid = match[2]; // May be undefined for legacy format

        // Create span for the reference
        const span = document.createElement('span');
        span.className = 'cell-reference';
        span.setAttribute('data-id', shortId);
        if (fullUuid) {
          span.setAttribute('data-cell-id', fullUuid);
        }
        // Display text is always @block-{shortId} (hide the UUID suffix)
        span.textContent = `@block-${shortId}`;
        fragment.appendChild(span);

        lastIndex = match.index + match[0].length;
      }

      // Add remaining text
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      // Replace the text node with the fragment
      node.parentNode?.replaceChild(fragment, node);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Recurse into child nodes (copy to array since we may modify)
      const children = Array.from(node.childNodes);
      for (const child of children) {
        walkTextNodes(child);
      }
    }
  }

  walkTextNodes(tempDiv);
  return tempDiv.innerHTML;
}

/**
 * ATOMIC MODEL: Extract inline content from a ProseMirror document/node.
 * Flattens block structure, collecting only inline nodes (text, marks, hardBreak, images).
 * Multiple blocks are joined with hardBreak to preserve separation.
 *
 * TEMPORARY ADAPTER (09a): This is a stopgap to prevent schema violations when
 * markdown parsing returns block nodes. It collapses structure into inline runs
 * separated by hardBreaks. The proper 09b migration will split multi-block content
 * into multiple cells instead of cramming them into one cell.
 *
 * Visual preservation strategies:
 * - Headings: converted to bold text with line break after
 * - Lists: bullet marker (•) prepended to each item
 * - Paragraphs: separated by double line breaks for visual spacing
 * - Code blocks: preserved as-is with line breaks
 */
function extractInlineNodesFromDoc(parsedDoc: ProseMirrorNode): Record<string, unknown>[] {
  const inlineNodes: Record<string, unknown>[] = [];
  let blockCount = 0;

  function addHardBreak() {
    inlineNodes.push({ type: 'hardBreak' });
  }

  function addText(text: string, marks?: Record<string, unknown>[]) {
    const textJson: Record<string, unknown> = { type: 'text', text };
    if (marks && marks.length > 0) {
      textJson.marks = marks;
    }
    inlineNodes.push(textJson);
  }

  function extractInlineContent(node: ProseMirrorNode): void {
    if (node.isText) {
      // Text node - include with marks
      const textJson: Record<string, unknown> = { type: 'text', text: node.text };
      if (node.marks.length > 0) {
        textJson.marks = node.marks.map(m => m.toJSON());
      }
      inlineNodes.push(textJson);
    } else if (node.type.name === 'hardBreak') {
      addHardBreak();
    } else if (node.type.name === 'image') {
      inlineNodes.push({
        type: 'image',
        attrs: { src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title },
      });
    } else if (node.isInline) {
      // Other inline nodes (links, etc.) - serialize as-is
      inlineNodes.push(node.toJSON());
    } else if (node.isBlock) {
      // Block node - handle specially based on type
      node.content.forEach((child) => {
        extractInlineContent(child);
      });
    }
  }

  function processBlock(node: ProseMirrorNode): void {
    const typeName = node.type.name;

    // Add separator before non-first blocks
    if (blockCount > 0 && inlineNodes.length > 0) {
      addHardBreak();
      // Double break for paragraph separation (visual spacing)
      if (typeName === 'paragraph' || typeName === 'heading') {
        addHardBreak();
      }
    }
    blockCount++;

    // Handle different block types
    if (typeName === 'heading') {
      // Convert heading to bold text
      node.content.forEach((child) => {
        if (child.isText) {
          addText(child.text || '', [{ type: 'bold' }]);
        } else {
          extractInlineContent(child);
        }
      });
      addHardBreak();
    } else if (typeName === 'bulletList' || typeName === 'orderedList') {
      // Process list items with markers
      let itemIndex = 0;
      node.content.forEach((listItem) => {
        if (itemIndex > 0) {
          addHardBreak();
        }
        // Add bullet/number marker
        const marker = typeName === 'bulletList' ? '• ' : `${itemIndex + 1}. `;
        addText(marker);
        // Process list item content
        listItem.content.forEach((itemContent) => {
          if (itemContent.isBlock) {
            itemContent.content.forEach((child) => extractInlineContent(child));
          } else {
            extractInlineContent(itemContent);
          }
        });
        itemIndex++;
      });
    } else if (typeName === 'codeBlock') {
      // Preserve code block content with line breaks
      const code = node.textContent;
      const lines = code.split('\n');
      lines.forEach((line, i) => {
        if (i > 0) addHardBreak();
        addText(line, [{ type: 'code' }]);
      });
    } else if (typeName === 'blockquote') {
      // Add quote marker
      addText('> ');
      node.content.forEach((child) => {
        if (child.isBlock) {
          child.content.forEach((grandchild) => extractInlineContent(grandchild));
        } else {
          extractInlineContent(child);
        }
      });
    } else {
      // Default: extract inline content from block
      node.content.forEach((child) => {
        extractInlineContent(child);
      });
    }
  }

  // Process all top-level nodes
  parsedDoc.content.forEach((node) => {
    if (node.isBlock) {
      processBlock(node);
    } else {
      extractInlineContent(node);
    }
  });

  return inlineNodes;
}

/**
 * Option B (Atomic cells): Split markdown into multiple Notion-like cell blocks.
 *
 * We intentionally keep rich formatting within a cell limited to inline nodes + hardBreaks.
 * True block structure (headings, list items, code blocks) becomes separate cells with `kind` attrs.
 */
function normalizeMarkdownSoftBreaks(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n');
  // Split by fenced code blocks so we don't alter code indentation/newlines
  const parts = normalized.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part) => {
      if (part.startsWith('```')) return part;
      // Convert single newlines within paragraphs into markdown hardbreaks ("  \n")
      return part
        .split(/\n{2,}/)
        .map((p) => p.replace(/\n/g, '  \n'))
        .join('\n\n');
    })
    .join('');
}

type MarkdownBlockSpec =
  | { kind: 'heading'; headingLevel: number; indent: number; html: string }
  | { kind: 'paragraph'; indent: number; html: string }
  | { kind: 'bulleted'; indent: number; html: string }
  | { kind: 'numbered'; indent: number; html: string }
  | { kind: 'code'; indent: number; language?: string | null; codeText: string };

function extractInlineNodesFromFirstBlock(parsedDoc: ProseMirrorNode): Record<string, unknown>[] {
  // Prefer the first block node (paragraph/heading/listItem/etc.), otherwise traverse the doc directly
  const top = parsedDoc.content.firstChild;
  const start = top && top.isBlock ? top : parsedDoc;

  const inlineNodes: Record<string, unknown>[] = [];

  const walk = (node: ProseMirrorNode) => {
    if (node.isText) {
      const textJson: Record<string, unknown> = { type: 'text', text: node.text };
      if (node.marks.length > 0) {
        textJson.marks = node.marks.map((m) => m.toJSON());
      }
      inlineNodes.push(textJson);
      return;
    }
    if (node.type.name === 'hardBreak') {
      inlineNodes.push({ type: 'hardBreak' });
      return;
    }
    if (node.type.name === 'image') {
      inlineNodes.push({
        type: 'image',
        attrs: { src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title },
      });
      return;
    }
    if (node.isInline) {
      inlineNodes.push(node.toJSON());
      return;
    }
    // For block/container nodes, walk their children
    node.content.forEach((child) => walk(child));
  };

  start.content.forEach((child) => walk(child));
  return inlineNodes;
}

function buildInlineNodesFromHtml(editor: Editor, html: string): Record<string, unknown>[] {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  const parsedDoc = DOMParser.fromSchema(editor.schema).parse(tempDiv);
  return extractInlineNodesFromFirstBlock(parsedDoc);
}

function buildInlineNodesFromCodeText(codeText: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const lines = codeText.replace(/\r\n/g, '\n').split('\n');
  lines.forEach((line, idx) => {
    if (line.length > 0) nodes.push({ type: 'text', text: line });
    if (idx < lines.length - 1) nodes.push({ type: 'hardBreak' });
  });
  return nodes;
}

function markdownToBlockSpecs(editor: Editor, markdown: string): MarkdownBlockSpec[] {
  const markdownStorage = editor.storage.markdown as MarkdownStorage;
  const normalized = normalizeMarkdownSoftBreaks(markdown);
  let html = markdownStorage.parser.parse(normalized);
  html = convertBlockReferencesToSpans(html);
  const sanitizedHtml = DOMPurify.sanitize(html, SANITIZE_CONFIG);

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = sanitizedHtml;

  const specs: MarkdownBlockSpec[] = [];

  const processList = (listEl: Element, ordered: boolean, indent: number) => {
    const liEls = Array.from(listEl.children).filter((c) => (c as Element).tagName === 'LI') as Element[];
    for (const li of liEls) {
      // Extract current item content without nested lists
      const liClone = li.cloneNode(true) as Element;
      liClone.querySelectorAll('ul,ol').forEach((n) => n.remove());
      const itemHtml = (liClone as HTMLElement).innerHTML.trim();
      if (itemHtml) {
        specs.push({
          kind: ordered ? 'numbered' : 'bulleted',
          indent,
          html: itemHtml,
        });
      }

      // Recurse into nested lists (indent+1)
      const nestedLists = Array.from(li.children).filter((c) => {
        const t = (c as Element).tagName;
        return t === 'UL' || t === 'OL';
      }) as Element[];
      for (const nested of nestedLists) {
        processList(nested, (nested as Element).tagName === 'OL', indent + 1);
      }
    }
  };

  const children = Array.from(tempDiv.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim();
      if (text) {
        specs.push({ kind: 'paragraph', indent: 0, html: text });
      }
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const el = child as HTMLElement;
    const tag = el.tagName.toUpperCase();

    if (tag === 'P') {
      const pHtml = el.innerHTML.trim();
      if (pHtml) specs.push({ kind: 'paragraph', indent: 0, html: pHtml });
      continue;
    }

    if (tag === 'UL' || tag === 'OL') {
      processList(el, tag === 'OL', 0);
      continue;
    }

    if (tag === 'PRE') {
      const codeEl = el.querySelector('code');
      const codeText = (codeEl?.textContent ?? el.textContent ?? '').replace(/\s+$/, '');
      const className = codeEl?.getAttribute('class') ?? '';
      const langMatch = className.match(/language-([a-z0-9_-]+)/i);
      specs.push({
        kind: 'code',
        indent: 0,
        language: langMatch?.[1] ?? null,
        codeText,
      });
      continue;
    }

    if (tag === 'BLOCKQUOTE') {
      const bqHtml = el.innerHTML.trim();
      if (bqHtml) specs.push({ kind: 'paragraph', indent: 0, html: bqHtml });
      continue;
    }

    if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') {
      const level = parseInt(tag.slice(1), 10);
      const hHtml = el.innerHTML.trim();
      if (hHtml) specs.push({ kind: 'heading', headingLevel: level, indent: 0, html: hHtml });
      continue;
    }

    const fallbackHtml = el.innerHTML.trim() || (el.textContent ?? '').trim();
    if (fallbackHtml) {
      specs.push({ kind: 'paragraph', indent: 0, html: fallbackHtml });
    }
  }

  if (specs.length === 0) {
    const text = tempDiv.textContent?.trim() ?? '';
    specs.push({ kind: 'paragraph', indent: 0, html: text });
  }

  return specs;
}

/**
 * Custom document that contains cellBlocks instead of raw blocks.
 */
const CellDocument = Document.extend({
  content: 'cellBlock+',
});

interface UnifiedEditorProps {
  streamId: string;
  initialCells: CellType[];
  onCellsChange?: (cells: Partial<CellType>[]) => void;
  onTriggerAI?: (cellId: string, content: string) => void;
  /** Callback when editor API is ready (or null when unmounting) */
  onEditorReady?: (api: EditorAPI | null) => void;
  /** Callback when focused cell changes (for outline highlighting) */
  onSelectionChange?: (cellId: string | null) => void;
  /** Callback fired once after initial hydration with TipTap-extracted cells.
   * Use this to seed diff baselines with TipTap-serialized markdown. */
  onInitialHydrated?: (cells: Partial<CellType>[]) => void;
  /** Callback when user clicks info button on AI cell */
  onOpenOverlay?: (cellId: string) => void;
  /** Callback when user toggles live status */
  onToggleLive?: (cellId: string, isLive: boolean) => void;
}

/**
 * Convert Cell array to TipTap document JSON with placeholder content.
 * The actual markdown parsing happens after editor creation.
 * Cells are sorted by `order` to ensure consistent ordering.
 */
function cellsToDocumentStructure(cells: CellType[]): Record<string, unknown> {
  // If no cells, create one empty cell
  if (cells.length === 0) {
    return {
      type: 'doc',
      content: [
        {
          type: 'cellBlock',
          attrs: {
            id: crypto.randomUUID(),
            type: 'text',
            kind: 'paragraph',
            indent: 0,
          } satisfies CellBlockAttributes,
          content: [],
        },
      ],
    };
  }

  // Sort by order to ensure TipTap doc matches store/persistence order
  const sorted = [...cells].sort((a, b) => a.order - b.order);

  return {
    type: 'doc',
    content: sorted.map((cell) => ({
      type: 'cellBlock',
      attrs: {
        id: cell.id,
        type: cell.type,
        kind: cell.kind || 'paragraph',
        indent: cell.indent || 0,
        headingLevel: cell.headingLevel || null,
        checked: cell.checked ?? null,
        language: cell.language || null,
        imageUrl: cell.imageUrl || null,
        modelId: cell.modelId || null,
        originalPrompt: cell.originalPrompt || null,
        sourceApp: cell.sourceApp || null,
        isLive: cell.processingConfig?.refreshTrigger === 'onStreamOpen',
        isStreaming: false,
        blockName: cell.blockName || null,
      } satisfies CellBlockAttributes,
      // ATOMIC MODEL: content is inline nodes (empty for now, will be hydrated)
      content: [],
    })),
  };
}

/**
 * Parse content into a cell, replacing its placeholder content.
 *
 * ATOMIC MODEL: cellBlock.content = 'inline*', so we must extract only inline
 * nodes from the parsed HTML/markdown. Block structure (paragraphs, lists, etc.)
 * is discarded; the block kind is stored in attributes, not in content structure.
 *
 * @param editor - TipTap editor instance
 * @param cellPos - Position of the cellBlock in the document
 * @param cellNode - The cellBlock node (unused, kept for API compatibility)
 * @param content - Content to parse (markdown or HTML)
 * @param isMarkdown - If true, parse as markdown first; if false, parse as HTML directly
 */
function parseContentIntoCell(
  editor: Editor,
  cellPos: number,
  _cellNode: ProseMirrorNode,
  content: string,
  isMarkdown: boolean
): void {
  if (!content.trim()) return;

  let html: string;
  if (isMarkdown) {
    // Parse markdown to HTML using tiptap-markdown
    const markdownStorage = editor.storage.markdown as MarkdownStorage;
    html = markdownStorage.parser.parse(content);
  } else {
    // Use content directly as HTML
    html = content;
  }

  // Convert @block-xxx references to span elements BEFORE sanitizing
  // This allows BlockReference.parseHTML to recognize them
  html = convertBlockReferencesToSpans(html);

  // SECURITY: Sanitize HTML to prevent XSS from LLM output or stored content
  const sanitizedHtml = DOMPurify.sanitize(html, SANITIZE_CONFIG);

  // Create a DOM element from the sanitized HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = sanitizedHtml;

  // Parse the DOM into ProseMirror nodes (produces block nodes like paragraphs)
  let parsedDoc;
  try {
    parsedDoc = DOMParser.fromSchema(editor.schema).parse(tempDiv);
  } catch (error) {
    console.error('[parseContentIntoCell] Failed to parse content:', error);
    // Fall back to plain text
    const text = tempDiv.textContent || '';
    editor.chain()
      .insertContentAt(cellPos + 1, [{ type: 'text', text }], { updateSelection: false })
      .run();
    return;
  }

  // ATOMIC MODEL: Extract inline content from parsed block nodes
  const inlineNodes = extractInlineNodesFromDoc(parsedDoc);

  // Replace the cell's content with extracted inline nodes
  // ATOMIC MODEL: cellBlock directly contains inline content
  const cellContentStart = cellPos + 1;
  const cellContentEnd = cellPos + editor.state.doc.nodeAt(cellPos)!.nodeSize - 1;

  // Always delete existing content first (handles clearing when no new content)
  // Then insert new content if any
  const chain = editor.chain().deleteRange({ from: cellContentStart, to: cellContentEnd });
  if (inlineNodes.length > 0) {
    chain.insertContentAt(cellContentStart, inlineNodes, { updateSelection: false });
  }
  chain.run();
}

/**
 * Hydrate cells in the document with their markdown/HTML content.
 * This replaces placeholder content with properly parsed rich text.
 * @param editor - TipTap editor instance
 * @param cells - Array of cells with content to hydrate
 */
function hydrateCellContent(editor: Editor, cells: CellType[]): void {
  if (cells.length === 0) return;

  // Build maps of cell ID to content
  const markdownMap = new Map<string, string>();
  const htmlFallbackMap = new Map<string, string>();

  cells.forEach((cell) => {
    if (cell.rawMarkdown?.trim()) {
      markdownMap.set(cell.id, cell.rawMarkdown);
    } else if (cell.content?.trim()) {
      // Legacy cell with HTML but no rawMarkdown
      htmlFallbackMap.set(cell.id, cell.content);
    }
  });

  // Collect cell info, then process in REVERSE order
  // This ensures position changes from earlier edits don't affect later cells
  const cellsToProcess: Array<{ pos: number; node: ProseMirrorNode; markdown?: string; html?: string }> = [];
  editor.state.doc.forEach((node, pos) => {
    if (node.type.name === 'cellBlock') {
      const cellId = node.attrs.id;
      const markdown = markdownMap.get(cellId);
      const html = htmlFallbackMap.get(cellId);
      if (markdown) {
        cellsToProcess.push({ pos, node, markdown });
      } else if (html) {
        cellsToProcess.push({ pos, node, html });
      }
    }
  });

  // Process in reverse order so position shifts don't affect earlier cells
  for (let i = cellsToProcess.length - 1; i >= 0; i--) {
    const { pos, node, markdown, html } = cellsToProcess[i];
    if (markdown) {
      parseContentIntoCell(editor, pos, node, markdown, true);
    } else if (html) {
      parseContentIntoCell(editor, pos, node, html, false);
    }
  }
}

/**
 * Extract cells from TipTap editor using tiptap-markdown serializer.
 * Also exports HTML directly from TipTap to avoid markdown parser divergence.
 */
function documentToCellsWithEditor(editor: Editor): Partial<CellType>[] {
  const markdownStorage = editor.storage.markdown as MarkdownStorage;
  const cells: Partial<CellType>[] = [];

  editor.state.doc.forEach((node, _offset, index) => {
    if (node.type.name === 'cellBlock') {
      const attrs = node.attrs as CellBlockAttributes;
      // Serialize the cell's content to markdown
      const rawMarkdown = markdownStorage.serializer.serialize(node.content);

      // Also serialize to HTML directly from TipTap to avoid markdown parser divergence
      // This ensures what's displayed in editor matches what's persisted
      const tempDiv = document.createElement('div');
      const fragment = DOMSerializer.fromSchema(editor.schema).serializeFragment(node.content);
      tempDiv.appendChild(fragment);
      const content = DOMPurify.sanitize(tempDiv.innerHTML, SANITIZE_CONFIG);

      cells.push({
        id: attrs?.id || crypto.randomUUID(),
        type: attrs?.type || 'text',
        // ATOMIC MODEL (09a): Include kind and related attrs for round-trip
        kind: attrs?.kind || 'paragraph',
        indent: attrs?.indent || 0,
        headingLevel: attrs?.headingLevel || undefined,
        checked: attrs?.checked ?? undefined,
        language: attrs?.language || undefined,
        imageUrl: attrs?.imageUrl || undefined,
        // Legacy attrs
        modelId: attrs?.modelId || undefined,
        originalPrompt: attrs?.originalPrompt || undefined,
        sourceApp: attrs?.sourceApp || undefined,
        blockName: attrs?.blockName || undefined,
        order: index,
        rawMarkdown,
        content, // HTML from TipTap directly
      });
    }
  });

  return cells;
}

/**
 * UnifiedEditor - Single TipTap editor for entire stream.
 *
 * The document is structured as a series of cellBlock nodes,
 * each containing the content of one cell.
 */
export function UnifiedEditor({
  streamId,
  initialCells,
  onCellsChange,
  onTriggerAI,
  onEditorReady,
  onSelectionChange,
  onInitialHydrated,
  onOpenOverlay,
  onToggleLive,
}: UnifiedEditorProps) {
  const isInitialLoad = useRef(true);

  // Track the last serialized content we pushed during streaming per cell.
  // Used to detect user edits during streaming and avoid clobbering them.
  const lastStreamedMarkdown = useRef<Map<string, string>>(new Map());

  // Track the last synced cell fingerprint to avoid unnecessary reconciliation
  // This prevents rebuilds when parent re-renders with identical cell data
  const lastSyncedFingerprint = useRef<string>('');

  // Store initial cells ref for parsing after editor creation
  const initialCellsRef = useRef(initialCells);
  initialCellsRef.current = initialCells;

  // REF PATTERN: Store callbacks in refs so CellKeymap always calls the latest version
  // This fixes stale closure issues where editorAPI was null at editor creation time
  const onTriggerAIRef = useRef(onTriggerAI);
  onTriggerAIRef.current = onTriggerAI;
  const onOpenOverlayRef = useRef(onOpenOverlay);
  onOpenOverlayRef.current = onOpenOverlay;
  const onToggleLiveRef = useRef(onToggleLive);
  onToggleLiveRef.current = onToggleLive;

  const editor = useEditor({
    extensions: [
      CellDocument,
      StarterKit.configure({
        document: false, // We use our custom document
      }),
      CellBlock.configure({
        // Use wrapper functions that call through refs to get latest callbacks
        onOpenOverlay: (cellId: string) => onOpenOverlayRef.current?.(cellId),
        onToggleLive: (cellId: string, isLive: boolean) => onToggleLiveRef.current?.(cellId, isLive),
      }),
      CellKeymap.configure({
        // Use wrapper function that calls through ref to get latest callback
        // This fixes stale closure where editorAPI was null at creation time
        onTriggerAI: (cellId: string, content: string) => onTriggerAIRef.current?.(cellId, content),
      }),
      Placeholder.configure({
        placeholder: ({ node }: { node: ProseMirrorNode }): string => {
          // ATOMIC MODEL: cellBlock is the textblock now (content: 'inline*')
          // Show placeholder when cellBlock is empty
          if (node.type.name === 'cellBlock') {
            return 'Write your thoughts...';
          }
          return '';
        },
        showOnlyWhenEditable: true,
        showOnlyCurrent: true, // Only show on focused/empty node
        // ATOMIC MODEL: Target cellBlock which is now the textblock
        includeChildren: false,
      }),
      Image,
      Link.configure({
        openOnClick: false, // Don't navigate on click in editor
        autolink: true, // Auto-detect URLs while typing
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      Markdown.configure({
        html: true, // Allow HTML in markdown (sanitized via DOMPurify before hydration)
        transformPastedText: true,
        transformCopiedText: true,
        breaks: true, // Convert single \n to <br> (important for AI streaming output)
      }),
      // Block reference mentions (@block-xxx)
      BlockReference.configure({
        suggestion: createBlockReferenceSuggestion(),
      }),
    ],
    content: cellsToDocumentStructure(initialCells),
    editorProps: {
      attributes: {
        class: 'unified-editor-content',
      },
    },
    onCreate: ({ editor }) => {
      // Parse markdown content for each cell after editor creation
      hydrateCellContent(editor, initialCellsRef.current);
    },
    onUpdate: ({ editor, transaction }) => {
      // Skip initial load updates
      if (isInitialLoad.current) {
        isInitialLoad.current = false;
        return;
      }

      // Skip transactions that don't change the document
      // (e.g., selection-only changes, focus changes)
      // This is much faster than JSON.stringify comparison
      if (!transaction.docChanged) return;

      // Extract cells using tiptap-markdown serializer (preserves marks)
      const cells = documentToCellsWithEditor(editor);
      onCellsChange?.(cells);
    },
  });


  // Update editor when stream changes (e.g., new stream loaded)
  // Always reset content on stream switch, even for empty streams
  useEffect(() => {
    if (editor) {
      // Sort cells for consistent ordering
      const sortedCells = [...initialCells].sort((a, b) => a.order - b.order);

      // Create document structure with placeholder content
      const newContent = cellsToDocumentStructure(sortedCells);
      isInitialLoad.current = true;
      editor.commands.setContent(newContent);

      // Hydrate cells with their markdown/HTML content
      hydrateCellContent(editor, sortedCells);

      // Reset fingerprint for new stream (using sorted order)
      lastSyncedFingerprint.current = sortedCells.map(c => c.id).join('|');

      // Notify parent with TipTap-extracted cells for baseline seeding
      // This ensures diff baselines use the same markdown serialization as saves
      if (onInitialHydrated) {
        const hydratedCells = documentToCellsWithEditor(editor);
        onInitialHydrated(hydratedCells);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, streamId]); // Only re-run when streamId changes, not on every initialCells update

  // Full sync of external changes (add, update, reorder, delete)
  // This reconciles TipTap state with initialCells when they change
  useEffect(() => {
    if (!editor) return;

    // Sort cells by order to ensure consistent processing
    const sortedCells = [...initialCells].sort((a, b) => a.order - b.order);

    // Create a fingerprint from cell IDs in sorted order to detect actual changes
    // This prevents unnecessary reconciliation when parent re-renders with identical data
    const incomingFingerprint = sortedCells.map(c => c.id).join('|');
    if (incomingFingerprint === lastSyncedFingerprint.current) {
      // No structural change - skip reconciliation to preserve selection/undo
      return;
    }

    // Build map of current editor cells: id -> { pos, node, index }
    const editorCells = new Map<string, { pos: number; node: ProseMirrorNode; index: number }>();
    let editorIndex = 0;
    editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
      if (node.type.name === 'cellBlock' && node.attrs.id) {
        editorCells.set(node.attrs.id, { pos, node, index: editorIndex++ });
      }
      return true; // Continue to get all cellBlocks
    });

    // Build map of incoming cells: id -> { cell, index }
    const incomingCells = new Map<string, { cell: CellType; index: number }>();
    sortedCells.forEach((cell, index) => {
      incomingCells.set(cell.id, { cell, index });
    });

    // Determine what changed
    const toAdd: Array<{ cell: CellType; targetIndex: number }> = [];
    const toRemove: string[] = [];
    let needsReorder = false;

    // Find cells to add (in incoming but not in editor)
    for (const [id, { cell, index }] of incomingCells) {
      if (!editorCells.has(id)) {
        toAdd.push({ cell, targetIndex: index });
      } else {
        // Check if order changed
        const editorCell = editorCells.get(id)!;
        if (editorCell.index !== index) {
          needsReorder = true;
        }
      }
    }

    // Find cells to remove (in editor but not in incoming)
    for (const id of editorCells.keys()) {
      if (!incomingCells.has(id)) {
        toRemove.push(id);
      }
    }

    // Skip if no changes needed
    if (toAdd.length === 0 && toRemove.length === 0 && !needsReorder) {
      // Update fingerprint even though no changes - the fingerprint represents what we've processed
      lastSyncedFingerprint.current = incomingFingerprint;
      return;
    }

    console.log('[UnifiedEditor] Syncing external changes:', {
      add: toAdd.length,
      remove: toRemove.length,
      reorder: needsReorder
    });

    // If we need to reorder or have complex changes, rebuild the document
    // This is simpler and more reliable than trying to move nodes
    if (needsReorder || toRemove.length > 0) {
      // Full rebuild - set content to match initialCells order
      const newContent = cellsToDocumentStructure(initialCells);
      isInitialLoad.current = true;
      editor.commands.setContent(newContent);
      hydrateCellContent(editor, initialCells);
      lastSyncedFingerprint.current = incomingFingerprint;
      return;
    }

    // Simple case: only additions, insert at correct positions
    // Sort by target index to insert in order
    toAdd.sort((a, b) => a.targetIndex - b.targetIndex);

    for (const { cell, targetIndex } of toAdd) {
      // Find the insertion position based on target index
      let insertPos = 0;
      let currentIndex = 0;

      editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
        if (node.type.name === 'cellBlock') {
          if (currentIndex === targetIndex) {
            // Insert before this cell
            insertPos = pos;
            return false;
          }
          currentIndex++;
          // Track end position in case we need to append
          insertPos = pos + node.nodeSize;
        }
        return true;
      });

      // Create and insert the cell
      const cellContent = cellsToDocumentStructure([cell]).content as Record<string, unknown>[];
      const cellNode = cellContent[0];

      editor.chain()
        .insertContentAt(insertPos, cellNode, { updateSelection: false })
        .run();

      // Hydrate the newly inserted cell
      editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
        if (node.type.name === 'cellBlock' && node.attrs.id === cell.id) {
          if (cell.rawMarkdown?.trim()) {
            parseContentIntoCell(editor, pos, node, cell.rawMarkdown, true);
          } else if (cell.content?.trim()) {
            parseContentIntoCell(editor, pos, node, cell.content, false);
          }
          return false;
        }
        return true;
      });
    }

    // Update fingerprint after successful sync
    lastSyncedFingerprint.current = incomingFingerprint;
  }, [editor, initialCells]); // Run when initialCells changes

  // Expose editor methods for AI streaming via callback
  useEffect(() => {
    if (!editor) {
      onEditorReady?.(null);
      return;
    }

    // Create the editor API object
    const editorAPI: EditorAPI = {
      // Unified method for replacing cell content with markdown
      replaceCellWithMarkdown: (cellId: string, markdown: string, options = {}) => {
        const { addToHistory = false, skipUserEditCheck = false, forceStreaming = false } = options;
        const markdownStorage = editor.storage.markdown as MarkdownStorage;

        // Find the target cell
        let targetPos: number | null = null;
        let targetNode: ProseMirrorNode | null = null;

        editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
          if (node.type.name === 'cellBlock' && node.attrs.id === cellId) {
            targetPos = pos;
            targetNode = node;
            return false;
          }
          return true;
        });

        if (targetPos === null || targetNode === null) {
          console.warn('[replaceCellWithMarkdown] Cell not found in TipTap:', cellId);
          return;
        }

        const node = targetNode as ProseMirrorNode;
        const nodeAttrs = node.attrs as CellBlockAttributes;

        // User edit protection (for streaming - skip for final content)
        if (!skipUserEditCheck) {
          // Only update if cell is marked as streaming (unless forceStreaming is true).
          // forceStreaming bypasses the TipTap attribute check when the store's streaming
          // state is authoritative (e.g., after reconciliation resets the attribute).
          if (!nodeAttrs.isStreaming && !forceStreaming) {
            console.log('[replaceCellWithMarkdown] Ignoring - cell not streaming:', cellId);
            return;
          }
          // User edit detection: if the user changed the cell since the last streamed write,
          // stop applying streamed updates to avoid clobbering their edits.
          const currentSerialized = markdownStorage.serializer.serialize(node.content);
          const lastSerialized = lastStreamedMarkdown.current.get(cellId);
          if (lastSerialized !== undefined && currentSerialized !== lastSerialized) {
            console.log('[replaceCellWithMarkdown] Skipping - user edited during streaming:', cellId);
            return;
          }
        }

        // ATOMIC MODEL: Parse markdown and extract inline content only
        let contentToInsert: Record<string, unknown>[];
        if (markdown.trim()) {
          try {
            const html = markdownStorage.parser.parse(markdown);
            const sanitizedHtml = DOMPurify.sanitize(html, SANITIZE_CONFIG);

            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = sanitizedHtml;
            const parsedDoc = DOMParser.fromSchema(editor.schema).parse(tempDiv);
            // ATOMIC MODEL: Extract inline nodes only, discard block structure
            contentToInsert = extractInlineNodesFromDoc(parsedDoc);
          } catch (error) {
            console.error('[replaceCellWithMarkdown] Parse failed:', error);
            // Fall back to plain text (inline)
            contentToInsert = [{ type: 'text', text: markdown }];
          }
        } else {
          // ATOMIC MODEL: Empty content = empty array (not paragraph)
          contentToInsert = [];
        }

        // Replace cell content
        // ATOMIC MODEL: cellBlock directly contains inline content
        editor
          .chain()
          .deleteRange({
            from: targetPos + 1,
            to: targetPos + node.nodeSize - 1,
          })
          .insertContentAt(targetPos + 1, contentToInsert, {
            updateSelection: false,
            // @ts-expect-error - addToHistory is valid but not in types
            addToHistory,
          })
          .run();

        // Track the last streamed state (serialized) to detect user edits during streaming.
        if (!skipUserEditCheck) {
          let serialized: string | undefined;
          editor.state.doc.descendants((n: ProseMirrorNode) => {
            if (n.type.name === 'cellBlock' && n.attrs.id === cellId) {
              serialized = markdownStorage.serializer.serialize(n.content);
              return false;
            }
            return true;
          });
          if (serialized !== undefined) {
            lastStreamedMarkdown.current.set(cellId, serialized);
          }
        }
      },

      // @deprecated - use replaceCellWithMarkdown
      appendToCell: (cellId: string, accumulatedText: string) => {
        editorAPI.replaceCellWithMarkdown(cellId, accumulatedText, {
          addToHistory: false,
          origin: 'ai',
          skipUserEditCheck: false, // Enable protection during streaming
        });
      },

      // @deprecated - use replaceCellWithMarkdown
      setCellContent: (cellId: string, content: string) => {
        editorAPI.replaceCellWithMarkdown(cellId, content, {
          addToHistory: true, // Final content should be in undo stack
          origin: 'ai',
          skipUserEditCheck: true, // Skip protection for final content
        });
      },

      setCellStreaming: (cellId: string, isStreaming: boolean) => {
        editor.commands.setCellBlockAttributes(cellId, { isStreaming });
        if (!isStreaming) {
          lastStreamedMarkdown.current.delete(cellId);
        }
      },

      getCellContent: (cellId: string): { html: string; rawMarkdown: string } | null => {
        const markdownStorage = editor.storage.markdown as MarkdownStorage;
        let result: { html: string; rawMarkdown: string } | null = null;
        editor.state.doc.descendants((node: ProseMirrorNode) => {
          if (node.type.name === 'cellBlock' && node.attrs.id === cellId) {
            // Serialize to markdown
            const rawMarkdown = markdownStorage.serializer.serialize(node.content);
            // Serialize to HTML via DOMSerializer (same as documentToCellsWithEditor)
            const tempDiv = document.createElement('div');
            const fragment = DOMSerializer.fromSchema(editor.schema).serializeFragment(node.content);
            tempDiv.appendChild(fragment);
            const html = DOMPurify.sanitize(tempDiv.innerHTML, SANITIZE_CONFIG);
            result = { html, rawMarkdown };
            return false;
          }
          return true;
        });
        return result;
      },

      replaceStreamingCellWithMarkdownCells: (
        cellId: string,
        markdown: string,
        attrs: Partial<CellBlockAttributes> = {},
        options: { forceStreaming?: boolean } = {}
      ) => {
        const { forceStreaming = false } = options;
        // Find the target cell
        let targetPos: number | null = null;
        let targetNode: ProseMirrorNode | null = null;
        editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
          if (node.type.name === 'cellBlock' && node.attrs.id === cellId) {
            targetPos = pos;
            targetNode = node;
            return false;
          }
          return true;
        });

        if (targetPos === null || targetNode === null) {
          console.warn('[replaceStreamingCellWithMarkdownCells] Cell not found:', cellId);
          return { applied: false, newCellIds: [] };
        }

        const node = targetNode as ProseMirrorNode;
        const nodeAttrs = node.attrs as CellBlockAttributes;
        const markdownStorage = editor.storage.markdown as MarkdownStorage;

        // Safety: only split if this is still a streaming cell (unless forceStreaming).
        // forceStreaming bypasses the TipTap attribute check when the store's streaming
        // state was recently active (reconciliation might have reset the attribute).
        if (!nodeAttrs.isStreaming && !forceStreaming) {
          console.warn('[replaceStreamingCellWithMarkdownCells] Cell not streaming, refusing to split:', cellId);
          return { applied: false, newCellIds: [] };
        }

        // Respect user edits during streaming if we have a last-streamed baseline
        const currentMarkdown = markdownStorage.serializer.serialize(node.content);
        const lastStreamed = lastStreamedMarkdown.current.get(cellId);
        if (lastStreamed !== undefined && currentMarkdown !== lastStreamed) {
          console.log('[replaceStreamingCellWithMarkdownCells] Skipping - user edited during streaming:', cellId);
          return { applied: false, newCellIds: [] };
        }

        const specs = markdownToBlockSpecs(editor, markdown);

        const newCellIds: string[] = [];
        const cellNodesJson: Array<Record<string, unknown>> = [];

        specs.forEach((spec, idx) => {
          const id = idx === 0 ? cellId : crypto.randomUUID();
          if (idx !== 0) newCellIds.push(id);

          let kind: CellBlockAttributes['kind'] = 'paragraph';
          let headingLevel: number | null = null;
          let indent = spec.indent ?? 0;
          let language: string | null = null;
          let contentNodes: Record<string, unknown>[] = [];

          if (spec.kind === 'heading') {
            kind = 'heading';
            headingLevel = spec.headingLevel;
            contentNodes = buildInlineNodesFromHtml(editor, spec.html);
          } else if (spec.kind === 'paragraph') {
            kind = 'paragraph';
            contentNodes = buildInlineNodesFromHtml(editor, spec.html);
          } else if (spec.kind === 'bulleted') {
            kind = 'bulleted';
            contentNodes = buildInlineNodesFromHtml(editor, spec.html);
          } else if (spec.kind === 'numbered') {
            kind = 'numbered';
            contentNodes = buildInlineNodesFromHtml(editor, spec.html);
          } else if (spec.kind === 'code') {
            kind = 'code';
            language = spec.language ?? null;
            contentNodes = buildInlineNodesFromCodeText(spec.codeText);
          }

          // Base attrs: keep existing metadata, override kind-related attrs
          const base: Partial<CellBlockAttributes> = {
            ...nodeAttrs,
            ...attrs,
            id,
            isStreaming: false,
          };

          const finalAttrs: Record<string, unknown> = {
            id: base.id,
            type: base.type ?? 'aiResponse',
            kind,
            indent,
            headingLevel: kind === 'heading' ? headingLevel : null,
            checked: null, // todo kind not supported in AI responses yet
            language: kind === 'code' ? (language ?? (base.language ?? null)) : null,
            imageUrl: null, // image kind not supported in AI responses yet
            modelId: base.modelId ?? null,
            // Only the first cell should carry prompt metadata/UI affordances
            originalPrompt: idx === 0 ? (base.originalPrompt ?? null) : null,
            sourceApp: base.sourceApp ?? null,
            isLive: base.isLive ?? false,
            isStreaming: false,
            blockName: base.blockName ?? null,
          };

          cellNodesJson.push({
            type: 'cellBlock',
            attrs: finalAttrs,
            content: contentNodes,
          });
        });

        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            const from = targetPos!;
            const to = targetPos! + node.nodeSize;
            tr.delete(from, to);
            const pmNodes = cellNodesJson.map((j) => editor.schema.nodeFromJSON(j as any));
            tr.insert(from, Fragment.fromArray(pmNodes));
            tr.setSelection(TextSelection.create(tr.doc, from + 1));
            return true;
          })
          .run();

        // Clear baseline for this cell to prevent false positives later
        lastStreamedMarkdown.current.delete(cellId);

        // NOTE: We intentionally do NOT update lastSyncedFingerprint here.
        // The fingerprint compares incoming store data vs what we last synced.
        // If we update it to include new cells B, C but the store only has A,
        // reconciliation sees a mismatch and removes B, C!
        // Instead, we leave fingerprint unchanged so it still matches the store.
        // When the debounced save updates the store with B, C, reconciliation
        // will run and correctly see no changes needed (cells already in TipTap).

        return { applied: true, newCellIds };
      },

      deleteAiContinuationCells: (rootCellId: string) => {
        // Collect all top-level cellBlocks in order
        const cells: Array<{ id: string; pos: number; nodeSize: number; attrs: CellBlockAttributes }> = [];
        editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
          if (node.type.name === 'cellBlock') {
            cells.push({
              id: node.attrs.id as string,
              pos,
              nodeSize: node.nodeSize,
              attrs: node.attrs as CellBlockAttributes,
            });
          }
          return true;
        });

        const rootIdx = cells.findIndex((c) => c.id === rootCellId);
        if (rootIdx === -1) return [];

        // Compute consecutive continuation cells
        const continuation: Array<{ id: string; pos: number; nodeSize: number }> = [];
        for (let i = rootIdx + 1; i < cells.length; i++) {
          const c = cells[i];
          const isAi = c.attrs.type === 'aiResponse';
          const isRoot = !!c.attrs.originalPrompt;
          if (!isAi) break;
          if (isRoot) break;
          continuation.push({ id: c.id, pos: c.pos, nodeSize: c.nodeSize });
        }

        if (continuation.length === 0) return [];

        // Delete from bottom-up so positions stay valid
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            for (let i = continuation.length - 1; i >= 0; i--) {
              const c = continuation[i];
              tr.delete(c.pos, c.pos + c.nodeSize);
            }
            // Keep selection on the root cell
            const root = cells[rootIdx];
            tr.setSelection(TextSelection.create(tr.doc, root.pos + 1));
            return true;
          })
          .run();

        // NOTE: We intentionally do NOT update lastSyncedFingerprint here.
        // The fingerprint should reflect what we last synced with the store.
        // If we update it after deletion, reconciliation would see a mismatch
        // (store has A|B|C but fingerprint is A) and try to add B, C back.
        // Instead, we leave fingerprint unchanged. Since the store didn't change,
        // reconciliation won't run until aiComplete updates the store.
        // At that point, the split creates new cells and the debounced save
        // updates the store correctly.

        return continuation.map((c) => c.id);
      },

      createCellAfter: (afterCellId: string, attrs: Partial<CellBlockAttributes>) => {
        let insertPos: number | null = null;

        editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
          if (node.type.name === 'cellBlock' && node.attrs.id === afterCellId) {
            insertPos = pos + node.nodeSize;
            return false;
          }
          return true;
        });

        if (insertPos !== null) {
          // ATOMIC MODEL: cellBlock with empty inline content (no paragraph wrapper)
          editor.chain()
            .insertContentAt(insertPos, {
              type: 'cellBlock',
              attrs: {
                id: attrs.id || crypto.randomUUID(),
                kind: 'paragraph',
                indent: 0,
                ...attrs,
              },
              content: [], // Empty inline content
            })
            .run();
        }
      },

      insertCellAtEnd: (attrs: Partial<CellBlockAttributes>, content: string) => {
        let lastCellEnd = editor.state.doc.content.size;

        editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
          if (node.type.name === 'cellBlock') {
            lastCellEnd = pos + node.nodeSize;
          }
          return true;
        });

        // ATOMIC MODEL: Parse markdown and extract inline content
        let contentNodes: Record<string, unknown>[];
        if (content.trim()) {
          const markdownStorage = editor.storage.markdown as MarkdownStorage;
          const html = markdownStorage.parser.parse(content);

          // SECURITY: Sanitize to prevent XSS
          const sanitizedHtml = DOMPurify.sanitize(html, SANITIZE_CONFIG);
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = sanitizedHtml;

          try {
            const parsedDoc = DOMParser.fromSchema(editor.schema).parse(tempDiv);
            // ATOMIC MODEL: Extract inline nodes only
            contentNodes = extractInlineNodesFromDoc(parsedDoc);
          } catch (error) {
            console.error('[insertCellAtEnd] Failed to parse:', error);
            // Fall back to plain text inline
            contentNodes = [{ type: 'text', text: tempDiv.textContent || '' }];
          }
        } else {
          // ATOMIC MODEL: Empty inline content
          contentNodes = [];
        }

        editor.chain()
          .insertContentAt(lastCellEnd, {
            type: 'cellBlock',
            attrs: {
              id: attrs.id || crypto.randomUUID(),
              kind: 'paragraph',
              indent: 0,
              ...attrs,
            },
            content: contentNodes,
          })
          .run();
      },

      insertCellsAfter: (afterCellId: string | null, cells: InsertableCellData[]) => {
        if (cells.length === 0) return;

        // Find insertion position (default to start of doc content)
        let insertPos = 0;

        if (afterCellId === null) {
          // Insert at start of document content
          insertPos = 0;
        } else {
          // Find the cell and insert after it
          let found = false;
          editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
            if (node.type.name === 'cellBlock' && node.attrs.id === afterCellId) {
              insertPos = pos + node.nodeSize;
              found = true;
              return false;
            }
            return true;
          });

          if (!found) {
            console.warn('[insertCellsAfter] Cell not found:', afterCellId);
            // Fall back to inserting at end
            insertPos = editor.state.doc.content.size;
          }
        }

        // ATOMIC MODEL: Parse content for each cell and extract inline nodes
        const markdownStorage = editor.storage.markdown as MarkdownStorage;
        const cellNodes: Record<string, unknown>[] = [];

        for (const cell of cells) {
          let contentNodes: Record<string, unknown>[];

          // Prefer rawMarkdown, fall back to HTML
          const content = cell.rawMarkdown?.trim() || cell.html?.trim() || '';

          if (content) {
            let html: string;
            if (cell.rawMarkdown?.trim()) {
              // Parse markdown to HTML via tiptap-markdown
              html = markdownStorage.parser.parse(cell.rawMarkdown);
            } else {
              // Use HTML directly
              html = cell.html || '';
            }

            // SECURITY: Sanitize to prevent XSS
            const sanitizedHtml = DOMPurify.sanitize(html, SANITIZE_CONFIG);
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = sanitizedHtml;

            try {
              const parsedDoc = DOMParser.fromSchema(editor.schema).parse(tempDiv);
              // ATOMIC MODEL: Extract inline nodes only
              contentNodes = extractInlineNodesFromDoc(parsedDoc);
            } catch (error) {
              console.error('[insertCellsAfter] Failed to parse content:', error);
              // Fall back to plain text inline
              contentNodes = [{ type: 'text', text: tempDiv.textContent || '' }];
            }
          } else {
            // ATOMIC MODEL: Empty inline content
            contentNodes = [];
          }

          cellNodes.push({
            type: 'cellBlock',
            attrs: {
              kind: 'paragraph',
              indent: 0,
              ...cell.attrs,
              id: cell.attrs.id ?? crypto.randomUUID(),
            },
            content: contentNodes,
          });
        }

        // Insert all cells at once
        editor.chain()
          .insertContentAt(insertPos, cellNodes)
          .run();
      },

      setCellBlockAttributes: (cellId: string, attrs: Partial<CellBlockAttributes>) => {
        editor.commands.setCellBlockAttributes(cellId, attrs);
      },

      insertImageInCell: (cellId: string, imageUrl: string) => {
        let targetPos: number | null = null;
        let targetNode: ProseMirrorNode | null = null;

        editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
          if (node.type.name === 'cellBlock' && node.attrs.id === cellId) {
            targetPos = pos;
            targetNode = node;
            return false;
          }
          return true;
        });

        if (targetPos !== null && targetNode !== null) {
          // Insert at end of cell content (before the closing node boundary)
          const insertAt = targetPos + (targetNode as ProseMirrorNode).nodeSize - 1;
          editor.chain()
            .insertContentAt(insertAt, {
              type: 'image',
              attrs: { src: imageUrl },
            })
            .run();
        }
      },
    };

    // Notify parent that API is ready
    onEditorReady?.(editorAPI);

    return () => {
      onEditorReady?.(null);
    };
  }, [editor, onEditorReady]);

  // Track selection changes to report focused cell (for outline highlighting)
  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      // Find which cellBlock contains the cursor
      const { $anchor } = editor.state.selection;
      let cellId: string | null = null;

      for (let d = $anchor.depth; d >= 0; d--) {
        const node = $anchor.node(d);
        if (node.type.name === 'cellBlock') {
          cellId = node.attrs.id;
          break;
        }
      }

      onSelectionChange?.(cellId);
    };

    editor.on('selectionUpdate', handleSelectionUpdate);
    // Call once to set initial state
    handleSelectionUpdate();

    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
    };
  }, [editor, onSelectionChange]);

  // Handle drag over for drop indicator
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-cell-block-id')) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  // Handle drop to reorder cells
  // Uses cell ID (not stale position) to find current node location,
  // so reorder works even if doc changed during drag (AI streaming, refresh)
  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!editor) return;

    const draggedId = e.dataTransfer.getData('application/x-cell-block-id');
    if (!draggedId) return;

    e.preventDefault();

    // Find the CURRENT position of the dragged cell by ID
    // (position from drag start may be stale if doc changed during drag)
    let draggedPos: number | null = null;
    let draggedNode: ProseMirrorNode | null = null;

    editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
      if (node.type.name === 'cellBlock' && node.attrs.id === draggedId) {
        draggedPos = pos;
        draggedNode = node;
        return false; // Stop traversal
      }
      return true;
    });

    if (draggedPos === null || draggedNode === null) {
      console.warn('[handleDrop] Dragged cell not found:', draggedId);
      return;
    }

    // Find the target position based on drop location
    const dropY = e.clientY;
    let targetPos: number | null = null;

    // Find which cell we're dropping on/near
    editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
      if (node.type.name === 'cellBlock') {
        const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
        if (dom) {
          const rect = dom.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;

          if (dropY < midY && targetPos === null) {
            // Drop before this cell
            targetPos = pos;
          } else if (dropY >= midY) {
            // Potentially drop after this cell
            targetPos = pos + node.nodeSize;
          }
        }
      }
      return true;
    });

    if (targetPos === null) return;

    // Don't move to same position
    if (targetPos === draggedPos || targetPos === draggedPos + (draggedNode as ProseMirrorNode).nodeSize) return;

    // Perform the move using a transaction
    const { tr } = editor.state;
    const nodeSize = (draggedNode as ProseMirrorNode).nodeSize;

    // If moving down, we need to adjust target position after deletion
    const adjustedTarget = targetPos > draggedPos
      ? targetPos - nodeSize
      : targetPos;

    // Delete from original position
    tr.delete(draggedPos, draggedPos + nodeSize);

    // Insert at new position
    tr.insert(adjustedTarget, draggedNode as ProseMirrorNode);

    editor.view.dispatch(tr);
  }, [editor]);

  if (!editor) {
    return <div className="unified-editor unified-editor--loading">Loading editor...</div>;
  }

  return (
    <div
      className="unified-editor"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <EditorContent editor={editor} />
    </div>
  );
}

export default UnifiedEditor;
