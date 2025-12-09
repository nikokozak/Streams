import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Mention from '@tiptap/extension-mention';
import Image from '@tiptap/extension-image';
import { useEffect, useRef, useMemo, useCallback } from 'react';
import { createReferenceSuggestion } from './ReferenceSuggestion';
import { useBlockStore } from '../store/blockStore';
import { Cell } from '../types/models';
import { bridge } from '../types';

interface CellEditorProps {
  content: string;
  placeholder?: string;
  autoFocus?: boolean;
  cellId?: string; // Current cell's ID to exclude from suggestions
  streamId?: string; // Stream ID for saving images
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
  streamId,
  onChange,
  onEnter,
  onThink,
  onBackspaceEmpty,
  onArrowUp,
  onArrowDown,
}: CellEditorProps) {
  // Track if change originated from user typing (to avoid cursor reset)
  const isLocalChange = useRef(false);

  // Get cells for reference suggestions (exclude current cell and empty spacing cells)
  const getCells = useMemo(() => {
    return (): Cell[] => {
      const blocks = useBlockStore.getState().getBlocksArray();
      return blocks.filter((b) => {
        // Exclude current cell
        if (cellId && b.id === cellId) return false;
        // Exclude empty cells (spacing blocks)
        const textContent = b.content.replace(/<[^>]*>/g, '').trim();
        if (textContent.length === 0) return false;
        return true;
      });
    };
  }, [cellId]);

  // Create suggestion config with cell getter
  const suggestionConfig = useMemo(
    () => createReferenceSuggestion(getCells),
    [getCells]
  );

  // Handle image file drop/paste
  const handleImageFile = useCallback(async (file: File): Promise<string | null> => {
    if (!streamId) {
      console.warn('Cannot save image: no streamId provided');
      return null;
    }

    // Read file as base64
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1]; // Remove data:image/...;base64, prefix

        // Generate a temporary ID
        const tempId = crypto.randomUUID();

        // Set up listener for save response
        const unsubscribe = bridge.onMessage((message) => {
          if (message.type === 'imageSaved' && message.payload?.fullPath) {
            unsubscribe();
            // Use file:// URL for local images
            const fullPath = message.payload.fullPath as string;
            resolve(`file://${fullPath}`);
          } else if (message.type === 'imageSaveError') {
            unsubscribe();
            console.error('Failed to save image:', message.payload?.error);
            resolve(null);
          }
        });

        // Send save request
        bridge.send({
          type: 'saveImage',
          payload: {
            streamId,
            data: base64,
            tempId,
          },
        });
      };
      reader.onerror = () => {
        console.error('Failed to read image file');
        resolve(null);
      };
      reader.readAsDataURL(file);
    });
  }, [streamId]);

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
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: {
          class: 'cell-image',
        },
      }),
    ],
    content,
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        class: 'cell-editor-content',
      },
      // Handle image drops
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !event.dataTransfer?.files?.length) {
          return false;
        }

        const files = Array.from(event.dataTransfer.files);
        const imageFiles = files.filter(file => file.type.startsWith('image/'));

        if (imageFiles.length === 0) {
          return false;
        }

        event.preventDefault();

        // Get drop position
        const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });

        // Process each image
        imageFiles.forEach(async (file) => {
          const url = await handleImageFile(file);
          if (url && coordinates) {
            // Insert image at drop position
            const node = view.state.schema.nodes.image.create({ src: url });
            const transaction = view.state.tr.insert(coordinates.pos, node);
            view.dispatch(transaction);
          }
        });

        return true;
      },
      // Handle image paste
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;

        const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'));
        if (imageItems.length === 0) return false;

        event.preventDefault();

        imageItems.forEach(async (item) => {
          const file = item.getAsFile();
          if (!file) return;

          const url = await handleImageFile(file);
          if (url) {
            // Insert image at cursor position
            const node = view.state.schema.nodes.image.create({ src: url });
            const transaction = view.state.tr.replaceSelectionWith(node);
            view.dispatch(transaction);
          }
        });

        return true;
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
        // For empty cells, always allow Enter. For non-empty, check if at end.
        if (event.key === 'Enter' && !event.shiftKey) {
          const isEmpty = state.doc.textContent.length === 0;
          const isAtEnd = $anchor.pos >= state.doc.content.size - 1;
          if ((isEmpty || isAtEnd) && onEnter) {
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
        // For empty cells, always navigate. For non-empty, check if at start.
        if (event.key === 'ArrowUp' && empty) {
          const isEmpty = state.doc.textContent.length === 0;
          const isAtStart = $anchor.pos <= 1;
          if ((isEmpty || isAtStart) && onArrowUp) {
            event.preventDefault();
            onArrowUp();
            return true;
          }
        }

        // Arrow down at end - focus next cell
        // For empty cells, always navigate. For non-empty, check if at end.
        if (event.key === 'ArrowDown' && empty) {
          const isEmpty = state.doc.textContent.length === 0;
          const isAtEnd = $anchor.pos >= state.doc.content.size - 1;
          if ((isEmpty || isAtEnd) && onArrowDown) {
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
