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

        // Also update the actual cell content
        setCells(prev => prev.map(c =>
          c.id === cellId ? { ...c, content: (streamingCells.get(cellId)?.content || '') + chunk } : c
        ));
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

      // Handle restatement for user cells
      if (message.type === 'cellRestatement' && message.payload?.cellId && message.payload?.restatement) {
        const cellId = message.payload.cellId as string;
        const restatement = message.payload.restatement as string;

        console.log('Received restatement:', { cellId, restatement });

        setCells(prev => {
          const cell = prev.find(c => c.id === cellId);
          if (cell) {
            // Save the restatement to Swift
            bridge.send({
              type: 'saveCell',
              payload: {
                id: cellId,
                streamId: stream.id,
                content: cell.content,
                type: cell.type,
                order: cell.order,
                restatement,
              },
            });
          }
          return prev.map(c =>
            c.id === cellId ? { ...c, restatement } : c
          );
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

  // Cmd+Enter: Send cell to AI with full context
  const handleThink = useCallback((cellId: string) => {
    const cellIndex = cells.findIndex(c => c.id === cellId);
    const currentCell = cells[cellIndex];
    if (!currentCell || !stripHtml(currentCell.content).trim()) return;

    // Check if next cell is an AI response - if so, replace it instead of creating new
    const nextCell = cells[cellIndex + 1];
    const shouldReplace = nextCell?.type === 'aiResponse';

    // Gather prior cells for context (exclude the AI response we're replacing)
    const priorCells = cells.slice(0, cellIndex + 1).map(c => ({
      id: c.id,
      content: c.content,
      type: c.type,
    }));

    let aiCellId: string;

    if (shouldReplace) {
      // Reuse existing AI cell
      aiCellId = nextCell.id;

      // Clear its content
      setCells(prev => prev.map(c =>
        c.id === aiCellId ? { ...c, content: '', updatedAt: new Date().toISOString() } : c
      ));
    } else {
      // Create new AI response cell
      aiCellId = crypto.randomUUID();
      const aiCell: CellType = {
        id: aiCellId,
        streamId: stream.id,
        content: '',
        type: 'aiResponse',
        sourceBinding: null,
        order: currentCell.order + 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Insert AI cell after current
      setCells(prev => {
        const updated = [...prev];
        updated.splice(cellIndex + 1, 0, aiCell);
        return updated.map((c, i) => ({ ...c, order: i }));
      });

      // Save new AI cell
      bridge.send({
        type: 'saveCell',
        payload: {
          id: aiCellId,
          streamId: stream.id,
          content: '',
          type: 'aiResponse',
          order: currentCell.order + 1,
        },
      });
    }

    // Start streaming
    setStreamingCells(prev => new Map(prev).set(aiCellId, { id: aiCellId, content: '' }));

    // Clear any previous error
    setErrorCells(prev => {
      const updated = new Map(prev);
      updated.delete(aiCellId);
      return updated;
    });

    // Send think request with full context
    // Include sourceCellId so Swift can generate a restatement for the user's question
    // Strip HTML to send plain text to the AI
    bridge.send({
      type: 'think',
      payload: {
        cellId: aiCellId,
        sourceCellId: currentCell.id,
        streamId: stream.id,
        currentCell: stripHtml(currentCell.content),
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

            return (
              <div key={cell.id} data-cell-id={cell.id}>
                <Cell
                  cell={isStreaming ? { ...cell, content: streamingContent || '' } : cell}
                  isNew={cell.id === newCellId}
                  isStreaming={isStreaming}
                  isOnlyCell={cells.length === 1}
                  error={error}
                  onUpdate={(content) => handleCellUpdate(cell.id, content)}
                  onDelete={() => handleCellDelete(cell.id)}
                  onEnter={() => handleCreateCell(index)}
                  onThink={() => handleThink(cell.id)}
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
