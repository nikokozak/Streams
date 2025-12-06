/** A thinking session containing cells and source references */
export interface Stream {
  id: string;
  title: string;
  sources: SourceReference[];
  cells: Cell[];
  createdAt: string;
  updatedAt: string;
}

/** Lightweight summary for list views */
export interface StreamSummary {
  id: string;
  title: string;
  sourceCount: number;
  cellCount: number;
  updatedAt: string;
  previewText: string | null;
}

/** A unit of content within a stream */
export interface Cell {
  id: string;
  streamId: string;
  content: string;
  /** Display title/heading form of content (for text cells that were sent to AI) */
  restatement?: string;
  /** Original user prompt (for aiResponse cells that transformed from text cells) */
  originalPrompt?: string;
  type: CellType;
  sourceBinding: SourceBinding | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/** The type of cell content */
export type CellType = 'text' | 'aiResponse' | 'quote';

/** A reference to an external file */
export interface SourceReference {
  id: string;
  streamId: string;
  displayName: string;
  fileType: SourceFileType;
  status: SourceStatus;
  extractedText: string | null;
  pageCount: number | null;
  addedAt: string;
}

/** Supported source file types */
export type SourceFileType = 'pdf' | 'text' | 'markdown' | 'image';

/** Status of a source reference */
export type SourceStatus = 'pending' | 'ready' | 'stale' | 'error';

/** Links a cell to a specific location in a source file */
export interface SourceBinding {
  sourceId: string;
  location: SourceLocation;
}

/** Location within a source file */
export type SourceLocation =
  | { type: 'whole' }
  | { type: 'page'; page: number }
  | { type: 'pageRange'; startPage: number; endPage: number };
