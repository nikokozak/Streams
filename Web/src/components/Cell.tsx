import { useState, useRef, useEffect } from 'react';
import { Cell as CellType } from '../types';
import { CellEditor } from './CellEditor';

interface CellProps {
  cell: CellType;
  isNew?: boolean;
  onUpdate: (content: string) => void;
  onDelete: () => void;
  onEnter: () => void;
  onFocusPrevious: () => void;
  onFocusNext: () => void;
  registerFocus: (focus: () => void) => void;
}

export function Cell({
  cell,
  isNew = false,
  onUpdate,
  onDelete,
  onEnter,
  onFocusPrevious,
  onFocusNext,
  registerFocus,
}: CellProps) {
  const [localContent, setLocalContent] = useState(cell.content);
  const saveTimeoutRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const cellTypeClass = cell.type === 'aiResponse'
    ? 'cell--ai'
    : cell.type === 'quote'
      ? 'cell--quote'
      : '';

  return (
    <div
      ref={containerRef}
      className={`cell ${cellTypeClass}`}
      onBlur={saveNow}
    >
      <CellEditor
        content={localContent}
        autoFocus={isNew}
        placeholder="Type something..."
        onChange={handleChange}
        onEnter={onEnter}
        onBackspaceEmpty={handleBackspaceEmpty}
        onArrowUp={() => { saveNow(); onFocusPrevious(); }}
        onArrowDown={() => { saveNow(); onFocusNext(); }}
      />
    </div>
  );
}
