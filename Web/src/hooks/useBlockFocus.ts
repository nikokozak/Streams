import { useEffect, useCallback } from 'react';
import { useBlockStore } from '../store/blockStore';

interface UseBlockFocusOptions {
  /** Callback when focus should move to previous block */
  onFocusPrevious?: (currentId: string) => void;
  /** Callback when focus should move to next block */
  onFocusNext?: (currentId: string) => void;
  /** Callback when a new block should be created */
  onCreateBlock?: (afterId: string) => void;
  /** Callback when current block should be deleted */
  onDeleteBlock?: (id: string) => void;
}

/**
 * Hook for managing block focus and keyboard navigation
 * Provides Notion-like navigation between blocks
 */
export function useBlockFocus(options: UseBlockFocusOptions = {}) {
  const store = useBlockStore();
  const { onFocusPrevious, onFocusNext, onDeleteBlock } = options;

  // Get current cursor position in the editor
  const getCursorPosition = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    const editor = document.querySelector('.ProseMirror:focus');
    if (!editor) return null;

    // Check if at start of content
    const isAtStart = range.startOffset === 0 && range.collapsed;

    // Check if at end of content
    const textContent = editor.textContent || '';
    const isAtEnd = range.endOffset >= textContent.length && range.collapsed;

    return { isAtStart, isAtEnd, editor };
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const focusedId = store.focusedBlockId;
      if (!focusedId) return;

      const cursor = getCursorPosition();

      // Arrow Up at start of block -> focus previous
      if (e.key === 'ArrowUp' && cursor?.isAtStart && !e.shiftKey) {
        e.preventDefault();
        store.focusPrevious();
        onFocusPrevious?.(focusedId);
      }

      // Arrow Down at end of block -> focus next
      if (e.key === 'ArrowDown' && cursor?.isAtEnd && !e.shiftKey) {
        e.preventDefault();
        store.focusNext();
        onFocusNext?.(focusedId);
      }

      // Enter at end -> create new block (handled by Cell component)
      // This hook doesn't intercept Enter to allow normal behavior

      // Backspace at start of empty block -> delete and focus previous
      if (e.key === 'Backspace' && cursor?.isAtStart) {
        const block = store.getBlock(focusedId);
        const isContentEmpty =
          !block?.content || block.content.replace(/<[^>]*>/g, '').trim() === '';

        if (isContentEmpty) {
          const blocks = store.getBlocksArray();
          // Don't delete if it's the only block
          if (blocks.length > 1) {
            e.preventDefault();
            store.focusPrevious();
            onDeleteBlock?.(focusedId);
          }
        }
      }

      // Tab -> indent (future feature)
      // Shift+Tab -> outdent (future feature)
    },
    [store, getCursorPosition, onFocusPrevious, onFocusNext, onDeleteBlock]
  );

  // Set up global keyboard listener
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Return focus management utilities
  return {
    focusedBlockId: store.focusedBlockId,
    setFocus: store.setFocus,
    focusNext: store.focusNext,
    focusPrevious: store.focusPrevious,
  };
}
