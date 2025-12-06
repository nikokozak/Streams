import { useState, useRef, useCallback, useEffect } from 'react';
import { Stream, Cell as CellType, SourceReference, bridge } from '../types';
import { Cell } from './Cell';
import { SourcePanel } from './SourcePanel';
import { markdownToHtml } from '../utils/markdown';

// Strip HTML tags to get plain text
function stripHtml(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

interface StreamEditorProps {
  stream: Stream;
  onBack: () => void;
}

interface StreamingCell {
  id: string;
  content: string;
}

export function StreamEditor({ stream, onBack }: StreamEditorProps) {
  const [cells, setCells] = useState<CellType[]>(stream.cells);
  const [sources, setSources] = useState<SourceReference[]>(stream.sources);
  const [title, setTitle] = useState(stream.title);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [newCellId, setNewCellId] = useState<string | null>(null);
  const [streamingCells, setStreamingCells] = useState<Map<string, StreamingCell>>(new Map());
  const [errorCells, setErrorCells] = useState<Map<string, string>>(new Map());

  const cellFocusRefs = useRef<Map<string, () => void>>(new Map());
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Listen for bridge messages
  useEffect(() => {
    const unsubscribe = bridge.onMessage((message) => {
      // Source updates
      if (message.type === 'sourceAdded' && message.payload?.source) {
        const source = message.payload.source as SourceReference;
        if (source.streamId === stream.id) {
          setSources(prev => [...prev, source]);
        }
      }
      if (message.type === 'sourceRemoved' && message.payload?.id) {
        setSources(prev => prev.filter(s => s.id !== message.payload?.id));
      }

      // AI streaming updates
      if (message.type === 'aiChunk' && message.payload?.cellId && message.payload?.chunk) {
        const cellId = message.payload.cellId as string;
        const chunk = message.payload.chunk as string;

        setStreamingCells(prev => {
          const updated = new Map(prev);
          const existing = updated.get(cellId);
          updated.set(cellId, {
            id: cellId,
            content: (existing?.content || '') + chunk,
          });
          return updated;
        });
      }

      if (message.type === 'aiComplete' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        const rawContent = streamingCells.get(cellId)?.content || '';
        // Convert markdown to HTML for TipTap
        const htmlContent = markdownToHtml(rawContent);

        // Update cell with final content and save
        setCells(prev => prev.map(c =>
          c.id === cellId ? { ...c, content: htmlContent, updatedAt: new Date().toISOString() } : c
        ));

        // Save to Swift (store as HTML)
        const cell = cells.find(c => c.id === cellId);
        if (cell) {
          bridge.send({
            type: 'saveCell',
            payload: {
              id: cellId,
              streamId: stream.id,
              content: htmlContent,
              type: 'aiResponse',
              order: cell.order,
            },
          });
        }

        setStreamingCells(prev => {
          const updated = new Map(prev);
          updated.delete(cellId);
          return updated;
        });
      }

      if (message.type === 'aiError' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        const error = message.payload.error as string;

        setErrorCells(prev => new Map(prev).set(cellId, error));
        setStreamingCells(prev => {
          const updated = new Map(prev);
          updated.delete(cellId);
          return updated;
        });
      }

    });
    return unsubscribe;
  }, [stream.id, cells, streamingCells]);

  const handleSourceAdded = useCallback((source: SourceReference) => {
    setSources(prev => [...prev, source]);
  }, []);

  const handleSourceRemoved = useCallback((sourceId: string) => {
    setSources(prev => prev.filter(s => s.id !== sourceId));
  }, []);

  const handleCellUpdate = useCallback((cellId: string, content: string) => {
    setCells(prev => {
      const updated = prev.map(c =>
        c.id === cellId ? { ...c, content, updatedAt: new Date().toISOString() } : c
      );
      return updated;
    });

    // Save to Swift
    const cell = cells.find(c => c.id === cellId);
    if (cell) {
      bridge.send({
        type: 'saveCell',
        payload: {
          id: cellId,
          streamId: stream.id,
          content,
          type: cell.type,
          order: cell.order,
        },
      });
    }
  }, [cells, stream.id]);

  // Cmd+Enter: Transform current cell into AI response
  const handleThink = useCallback((cellId: string) => {
    const cellIndex = cells.findIndex(c => c.id === cellId);
    const currentCell = cells[cellIndex];
    const originalPrompt = stripHtml(currentCell?.content || '').trim();
    if (!currentCell || !originalPrompt) return;

    // Gather prior cells for context (exclude current cell since it's transforming)
    const priorCells = cells.slice(0, cellIndex).map(c => ({
      id: c.id,
      content: c.content,
      type: c.type,
    }));

    // Transform the current cell into an AI response
    setCells(prev => prev.map(c =>
      c.id === cellId
        ? {
            ...c,
            type: 'aiResponse' as const,
            originalPrompt,
            content: '',
            restatement: undefined,
            updatedAt: new Date().toISOString(),
          }
        : c
    ));

    // Save transformed cell
    bridge.send({
      type: 'saveCell',
      payload: {
        id: cellId,
        streamId: stream.id,
        content: '',
        type: 'aiResponse',
        originalPrompt,
        order: currentCell.order,
      },
    });

    // Start streaming
    setStreamingCells(prev => new Map(prev).set(cellId, { id: cellId, content: '' }));

    // Clear any previous error
    setErrorCells(prev => {
      const updated = new Map(prev);
      updated.delete(cellId);
      return updated;
    });

    // Send think request with full context
    bridge.send({
      type: 'think',
      payload: {
        cellId,
        streamId: stream.id,
        currentCell: originalPrompt,
        priorCells: priorCells.map(c => ({
          ...c,
          content: stripHtml(c.content),
        })),
      },
    });
  }, [cells, stream.id]);

  // Regenerate an AI cell with a new/edited prompt
  const handleRegenerate = useCallback((cellId: string, newPrompt: string) => {
    const cellIndex = cells.findIndex(c => c.id === cellId);
    const currentCell = cells[cellIndex];
    if (!currentCell || currentCell.type !== 'aiResponse') return;

    // Gather prior cells for context (exclude current cell)
    const priorCells = cells.slice(0, cellIndex).map(c => ({
      id: c.id,
      content: c.content,
      type: c.type,
    }));

    // Update the cell with new prompt and clear content
    setCells(prev => prev.map(c =>
      c.id === cellId
        ? {
            ...c,
            originalPrompt: newPrompt,
            content: '',
            updatedAt: new Date().toISOString(),
          }
        : c
    ));

    // Save updated cell
    bridge.send({
      type: 'saveCell',
      payload: {
        id: cellId,
        streamId: stream.id,
        content: '',
        type: 'aiResponse',
        originalPrompt: newPrompt,
        order: currentCell.order,
      },
    });

    // Start streaming
    setStreamingCells(prev => new Map(prev).set(cellId, { id: cellId, content: '' }));

    // Clear any previous error
    setErrorCells(prev => {
      const updated = new Map(prev);
      updated.delete(cellId);
      return updated;
    });

    // Send think request
    bridge.send({
      type: 'think',
      payload: {
        cellId,
        streamId: stream.id,
        currentCell: newPrompt,
        priorCells: priorCells.map(c => ({
          ...c,
          content: stripHtml(c.content),
        })),
      },
    });
  }, [cells, stream.id]);

  const handleCellDelete = useCallback((cellId: string) => {
    const index = cells.findIndex(c => c.id === cellId);
    if (index === -1) return;

    // Don't delete if it's the only cell
    if (cells.length === 1) return;

    setCells(prev => prev.filter(c => c.id !== cellId));
    bridge.send({ type: 'deleteCell', payload: { id: cellId } });

    // Focus previous cell or next if deleting first
    const focusIndex = index > 0 ? index - 1 : 0;
    const focusId = cells[focusIndex]?.id;
    if (focusId && focusId !== cellId) {
      setTimeout(() => {
        cellFocusRefs.current.get(focusId)?.();
      }, 0);
    }
  }, [cells]);

  const handleCreateCell = useCallback((afterIndex: number) => {
    const newCell: CellType = {
      id: crypto.randomUUID(),
      streamId: stream.id,
      content: '',
      type: 'text',
      sourceBinding: null,
      order: afterIndex + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setCells(prev => {
      const updated = [...prev];
      updated.splice(afterIndex + 1, 0, newCell);
      return updated.map((c, i) => ({ ...c, order: i }));
    });

    setNewCellId(newCell.id);

    bridge.send({
      type: 'saveCell',
      payload: {
        id: newCell.id,
        streamId: stream.id,
        content: '',
        type: 'text',
        order: afterIndex + 1,
      },
    });
  }, [stream.id]);

  const handleFocusPrevious = useCallback((currentIndex: number) => {
    if (currentIndex > 0) {
      const prevId = cells[currentIndex - 1]?.id;
      if (prevId) {
        cellFocusRefs.current.get(prevId)?.();
      }
    }
  }, [cells]);

  const handleFocusNext = useCallback((currentIndex: number) => {
    if (currentIndex < cells.length - 1) {
      const nextId = cells[currentIndex + 1]?.id;
      if (nextId) {
        cellFocusRefs.current.get(nextId)?.();
      }
    }
  }, [cells]);

  const registerCellFocus = useCallback((cellId: string, focus: () => void) => {
    cellFocusRefs.current.set(cellId, focus);
  }, []);

  // Title editing handlers
  const startEditingTitle = useCallback(() => {
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  }, []);

  const saveTitle = useCallback(() => {
    const trimmedTitle = title.trim() || 'Untitled';
    setTitle(trimmedTitle);
    setIsEditingTitle(false);
    bridge.send({
      type: 'updateStreamTitle',
      payload: { id: stream.id, title: trimmedTitle },
    });
  }, [title, stream.id]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTitle();
    } else if (e.key === 'Escape') {
      setTitle(stream.title);
      setIsEditingTitle(false);
    }
  }, [saveTitle, stream.title]);

  // Create initial cell if stream is empty
  if (cells.length === 0) {
    const initialCell: CellType = {
      id: crypto.randomUUID(),
      streamId: stream.id,
      content: '',
      type: 'text',
      sourceBinding: null,
      order: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setCells([initialCell]);
    setNewCellId(initialCell.id);
    bridge.send({
      type: 'saveCell',
      payload: {
        id: initialCell.id,
        streamId: stream.id,
        content: '',
        type: 'text',
        order: 0,
      },
    });
  }

  return (
    <div className="stream-editor">
      <header className="stream-header">
        <button onClick={onBack} className="back-button">
          ← Back
        </button>
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            type="text"
            className="stream-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={handleTitleKeyDown}
            autoFocus
          />
        ) : (
          <h1 onClick={startEditingTitle} className="stream-title-editable">
            {title}
          </h1>
        )}
        <span className="stream-hint">Cmd+Enter to think with AI</span>
      </header>

      <div className="stream-body">
        <div className="stream-content">
          {cells.map((cell, index) => {
            const isStreaming = streamingCells.has(cell.id);
            const error = errorCells.get(cell.id);
            const streamingContent = streamingCells.get(cell.id)?.content;
            // Convert streaming markdown to HTML for display
            const displayContent = isStreaming && streamingContent
              ? markdownToHtml(streamingContent)
              : cell.content;

            return (
              <div key={cell.id} data-cell-id={cell.id}>
                <Cell
                  cell={isStreaming ? { ...cell, content: displayContent } : cell}
                  isNew={cell.id === newCellId}
                  isStreaming={isStreaming}
                  isOnlyCell={cells.length === 1}
                  error={error}
                  onUpdate={(content) => handleCellUpdate(cell.id, content)}
                  onDelete={() => handleCellDelete(cell.id)}
                  onEnter={() => handleCreateCell(index)}
                  onThink={() => handleThink(cell.id)}
                  onRegenerate={(newPrompt) => handleRegenerate(cell.id, newPrompt)}
                  onFocusPrevious={() => handleFocusPrevious(index)}
                  onFocusNext={() => handleFocusNext(index)}
                  registerFocus={(focus) => registerCellFocus(cell.id, focus)}
                />
              </div>
            );
          })}
        </div>

        <SourcePanel
          streamId={stream.id}
          sources={sources}
          onSourceAdded={handleSourceAdded}
          onSourceRemoved={handleSourceRemoved}
        />
      </div>
    </div>
  );
}
