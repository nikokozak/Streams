import { useState, useRef, useEffect } from 'react';
import { Cell as CellType } from '../types';
import { CellEditor } from './CellEditor';
import { ModifierMenu } from './ModifierMenu';
import { useBlockStore } from '../store/blockStore';

interface CellProps {
  cell: CellType;
  isNew?: boolean;
  isStreaming?: boolean;
  isModifying?: boolean;
  isRefreshing?: boolean;
  pendingModifierPrompt?: string;
  isOnlyCell?: boolean;
  error?: string;
  onUpdate: (content: string) => void;
  onDelete: () => void;
  onEnter: () => void;
  onThink: () => void;
  onRegenerate?: (newPrompt: string) => void;
  onApplyModifier?: (prompt: string) => void;
  onSelectVersion?: (versionId: string) => void;
  onFocusPrevious: () => void;
  onFocusNext: () => void;
  registerFocus: (focus: () => void) => void;
}

export function Cell({
  cell,
  isNew = false,
  isStreaming = false,
  isModifying = false,
  isRefreshing = false,
  pendingModifierPrompt,
  isOnlyCell = false,
  error,
  onUpdate,
  onDelete,
  onEnter,
  onThink,
  onRegenerate,
  onApplyModifier,
  onSelectVersion,
  onFocusPrevious,
  onFocusNext,
  registerFocus,
}: CellProps) {
  const [localContent, setLocalContent] = useState(cell.content);
  const [isFocused, setIsFocused] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
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

  // Handle focus - also update blockStore
  const handleFocus = () => {
    setIsFocused(true);
    useBlockStore.getState().setFocus(cell.id);
  };

  // Handle blur - save and prune if empty
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

        if (!isOnlyCell && cell.type !== 'aiResponse' && isContentEmpty(localContent)) {
          setTimeout(() => {
            onDelete();
          }, 50);
        }
      });
      return;
    }

    setIsFocused(false);
    useBlockStore.getState().setFocus(null);
    saveNow();

    // Auto-prune empty cells (unless it's the only cell or an AI cell)
    if (!isOnlyCell && cell.type !== 'aiResponse' && isContentEmpty(localContent)) {
      // Small delay to let any other operations complete
      setTimeout(() => {
        onDelete();
      }, 50);
    }
  };

  // Close menu when clicking outside the cell
  useEffect(() => {
    if (!isMenuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

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

  // Sync local content with cell prop (for streaming updates and version changes)
  useEffect(() => {
    // Always sync when content changes from outside (streaming, modifying, or version switch)
    // For AI cells, always sync since user doesn't edit them directly
    // For text cells, only sync if not focused (to avoid interrupting typing)
    const isAiCell = cell.type === 'aiResponse';
    const shouldSync = isStreaming || isModifying || isAiCell || !isFocused;
    if (shouldSync) {
      setLocalContent(cell.content);
    }
  }, [cell.content, cell.type, isStreaming, isModifying, isFocused]);

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

  // Modifier state
  const modifiers = cell.modifiers || [];
  const isAiCell = cell.type === 'aiResponse';

  // Handle regenerating from the original prompt (clears all modifiers)
  const handleRegenerateFromOriginal = (newPrompt: string) => {
    if (onRegenerate) {
      onRegenerate(newPrompt);
      setIsMenuOpen(false);
    }
  };

  // Handle regenerating from a specific modifier index
  const handleRegenerateFromModifier = (_modifierIndex: number, newPrompt: string) => {
    // For now, we just apply the modifier as a new one
    // TODO: In the future, we could re-apply from that point
    if (onApplyModifier) {
      onApplyModifier(newPrompt);
      setIsMenuOpen(false);
    }
  };

  // Handle adding a new modifier
  const handleAddModifier = (prompt: string) => {
    if (onApplyModifier) {
      onApplyModifier(prompt);
      // Keep menu open to show processing state
      setIsMenuOpen(true);
    }
  };

  // Handle version selection
  const handleSelectVersion = (versionId: string) => {
    if (onSelectVersion) {
      onSelectVersion(versionId);
    }
  };

  // Track if we're waiting for AI response (triggered but no content yet)
  const isWaitingForResponse = isStreaming && !cell.content;

  // Versions for display
  const versions = cell.versions || [];

  return (
    <div
      ref={containerRef}
      className={`cell ${cellTypeClass} ${streamingClass} ${refreshingClass} ${errorClass} ${hasRestatement ? 'cell--has-restatement' : ''} ${isMenuOpen ? 'cell--menu-open' : ''}`}
      onBlur={handleBlur}
      onFocus={handleFocus}
    >
      {/* Circle indicator for AI cells - click to open modifier menu */}
      {isAiCell && !isStreaming && (
        <button
          className="cell-circle-indicator"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          aria-label="Modifier history"
        />
      )}

      {/* Modifier menu - inline above cell content, pushes content down */}
      {/* Show when: menu is open OR waiting for initial response (no content yet) */}
      {isAiCell && (isMenuOpen || isWaitingForResponse) && cell.originalPrompt && (
        <ModifierMenu
          originalPrompt={cell.originalPrompt}
          modifiers={modifiers}
          versions={versions}
          activeVersionId={cell.activeVersionId}
          isProcessing={isWaitingForResponse || isModifying}
          pendingModifierPrompt={pendingModifierPrompt}
          onClose={() => setIsMenuOpen(false)}
          onRegenerateFromOriginal={handleRegenerateFromOriginal}
          onRegenerateFromModifier={handleRegenerateFromModifier}
          onAddModifier={handleAddModifier}
          onSelectVersion={handleSelectVersion}
        />
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
            autoFocus={!isMenuOpen && (isNew || (hasRestatement && isFocused))}
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
