import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Mention from '@tiptap/extension-mention';
import { useEffect, useRef, useMemo } from 'react';
import { createReferenceSuggestion } from './ReferenceSuggestion';
import { useBlockStore } from '../store/blockStore';
import { Cell } from '../types/models';

interface CellEditorProps {
  content: string;
  placeholder?: string;
  autoFocus?: boolean;
  cellId?: string; // Current cell's ID to exclude from suggestions
  onChange: (content: string) => void;
  onEnter?: () => void;
  onThink?: () => void;
  onBackspaceEmpty?: () => void;
  onArrowUp?: () => void;
  onArrowDown?: () => void;
}

export function CellEditor({
  content,
  placeholder = 'Type something...',
  autoFocus = false,
  cellId,
  onChange,
  onEnter,
  onThink,
  onBackspaceEmpty,
  onArrowUp,
  onArrowDown,
}: CellEditorProps) {
  // Track if change originated from user typing (to avoid cursor reset)
  const isLocalChange = useRef(false);

  // Get cells for reference suggestions (exclude current cell)
  const getCells = useMemo(() => {
    return (): Cell[] => {
      const blocks = useBlockStore.getState().getBlocksArray();
      return cellId ? blocks.filter((b) => b.id !== cellId) : blocks;
    };
  }, [cellId]);

  // Create suggestion config with cell getter
  const suggestionConfig = useMemo(
    () => createReferenceSuggestion(getCells),
    [getCells]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
      Mention.configure({
        HTMLAttributes: {
          class: 'cell-reference',
        },
        renderLabel({ node }) {
          return `@block-${node.attrs.label ?? node.attrs.id}`;
        },
        suggestion: suggestionConfig,
      }),
    ],
    content,
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        class: 'cell-editor-content',
      },
      handleKeyDown: (view, event) => {
        const { state } = view;
        const { selection } = state;
        const { empty, $anchor } = selection;

        // Cmd+Enter - think with AI
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          if (onThink) {
            event.preventDefault();
            onThink();
            return true;
          }
        }

        // Enter at end of content - create new cell
        if (event.key === 'Enter' && !event.shiftKey) {
          const isAtEnd = $anchor.pos === state.doc.content.size - 1;
          if (isAtEnd && onEnter) {
            event.preventDefault();
            onEnter();
            return true;
          }
        }

        // Backspace at start of empty cell - delete cell
        if (event.key === 'Backspace' && empty) {
          const isAtStart = $anchor.pos === 1;
          const isEmpty = state.doc.textContent.length === 0;
          if (isAtStart && isEmpty && onBackspaceEmpty) {
            event.preventDefault();
            onBackspaceEmpty();
            return true;
          }
        }

        // Arrow up at start - focus previous cell
        if (event.key === 'ArrowUp' && empty) {
          const isAtStart = $anchor.pos === 1;
          if (isAtStart && onArrowUp) {
            event.preventDefault();
            onArrowUp();
            return true;
          }
        }

        // Arrow down at end - focus next cell
        if (event.key === 'ArrowDown' && empty) {
          const isAtEnd = $anchor.pos === state.doc.content.size - 1;
          if (isAtEnd && onArrowDown) {
            event.preventDefault();
            onArrowDown();
            return true;
          }
        }

        return false;
      },
    },
    onUpdate: ({ editor }) => {
      isLocalChange.current = true;
      onChange(editor.getHTML());
    },
  });

  // Update content when prop changes (from external source, not user typing)
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      if (isLocalChange.current) {
        // Change came from user typing, don't reset cursor
        isLocalChange.current = false;
      } else {
        // Change came from outside (e.g., streaming), update content
        // TipTap 2.x API: setContent(content, emitUpdate, parseOptions)
        editor.commands.setContent(content, false, { preserveWhitespace: 'full' });
      }
    }
  }, [content, editor]);

  // Focus editor when autoFocus becomes true (only on mount or when isNew)
  // Use a ref to track if we've already focused, to avoid re-focusing on every render
  const hasFocused = useRef(false);

  useEffect(() => {
    if (autoFocus && editor && !hasFocused.current) {
      editor.commands.focus('end');
      hasFocused.current = true;
    }
    // Reset when autoFocus becomes false (e.g., cell is no longer new)
    if (!autoFocus) {
      hasFocused.current = false;
    }
  }, [autoFocus, editor]);

  return (
    <div className="cell-editor">
      <EditorContent editor={editor} />
    </div>
  );
}
