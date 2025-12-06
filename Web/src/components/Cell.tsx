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
  onRegenerate?: (newPrompt: string) => void;
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
  onRegenerate,
  onFocusPrevious,
  onFocusNext,
  registerFocus,
}: CellProps) {
  const [localContent, setLocalContent] = useState(cell.content);
  const [isFocused, setIsFocused] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(cell.originalPrompt || '');
  const saveTimeoutRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);

  // Does this cell have a restatement (dual-representation)?
  const hasRestatement = Boolean(cell.restatement) && cell.type === 'text';

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

  // Check if content is empty (strip HTML tags for check)
  const isContentEmpty = (content: string) => {
    const text = content.replace(/<[^>]*>/g, '').trim();
    return text.length === 0;
  };

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

  // Sync edited prompt with cell prop
  useEffect(() => {
    setEditedPrompt(cell.originalPrompt || '');
  }, [cell.originalPrompt]);

  // Handle regenerate
  const handleRegenerate = () => {
    if (editedPrompt.trim() && onRegenerate) {
      setIsDrawerOpen(false);
      onRegenerate(editedPrompt.trim());
    }
  };

  // Handle prompt input key down
  const handlePromptKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRegenerate();
    } else if (e.key === 'Escape') {
      setIsDrawerOpen(false);
      setEditedPrompt(cell.originalPrompt || '');
    }
  };

  const cellTypeClass = cell.type === 'aiResponse'
    ? 'cell--ai'
    : cell.type === 'quote'
      ? 'cell--quote'
      : '';

  const streamingClass = isStreaming ? 'cell--streaming' : '';
  const errorClass = error ? 'cell--error' : '';

  // Show restatement view when: has restatement, not focused, not new
  const showRestatementView = hasRestatement && !isFocused && !isNew;

  // Does this AI cell have an original prompt?
  const hasOriginalPrompt = cell.type === 'aiResponse' && Boolean(cell.originalPrompt);

  return (
    <div
      ref={containerRef}
      className={`cell ${cellTypeClass} ${streamingClass} ${errorClass} ${hasRestatement ? 'cell--has-restatement' : ''} ${isDrawerOpen ? 'cell--drawer-open' : ''}`}
      onBlur={handleBlur}
      onFocus={handleFocus}
    >
      {/* Prompt drawer for AI cells */}
      {hasOriginalPrompt && (
        <div className="cell-prompt-header">
          <button
            className="cell-prompt-toggle"
            onClick={() => {
              setIsDrawerOpen(!isDrawerOpen);
              if (!isDrawerOpen) {
                setTimeout(() => promptInputRef.current?.focus(), 0);
              }
            }}
          >
            <span className="cell-prompt-arrow">{isDrawerOpen ? '▾' : '▸'}</span>
            <span className="cell-prompt-label">Asked</span>
          </button>
          {isDrawerOpen && (
            <div className="cell-prompt-drawer">
              <input
                ref={promptInputRef}
                type="text"
                className="cell-prompt-input"
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                onKeyDown={handlePromptKeyDown}
                placeholder="Edit your question..."
              />
              <button
                className="cell-prompt-regenerate"
                onClick={handleRegenerate}
                disabled={!editedPrompt.trim() || isStreaming}
                title="Regenerate response"
              >
                ↻
              </button>
            </div>
          )}
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
        // Edit mode: show original content with animated restatement header if applicable
        <>
          {hasRestatement && showRestatementAnim && (
            <div className="cell-restatement-inline cell-restatement--animated">
              {cell.restatement}
            </div>
          )}
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
        </>
      )}
    </div>
  );
}
