import { useState, useRef, useEffect, useCallback } from 'react';
import { Cell as CellType } from '../types';
import { CellEditor } from './CellEditor';
import { useBlockStore } from '../store/blockStore';
import { findByShortIdOrName } from '../utils/references';

interface CellProps {
  cell: CellType;
  isNew?: boolean;
  isStreaming?: boolean;
  isRefreshing?: boolean;
  isFirstEmptyCell?: boolean; // Show placeholder only for first cell of empty document
  error?: string;
  onUpdate: (content: string) => void;
  onDelete: () => void;
  onEnter: () => void;
  onThink: () => void;
  onFocusPrevious: () => void;
  onFocusNext: () => void;
  registerFocus: (focus: () => void) => void;
  onScrollToCell?: (cellId: string) => void;
  onOpenOverlay?: () => void;
  onToggleLive?: (isLive: boolean) => void;
}

export function Cell({
  cell,
  isNew = false,
  isStreaming = false,
  isRefreshing = false,
  isFirstEmptyCell = false,
  error,
  onUpdate,
  onDelete,
  onEnter,
  onThink,
  onFocusPrevious,
  onFocusNext,
  registerFocus,
  onScrollToCell,
  onOpenOverlay,
  onToggleLive,
}: CellProps) {
  const [localContent, setLocalContent] = useState(cell.content);
  const [isFocused, setIsFocused] = useState(false);
  const saveTimeoutRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Does this cell have a restatement (dual-representation)?
  // For text cells: shows as a heading when unfocused
  // For AI cells: shows as a header above the response
  const hasRestatement = Boolean(cell.restatement);

  // Track when restatement first appears for animation
  const [showRestatementAnim, setShowRestatementAnim] = useState(false);
  const prevRestatementRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    // If restatement just appeared, trigger animation
    if (cell.restatement && !prevRestatementRef.current) {
      setShowRestatementAnim(true);
    }
    prevRestatementRef.current = cell.restatement;
  }, [cell.restatement]);

  // Handle clicks on cell references
  const handleReferenceClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if clicked on a cell-reference element (TipTap mention)
      if (target.classList.contains('cell-reference') || target.closest('.cell-reference')) {
        e.preventDefault();
        e.stopPropagation();

        // Get the reference text from data-id or text content
        const refElement = target.classList.contains('cell-reference')
          ? target
          : target.closest('.cell-reference');
        if (!refElement) return;

        // TipTap stores mention data in data-id attribute
        const refId = refElement.getAttribute('data-id');
        if (refId && onScrollToCell) {
          // Find the referenced cell by ID or short ID
          const blocks = useBlockStore.getState().blocks;
          const referencedCell = findByShortIdOrName(blocks, refId);
          if (referencedCell) {
            onScrollToCell(referencedCell.id);
          }
        }
      }
    },
    [onScrollToCell]
  );

  // Trim trailing empty paragraphs from HTML content
  const trimEmptyLines = (html: string): string => {
    return html.replace(/(<p>(\s|<br\s*\/?>)*<\/p>\s*)+$/gi, '');
  };

  // Debounced save
  const handleChange = (content: string) => {
    setLocalContent(content);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      if (content !== cell.content) {
        onUpdate(content);
      }
    }, 500);
  };

  // Save immediately on blur or navigation
  const saveNow = () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    const trimmedContent = trimEmptyLines(localContent);
    if (trimmedContent !== localContent) {
      setLocalContent(trimmedContent);
    }
    if (trimmedContent !== cell.content) {
      onUpdate(trimmedContent);
    }
  };

  // Handle focus - also update blockStore
  const handleFocus = () => {
    setIsFocused(true);
    useBlockStore.getState().setFocus(cell.id);
  };

  // Handle blur - save content (empty cells persist like Notion for spacing)
  const handleBlur = (e: React.FocusEvent) => {
    // Check if focus is moving to another element within the same cell
    if (containerRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }

    // If relatedTarget is null/undefined, check if the active element is within the cell
    // This handles cases where the new focus target isn't yet in the DOM (e.g., button clicks)
    if (!e.relatedTarget) {
      // Use a microtask to check after the click completes
      queueMicrotask(() => {
        if (containerRef.current?.contains(document.activeElement)) {
          return;
        }
        setIsFocused(false);
        useBlockStore.getState().setFocus(null);
        saveNow();
      });
      return;
    }

    setIsFocused(false);
    useBlockStore.getState().setFocus(null);
    saveNow();
  };

  // Handle delete - save first, then delete
  const handleBackspaceEmpty = () => {
    saveNow();
    onDelete();
  };

  // Register focus handler for parent
  useEffect(() => {
    registerFocus(() => {
      containerRef.current?.querySelector<HTMLElement>('.ProseMirror')?.focus();
    });
  }, [registerFocus]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Sync local content with cell prop (for streaming updates)
  useEffect(() => {
    // For AI cells, always sync since user doesn't edit them directly
    // For text cells, only sync if not focused (to avoid interrupting typing)
    const isAiCell = cell.type === 'aiResponse';
    const shouldSync = isStreaming || isAiCell || !isFocused;
    if (shouldSync) {
      setLocalContent(cell.content);
    }
  }, [cell.content, cell.type, isStreaming, isFocused]);

  const cellTypeClass = cell.type === 'aiResponse'
    ? 'cell--ai'
    : cell.type === 'quote'
      ? 'cell--quote'
      : '';

  const streamingClass = isStreaming ? 'cell--streaming' : '';
  const refreshingClass = isRefreshing ? 'cell--refreshing' : '';
  const errorClass = error ? 'cell--error' : '';

  // Show restatement view when: text cell, has restatement, not focused, not new
  // AI cells always show content, with restatement as a header above
  const showRestatementView = hasRestatement && !isFocused && !isNew && cell.type === 'text';

  const isAiCell = cell.type === 'aiResponse';
  const isLive = cell.processingConfig?.refreshTrigger === 'onStreamOpen';

  return (
    <div
      ref={containerRef}
      className={`cell ${cellTypeClass} ${streamingClass} ${refreshingClass} ${errorClass} ${hasRestatement ? 'cell--has-restatement' : ''}`}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onClick={handleReferenceClick}
    >
      {/* Hover metadata badge for AI cells */}
      {isAiCell && !isStreaming && (
        <div className="cell-meta-badge">
          <span
            className="cell-meta-badge-label"
            onClick={(e) => {
              e.stopPropagation();
              onOpenOverlay?.();
            }}
          >
            {cell.modelId || 'AI'}
          </span>
          <button
            className={`cell-meta-live-toggle ${isLive ? 'cell-meta-live-toggle--active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleLive?.(!isLive);
            }}
            title={isLive ? 'Live (click to disable)' : 'Click to make live'}
          >
            ⚡
          </button>
        </div>
      )}

      {error ? (
        <div className="cell-error-message">{error}</div>
      ) : showRestatementView ? (
        // Display mode: show restatement as a heading
        <div
          className={`cell-restatement ${showRestatementAnim ? 'cell-restatement--animated' : ''}`}
          onClick={() => {
            setIsFocused(true);
            setTimeout(() => {
              containerRef.current?.querySelector<HTMLElement>('.ProseMirror')?.focus();
            }, 0);
          }}
        >
          {cell.restatement}
        </div>
      ) : (
        // Edit mode: show original content with restatement header if applicable
        <>
          {/* AI cells: always show restatement as header when present */}
          {isAiCell && hasRestatement && (
            <div className={`cell-restatement-header ${showRestatementAnim ? 'cell-restatement--animated' : ''}`}>
              {cell.restatement}
            </div>
          )}
          {/* Text cells: show animated restatement when it first appears */}
          {!isAiCell && hasRestatement && showRestatementAnim && (
            <div className="cell-restatement-inline cell-restatement--animated">
              {cell.restatement}
            </div>
          )}
          <CellEditor
            content={localContent}
            autoFocus={isNew || (hasRestatement && isFocused)}
            placeholder={isFirstEmptyCell ? 'Write your thoughts...' : ''}
            cellId={cell.id}
            streamId={cell.streamId}
            onChange={handleChange}
            onEnter={onEnter}
            onThink={() => { saveNow(); onThink(); }}
            onBackspaceEmpty={handleBackspaceEmpty}
            onArrowUp={() => { saveNow(); onFocusPrevious(); }}
            onArrowDown={() => { saveNow(); onFocusNext(); }}
          />
        </>
      )}
    </div>
  );
}
