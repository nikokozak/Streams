import { useCallback, useEffect, useRef, useMemo } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { keymap, EditorView } from '@codemirror/view';
import { Prec } from '@codemirror/state';

interface MarkdownEditorProps {
  content: string;
  placeholder?: string;
  autoFocus?: boolean;
  cellId?: string;
  streamId?: string;
  onChange: (content: string) => void;
  onEnter?: () => void;
  onThink?: () => void;
  onBackspaceEmpty?: () => void;
  onArrowUp?: () => void;
  onArrowDown?: () => void;
}

// Theme for the editor to match app styling
const editorTheme = EditorView.theme({
  '&': {
    fontSize: '15px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  },
  '.cm-content': {
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
    padding: '0',
    minHeight: '1.5em',
  },
  '.cm-line': {
    padding: '0',
    lineHeight: '1.6',
  },
  '.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    overflow: 'visible',
  },
  '.cm-placeholder': {
    color: 'var(--color-text-muted)',
    fontStyle: 'normal',
  },
  // Markdown syntax highlighting
  '.cm-header-1': { fontSize: '1.6em', fontWeight: '600' },
  '.cm-header-2': { fontSize: '1.3em', fontWeight: '600' },
  '.cm-header-3': { fontSize: '1.1em', fontWeight: '600' },
  '.cm-strong': { fontWeight: '600' },
  '.cm-emphasis': { fontStyle: 'italic' },
  '.cm-strikethrough': { textDecoration: 'line-through' },
  '.cm-link': { color: 'var(--color-accent)' },
  '.cm-url': { color: 'var(--color-text-tertiary)' },
  '.cm-meta': { color: 'var(--color-text-tertiary)' },
});

export function MarkdownEditor({
  content,
  placeholder = 'Type something...',
  autoFocus = false,
  onChange,
  onEnter,
  onThink,
  onBackspaceEmpty,
  onArrowUp,
  onArrowDown,
}: MarkdownEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const isExternalUpdate = useRef(false);

  // Memoize the change handler to avoid re-renders
  const handleChange = useCallback(
    (value: string) => {
      if (!isExternalUpdate.current) {
        onChange(value);
      }
      isExternalUpdate.current = false;
    },
    [onChange]
  );

  // Create custom keymap for app-specific shortcuts
  const customKeymap = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          // Cmd+Enter - trigger AI
          {
            key: 'Mod-Enter',
            run: () => {
              if (onThink) {
                onThink();
                return true;
              }
              return false;
            },
          },
          // Enter at end of content - create new cell
          {
            key: 'Enter',
            run: (view) => {
              const state = view.state;
              const doc = state.doc;
              const selection = state.selection.main;

              // Check if we're at the end of the document
              const atEnd = selection.from === doc.length;
              const isEmpty = doc.length === 0;

              if ((isEmpty || atEnd) && onEnter) {
                onEnter();
                return true;
              }
              return false; // Let default handler run (insert newline)
            },
          },
          // Backspace on empty - delete cell
          {
            key: 'Backspace',
            run: (view) => {
              const state = view.state;
              const doc = state.doc;
              const selection = state.selection.main;

              // Only trigger when empty and at start
              const isEmpty = doc.length === 0;
              const atStart = selection.from === 0;

              if (isEmpty && atStart && onBackspaceEmpty) {
                onBackspaceEmpty();
                return true;
              }
              return false; // Let default handler run
            },
          },
          // Arrow up at start - focus previous cell
          {
            key: 'ArrowUp',
            run: (view) => {
              const state = view.state;
              const doc = state.doc;
              const selection = state.selection.main;

              // Only trigger when at start (position 0) or empty
              const atStart = selection.from === 0;
              const isEmpty = doc.length === 0;

              if ((isEmpty || atStart) && onArrowUp) {
                onArrowUp();
                return true;
              }
              return false; // Let default handler run
            },
          },
          // Arrow down at end - focus next cell
          {
            key: 'ArrowDown',
            run: (view) => {
              const state = view.state;
              const doc = state.doc;
              const selection = state.selection.main;

              // Only trigger when at end or empty
              const atEnd = selection.from === doc.length;
              const isEmpty = doc.length === 0;

              if ((isEmpty || atEnd) && onArrowDown) {
                onArrowDown();
                return true;
              }
              return false; // Let default handler run
            },
          },
        ])
      ),
    [onEnter, onThink, onBackspaceEmpty, onArrowUp, onArrowDown]
  );

  // Build extensions (memoized to avoid re-renders)
  const extensions = useMemo(
    () => [
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        addKeymap: true,
      }),
      editorTheme,
      customKeymap,
      EditorView.lineWrapping,
    ],
    [customKeymap]
  );

  // Focus editor when autoFocus is set
  useEffect(() => {
    if (autoFocus && editorRef.current?.view) {
      editorRef.current.view.focus();
    }
  }, [autoFocus]);

  // Handle external content updates (e.g., from streaming)
  useEffect(() => {
    if (editorRef.current?.view) {
      const view = editorRef.current.view;
      const currentContent = view.state.doc.toString();

      if (content !== currentContent) {
        isExternalUpdate.current = true;
        // Replace entire content without moving cursor
        view.dispatch({
          changes: {
            from: 0,
            to: currentContent.length,
            insert: content,
          },
        });
      }
    }
  }, [content]);

  return (
    <div className="cell-editor markdown-editor">
      <CodeMirror
        ref={editorRef}
        value={content}
        onChange={handleChange}
        extensions={extensions}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightSelectionMatches: false,
          dropCursor: true,
          allowMultipleSelections: false,
          indentOnInput: true,
          bracketMatching: false,
          closeBrackets: false,
          autocompletion: false,
          rectangularSelection: false,
          crosshairCursor: false,
          highlightActiveLineGutter: false,
        }}
        autoFocus={autoFocus}
      />
    </div>
  );
}
