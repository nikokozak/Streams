import { useState, useRef, useEffect } from 'react';
import { Cell as CellType } from '../types';
import { CellEditor } from './CellEditor';

interface CellProps {
  cell: CellType;
  isNew?: boolean;
  isStreaming?: boolean;
  isOnlyCell?: boolean;
  error?: string;
  onUpdate: (content: string) => void;
  onDelete: () => void;
  onEnter: () => void;
  onThink: () => void;
  onFocusPrevious: () => void;
  onFocusNext: () => void;
  registerFocus: (focus: () => void) => void;
}

export function Cell({
  cell,
  isNew = false,
  isStreaming = false,
  isOnlyCell = false,
  error,
  onUpdate,
  onDelete,
  onEnter,
  onThink,
  onFocusPrevious,
  onFocusNext,
  registerFocus,
}: CellProps) {
  const [localContent, setLocalContent] = useState(cell.content);
  const [isFocused, setIsFocused] = useState(false);
  const saveTimeoutRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Does this cell have a restatement (dual-representation)?
  const hasRestatement = Boolean(cell.restatement) && cell.type === 'text';

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
    if (localContent !== cell.content) {
      onUpdate(localContent);
    }
  };

  // Check if content is empty (strip HTML tags for check)
  const isContentEmpty = (content: string) => {
    const text = content.replace(/<[^>]*>/g, '').trim();
    return text.length === 0;
  };

  // Handle focus
  const handleFocus = () => {
    setIsFocused(true);
  };

  // Handle blur - save and prune if empty
  const handleBlur = (e: React.FocusEvent) => {
    // Check if focus is moving to another element within the same cell
    if (containerRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }

    setIsFocused(false);
    saveNow();

    // Auto-prune empty cells (unless it's the only cell or an AI cell)
    if (!isOnlyCell && cell.type !== 'aiResponse' && isContentEmpty(localContent)) {
      // Small delay to let any other operations complete
      setTimeout(() => {
        onDelete();
      }, 50);
    }
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
    if (isStreaming) {
      setLocalContent(cell.content);
    }
  }, [cell.content, isStreaming]);

  const cellTypeClass = cell.type === 'aiResponse'
    ? 'cell--ai'
    : cell.type === 'quote'
      ? 'cell--quote'
      : '';

  const streamingClass = isStreaming ? 'cell--streaming' : '';
  const errorClass = error ? 'cell--error' : '';

  // Show restatement view when: has restatement, not focused, not new
  const showRestatementView = hasRestatement && !isFocused && !isNew;

  return (
    <div
      ref={containerRef}
      className={`cell ${cellTypeClass} ${streamingClass} ${errorClass} ${hasRestatement ? 'cell--has-restatement' : ''}`}
      onBlur={handleBlur}
      onFocus={handleFocus}
    >
      {error ? (
        <div className="cell-error-message">{error}</div>
      ) : showRestatementView ? (
        // Display mode: show restatement as a heading
        <div
          className="cell-restatement"
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
        // Edit mode: show original content
        <CellEditor
          content={localContent}
          autoFocus={isNew || (hasRestatement && isFocused)}
          placeholder={cell.type === 'aiResponse' ? '' : 'Write your thoughts...'}
          onChange={handleChange}
          onEnter={onEnter}
          onThink={() => { saveNow(); onThink(); }}
          onBackspaceEmpty={handleBackspaceEmpty}
          onArrowUp={() => { saveNow(); onFocusPrevious(); }}
          onArrowDown={() => { saveNow(); onFocusNext(); }}
        />
      )}
    </div>
  );
}
