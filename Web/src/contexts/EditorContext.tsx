import { createContext, useContext } from 'react';
import { CellBlockAttributes } from '../extensions/CellBlock';

/**
 * API for interacting with the unified editor from outside components.
 * Used by AI streaming hooks to insert content into specific cells.
 */
/** Cell data for insertion (supports both markdown and HTML) */
export interface InsertableCellData {
  attrs: Partial<CellBlockAttributes>;
  /** Preferred: markdown content (parsed via tiptap-markdown) */
  rawMarkdown?: string;
  /** Fallback: HTML content (sanitized, parsed to PM nodes) */
  html?: string;
}

/** Options for programmatic cell content replacement */
export interface ReplaceCellOptions {
  /** Whether to add to undo history (default: false for programmatic edits) */
  addToHistory?: boolean;
  /** Origin of the edit for debugging/tracking */
  origin?: 'ai' | 'refresh' | 'user';
  /** Skip user edit protection check (for final content after streaming) */
  skipUserEditCheck?: boolean;
  /**
   * Trust that this cell is streaming even if the TipTap node attribute says otherwise.
   * Used when the store's streaming state is authoritative (e.g., after reconciliation
   * resets the TipTap attribute). Still performs user edit detection.
   */
  forceStreaming?: boolean;
}

/** Cell content extracted from TipTap (for force-save on completion) */
export interface CellContent {
  html: string;
  rawMarkdown: string;
}

/** Result of splitting a single cell into multiple cells */
export interface SplitCellResult {
  /** Whether the split was applied (false if prevented, e.g. user edited during streaming) */
  applied: boolean;
  /** IDs of newly created cells (excluding the original cellId) */
  newCellIds: string[];
}

export interface EditorAPI {
  /** @deprecated Use replaceCellWithMarkdown instead */
  appendToCell: (cellId: string, accumulatedText: string) => void;
  /** @deprecated Use replaceCellWithMarkdown instead */
  setCellContent: (cellId: string, content: string) => void;
  /**
   * Replace cell content with markdown (unified API for AI/refresh/programmatic edits)
   * Parses markdown via tiptap-markdown, sanitizes HTML, handles undo stack.
   */
  replaceCellWithMarkdown: (cellId: string, markdown: string, options?: ReplaceCellOptions) => void;
  /** Set cell streaming state */
  setCellStreaming: (cellId: string, isStreaming: boolean) => void;
  /** Get cell content (HTML + markdown) for force-save on completion */
  getCellContent: (cellId: string) => CellContent | null;
  /**
   * Replace a single streaming cell with multiple cells derived from markdown block structure.
   * Keeps the original cellId for the first cell, creates new ids for additional cells.
   *
   * Returns applied=false if user edited during streaming and the replacement would overwrite their edits.
   */
  replaceStreamingCellWithMarkdownCells: (
    cellId: string,
    markdown: string,
    attrs?: Partial<CellBlockAttributes>,
    options?: { forceStreaming?: boolean }
  ) => SplitCellResult;
  /**
   * Delete "continuation" AI cells that immediately follow a root AI cell.
   * Continuation cells are defined as consecutive `type === 'aiResponse'` cells where `originalPrompt` is null.
   *
   * Returns the ids that were deleted (in document order).
   */
  deleteAiContinuationCells: (rootCellId: string) => string[];
  /** Create a new cell after the specified cell */
  createCellAfter: (afterCellId: string, attrs: Partial<CellBlockAttributes>) => void;
  /** Insert a new cell at the end of the document */
  insertCellAtEnd: (attrs: Partial<CellBlockAttributes>, content: string) => void;
  /** Insert cells after a specific cell (or at start if null). Supports markdown and HTML fallback. */
  insertCellsAfter: (afterCellId: string | null, cells: InsertableCellData[]) => void;
  /** Update cell block attributes (isLive, modelId, etc.) */
  setCellBlockAttributes: (cellId: string, attrs: Partial<CellBlockAttributes>) => void;
  /** Insert an image at the end of a cell */
  insertImageInCell: (cellId: string, imageUrl: string) => void;
}

/**
 * Context for accessing the editor API.
 * Provided by StreamEditor, consumed by AI streaming hooks.
 */
export const EditorContext = createContext<EditorAPI | null>(null);

/**
 * Hook to access the editor API.
 * Returns null if called outside of an EditorContext provider.
 */
export function useEditorAPI(): EditorAPI | null {
  return useContext(EditorContext);
}
