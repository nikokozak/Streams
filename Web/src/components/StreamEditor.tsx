import { useState, useRef, useCallback } from 'react';
import { Stream, Cell as CellType, bridge } from '../types';
import { Cell } from './Cell';

interface StreamEditorProps {
  stream: Stream;
  onBack: () => void;
}

export function StreamEditor({ stream, onBack }: StreamEditorProps) {
  const [cells, setCells] = useState<CellType[]>(stream.cells);
  const [newCellId, setNewCellId] = useState<string | null>(null);
  const cellFocusRefs = useRef<Map<string, () => void>>(new Map());

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

      <div className="stream-content">
        {cells.map((cell, index) => (
          <Cell
            key={cell.id}
            cell={cell}
            isNew={cell.id === newCellId}
            onUpdate={(content) => handleCellUpdate(cell.id, content)}
            onDelete={() => handleCellDelete(cell.id)}
            onEnter={() => handleCreateCell(index)}
            onFocusPrevious={() => handleFocusPrevious(index)}
            onFocusNext={() => handleFocusNext(index)}
            registerFocus={(focus) => registerCellFocus(cell.id, focus)}
          />
        ))}
      </div>
    </div>
  );
}
