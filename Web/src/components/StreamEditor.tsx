import { useState, useRef, useCallback, useEffect } from 'react';
import { Stream, Cell as CellType, SourceReference, Modifier, CellVersion, bridge } from '../types';
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
  onDelete: () => void;
}

interface StreamingCell {
  id: string;
  content: string;
}

interface ModifyingCell {
  cellId: string;
  modifierId: string;
  content: string;
  prompt: string;
}

export function StreamEditor({ stream, onBack, onDelete }: StreamEditorProps) {
  const [cells, setCells] = useState<CellType[]>(stream.cells);
  const [sources, setSources] = useState<SourceReference[]>(stream.sources);
  const [title, setTitle] = useState(stream.title);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [newCellId, setNewCellId] = useState<string | null>(null);
  const [streamingCells, setStreamingCells] = useState<Map<string, StreamingCell>>(new Map());
  const [errorCells, setErrorCells] = useState<Map<string, string>>(new Map());
  const [modifyingCells, setModifyingCells] = useState<Map<string, ModifyingCell>>(new Map());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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

        // Use functional updates to avoid stale closures
        setStreamingCells(prevStreaming => {
          const rawContent = prevStreaming.get(cellId)?.content || '';
          // Convert markdown to HTML for TipTap
          const htmlContent = markdownToHtml(rawContent);

          // Update cell with final content and save
          setCells(prevCells => {
            const cell = prevCells.find(c => c.id === cellId);
            if (cell) {
              // Save to Swift (store as HTML)
              bridge.send({
                type: 'saveCell',
                payload: {
                  id: cellId,
                  streamId: stream.id,
                  content: htmlContent,
                  type: 'aiResponse',
                  order: cell.order,
                  originalPrompt: cell.originalPrompt,
                },
              });
            }
            return prevCells.map(c =>
              c.id === cellId ? { ...c, content: htmlContent, updatedAt: new Date().toISOString() } : c
            );
          });

          const updated = new Map(prevStreaming);
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

      // Modifier streaming updates
      if (message.type === 'modifierCreated' && message.payload?.cellId && message.payload?.modifier) {
        const cellId = message.payload.cellId as string;
        const modifier = message.payload.modifier as Modifier;
        console.log('[Modifier] Created:', { cellId, modifier });

        // Add the modifier to the cell
        setCells(prev => prev.map(c => {
          if (c.id !== cellId) return c;
          const existingModifiers = c.modifiers || [];
          return { ...c, modifiers: [...existingModifiers, modifier] };
        }));

        // Update the tracking entry with the modifier ID (prompt was already set in handleApplyModifier)
        setModifyingCells(prev => {
          const existing = prev.get(cellId);
          if (existing) {
            const updated = new Map(prev);
            updated.set(cellId, { ...existing, modifierId: modifier.id });
            return updated;
          }
          // Fallback if somehow not tracked
          return new Map(prev).set(cellId, {
            cellId,
            modifierId: modifier.id,
            content: '',
            prompt: modifier.prompt,
          });
        });
      }

      if (message.type === 'modifierChunk' && message.payload?.cellId && message.payload?.chunk) {
        const cellId = message.payload.cellId as string;
        const chunk = message.payload.chunk as string;
        console.log('[Modifier] Chunk:', { cellId, chunkLength: chunk.length });

        setModifyingCells(prev => {
          const updated = new Map(prev);
          const existing = updated.get(cellId);
          if (existing) {
            updated.set(cellId, { ...existing, content: existing.content + chunk });
          } else {
            console.warn('[Modifier] Chunk received but no modifying cell found for:', cellId);
          }
          return updated;
        });
      }

      if (message.type === 'modifierComplete' && message.payload?.cellId && message.payload?.modifierId) {
        const cellId = message.payload.cellId as string;
        const modifierId = message.payload.modifierId as string;
        console.log('[Modifier] Complete:', { cellId, modifierId });

        // Use functional updates to get current state and avoid stale closures
        setModifyingCells(prevModifying => {
          const modifying = prevModifying.get(cellId);
          console.log('[Modifier] Complete - modifying state:', { found: !!modifying, content: modifying?.content?.substring(0, 100) });
          if (!modifying) {
            console.warn('[Modifier] Complete but no modifying cell found for:', cellId);
            return prevModifying;
          }

          const rawContent = modifying.content;
          const htmlContent = markdownToHtml(rawContent);

          // Create new version with the modified content
          const newVersionId = crypto.randomUUID();
          const newVersion: CellVersion = {
            id: newVersionId,
            content: htmlContent,
            modifierIds: [modifierId],
            createdAt: new Date().toISOString(),
          };

          // Update cells with new version
          setCells(prevCells => {
            const cell = prevCells.find(c => c.id === cellId);
            if (!cell) return prevCells;

            // Get existing versions or create initial version from current content
            let existingVersions = cell.versions || [];
            if (existingVersions.length === 0 && cell.content) {
              existingVersions = [{
                id: crypto.randomUUID(),
                content: cell.content,
                modifierIds: [],
                createdAt: cell.createdAt,
              }];
            }

            const updatedVersions = [...existingVersions, newVersion];

            // Save to Swift
            bridge.send({
              type: 'saveCell',
              payload: {
                id: cellId,
                streamId: stream.id,
                content: htmlContent,
                type: cell.type,
                order: cell.order,
                modifiers: cell.modifiers,
                versions: updatedVersions,
                activeVersionId: newVersionId,
              },
            });

            return prevCells.map(c =>
              c.id === cellId
                ? {
                    ...c,
                    content: htmlContent,
                    versions: updatedVersions,
                    activeVersionId: newVersionId,
                    updatedAt: new Date().toISOString(),
                  }
                : c
            );
          });

          // Return updated modifying map with this cell removed
          const updated = new Map(prevModifying);
          updated.delete(cellId);
          return updated;
        });
      }

      if (message.type === 'modifierError' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        const error = message.payload.error as string;

        setErrorCells(prev => new Map(prev).set(cellId, error));
        setModifyingCells(prev => {
          const updated = new Map(prev);
          updated.delete(cellId);
          return updated;
        });
      }

    });
    return unsubscribe;
  }, [stream.id]);

  const handleSourceAdded = useCallback((source: SourceReference) => {
    setSources(prev => [...prev, source]);
  }, []);

  const handleSourceRemoved = useCallback((sourceId: string) => {
    setSources(prev => prev.filter(s => s.id !== sourceId));
  }, []);

  const handleCellUpdate = useCallback((cellId: string, content: string) => {
    setCells(prev => {
      const cell = prev.find(c => c.id === cellId);
      if (cell) {
        // Save to Swift with all fields preserved
        bridge.send({
          type: 'saveCell',
          payload: {
            id: cellId,
            streamId: stream.id,
            content,
            type: cell.type,
            order: cell.order,
            originalPrompt: cell.originalPrompt,
            modifiers: cell.modifiers,
            versions: cell.versions,
            activeVersionId: cell.activeVersionId,
          },
        });
      }
      return prev.map(c =>
        c.id === cellId ? { ...c, content, updatedAt: new Date().toISOString() } : c
      );
    });
  }, [stream.id]);

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

  // Apply a modifier to an AI cell
  const handleApplyModifier = useCallback((cellId: string, modifierPrompt: string) => {
    const cell = cells.find(c => c.id === cellId);
    if (!cell || cell.type !== 'aiResponse') return;

    // Clear any previous error
    setErrorCells(prev => {
      const updated = new Map(prev);
      updated.delete(cellId);
      return updated;
    });

    // Start tracking modifier immediately with the prompt (before server responds)
    setModifyingCells(prev => new Map(prev).set(cellId, {
      cellId,
      modifierId: '', // Will be set when modifierCreated is received
      content: '',
      prompt: modifierPrompt,
    }));

    // Send apply modifier request
    bridge.send({
      type: 'applyModifier',
      payload: {
        cellId,
        modifierPrompt,
        currentContent: stripHtml(cell.content),
      },
    });
  }, [cells]);

  // Select a specific version of an AI cell
  const handleSelectVersion = useCallback((cellId: string, versionId: string) => {
    console.log('[Version] Selecting version:', { cellId, versionId });
    setCells(prev => {
      const cell = prev.find(c => c.id === cellId);
      console.log('[Version] Found cell:', { cellId, hasVersions: !!cell?.versions, versionsCount: cell?.versions?.length });
      if (!cell || !cell.versions) return prev;

      const version = cell.versions.find(v => v.id === versionId);
      console.log('[Version] Found version:', { versionId, found: !!version, contentLength: version?.content?.length });
      if (!version) return prev;

      // Save to Swift
      bridge.send({
        type: 'saveCell',
        payload: {
          id: cellId,
          streamId: stream.id,
          content: version.content,
          type: cell.type,
          order: cell.order,
          modifiers: cell.modifiers,
          versions: cell.versions,
          activeVersionId: versionId,
        },
      });

      console.log('[Version] Updating cell content to version:', versionId);
      return prev.map(c =>
        c.id === cellId
          ? { ...c, content: version.content, activeVersionId: versionId }
          : c
      );
    });
  }, [stream.id]);

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
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="delete-stream-button"
          title="Delete stream"
        >
          Delete
        </button>
      </header>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="delete-confirm-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="delete-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Delete this stream?</h2>
            <p>This will permanently delete "{title}" and all its contents. This cannot be undone.</p>
            <div className="delete-confirm-actions">
              <button
                className="delete-confirm-cancel"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="delete-confirm-delete"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  onDelete();
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="stream-body">
        <div className="stream-content">
          {cells.map((cell, index) => {
            const isStreaming = streamingCells.has(cell.id);
            const isModifying = modifyingCells.has(cell.id);
            const modifyingData = modifyingCells.get(cell.id);
            const error = errorCells.get(cell.id);
            const streamingContent = streamingCells.get(cell.id)?.content;
            const modifyingContent = modifyingData?.content;

            // Convert streaming/modifying markdown to HTML for display
            let displayContent = cell.content;
            if (isStreaming && streamingContent) {
              displayContent = markdownToHtml(streamingContent);
            } else if (isModifying && modifyingContent) {
              displayContent = markdownToHtml(modifyingContent);
            }

            return (
              <div key={cell.id} data-cell-id={cell.id}>
                <Cell
                  cell={(isStreaming || isModifying) ? { ...cell, content: displayContent } : cell}
                  isNew={cell.id === newCellId}
                  isStreaming={isStreaming}
                  isModifying={isModifying}
                  pendingModifierPrompt={modifyingData?.prompt}
                  isOnlyCell={cells.length === 1}
                  error={error}
                  onUpdate={(content) => handleCellUpdate(cell.id, content)}
                  onDelete={() => handleCellDelete(cell.id)}
                  onEnter={() => handleCreateCell(index)}
                  onThink={() => handleThink(cell.id)}
                  onRegenerate={(newPrompt) => handleRegenerate(cell.id, newPrompt)}
                  onApplyModifier={(prompt) => handleApplyModifier(cell.id, prompt)}
                  onSelectVersion={(versionId) => handleSelectVersion(cell.id, versionId)}
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
