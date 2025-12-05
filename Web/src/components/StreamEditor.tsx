import { useState, useRef, useCallback, useEffect } from 'react';
import { Stream, Cell as CellType, SourceReference, bridge } from '../types';
import { Cell } from './Cell';
import { SourcePanel } from './SourcePanel';
import { ActionMenu, Action, getFilteredActions } from './ActionMenu';

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
  const [newCellId, setNewCellId] = useState<string | null>(null);
  const [streamingCells, setStreamingCells] = useState<Map<string, StreamingCell>>(new Map());
  const [errorCells, setErrorCells] = useState<Map<string, string>>(new Map());

  // Slash command menu state
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [actionMenuFilter, setActionMenuFilter] = useState('');
  const [actionMenuIndex, setActionMenuIndex] = useState(0);
  const [actionMenuPosition, setActionMenuPosition] = useState({ top: 0, left: 0 });
  const [pendingActionCellId, setPendingActionCellId] = useState<string | null>(null);

  const cellFocusRefs = useRef<Map<string, () => void>>(new Map());

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
        const finalContent = streamingCells.get(cellId)?.content || '';

        // Update cell with final content and save
        setCells(prev => prev.map(c =>
          c.id === cellId ? { ...c, content: finalContent, updatedAt: new Date().toISOString() } : c
        ));

        // Save to Swift
        const cell = cells.find(c => c.id === cellId);
        if (cell) {
          bridge.send({
            type: 'saveCell',
            payload: {
              id: cellId,
              streamId: stream.id,
              content: finalContent,
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
    // Check for slash command
    if (content.startsWith('/')) {
      const commandText = content.slice(1);
      const filtered = getFilteredActions(commandText);

      if (filtered.length > 0) {
        // Position menu near the cell
        const cellElement = document.querySelector(`[data-cell-id="${cellId}"]`);
        if (cellElement) {
          const rect = cellElement.getBoundingClientRect();
          setActionMenuPosition({ top: rect.bottom + 4, left: rect.left });
        }

        setShowActionMenu(true);
        setActionMenuFilter(commandText);
        setActionMenuIndex(0);
        setPendingActionCellId(cellId);
        return; // Don't save yet
      }
    } else {
      setShowActionMenu(false);
    }

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

  const executeAction = useCallback((action: Action) => {
    if (!pendingActionCellId) return;

    const sourceCell = cells.find(c => c.id === pendingActionCellId);
    if (!sourceCell) return;

    // Get content without the slash command
    const content = sourceCell.content.replace(/^\/\w*\s*/, '').trim();

    // Create AI response cell
    const aiCellId = crypto.randomUUID();
    const aiCell: CellType = {
      id: aiCellId,
      streamId: stream.id,
      content: '',
      type: 'aiResponse',
      sourceBinding: null,
      order: sourceCell.order + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Clear the source cell's slash command
    setCells(prev => {
      const sourceIndex = prev.findIndex(c => c.id === pendingActionCellId);
      const updated = prev.map(c =>
        c.id === pendingActionCellId ? { ...c, content } : c
      );
      // Insert AI cell after source
      updated.splice(sourceIndex + 1, 0, aiCell);
      // Update orders
      return updated.map((c, i) => ({ ...c, order: i }));
    });

    // Save source cell with cleaned content
    bridge.send({
      type: 'saveCell',
      payload: {
        id: pendingActionCellId,
        streamId: stream.id,
        content,
        type: 'text',
        order: sourceCell.order,
      },
    });

    // Save AI cell
    bridge.send({
      type: 'saveCell',
      payload: {
        id: aiCellId,
        streamId: stream.id,
        content: '',
        type: 'aiResponse',
        order: sourceCell.order + 1,
      },
    });

    // Start streaming
    setStreamingCells(prev => new Map(prev).set(aiCellId, { id: aiCellId, content: '' }));

    // Execute action
    bridge.send({
      type: 'executeAction',
      payload: {
        action: action.id,
        cellId: aiCellId,
        streamId: stream.id,
        content: content || 'Please help with this.',
      },
    });

    // Close menu
    setShowActionMenu(false);
    setPendingActionCellId(null);
  }, [pendingActionCellId, cells, stream.id]);

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
      // Update order for all subsequent cells
      return updated.map((c, i) => ({ ...c, order: i }));
    });

    setNewCellId(newCell.id);

    // Save new cell to Swift
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

  // Handle keyboard navigation in action menu
  useEffect(() => {
    if (!showActionMenu) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const filtered = getFilteredActions(actionMenuFilter);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActionMenuIndex(prev => Math.min(prev + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActionMenuIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = filtered[actionMenuIndex];
        if (selected) {
          executeAction(selected);
        }
      } else if (e.key === 'Escape') {
        setShowActionMenu(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showActionMenu, actionMenuFilter, actionMenuIndex, executeAction]);

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
        <h1>{stream.title}</h1>
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
                  error={error}
                  onUpdate={(content) => handleCellUpdate(cell.id, content)}
                  onDelete={() => handleCellDelete(cell.id)}
                  onEnter={() => handleCreateCell(index)}
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

      {showActionMenu && (
        <ActionMenu
          filter={actionMenuFilter}
          selectedIndex={actionMenuIndex}
          position={actionMenuPosition}
          onSelect={executeAction}
          onClose={() => setShowActionMenu(false)}
        />
      )}
    </div>
  );
}
