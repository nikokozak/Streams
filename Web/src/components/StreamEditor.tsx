import { useRef, useCallback, useEffect, useState } from 'react';
import { Stream, Cell as CellType, SourceReference, Modifier, CellVersion, bridge } from '../types';
import { Cell } from './Cell';
import { BlockWrapper } from './BlockWrapper';
import { SourcePanel } from './SourcePanel';
import { ReferencePreview } from './ReferencePreview';
import { CellOverlay } from './CellOverlay';
import { markdownToHtml } from '../utils/markdown';
import { useBlockStore } from '../store/blockStore';
import { useBlockFocus } from '../hooks/useBlockFocus';

// Strip HTML tags to get plain text
function stripHtml(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

// Extract image HTML from content (returns array of <img> tags)
function extractImages(html: string): string[] {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const images = tmp.querySelectorAll('img');
  return Array.from(images).map(img => img.outerHTML);
}

// Build HTML block with images (for prepending to AI response)
function buildImageBlock(images: string[]): string {
  if (images.length === 0) return '';
  return `<div class="cell-images-block">${images.join('')}</div>`;
}

// Check if cell content is empty (for filtering spacing cells from context)
// Note: cells with only images are NOT considered empty
function isEmptyCell(content: string): boolean {
  // Check for images first - a cell with images is not empty
  if (content.includes('<img')) return false;
  return stripHtml(content).trim().length === 0;
}

interface StreamEditorProps {
  stream: Stream;
  onBack: () => void;
  onDelete: () => void;
}

export function StreamEditor({ stream, onBack, onDelete }: StreamEditorProps) {
  // Use Zustand store for block state
  const store = useBlockStore();

  // Local state for stream-level concerns
  const [sources, setSources] = useState<SourceReference[]>(stream.sources);
  const [title, setTitle] = useState(stream.title);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [overlayBlockId, setOverlayBlockId] = useState<string | null>(null);

  const cellFocusRefs = useRef<Map<string, () => void>>(new Map());
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Initialize store with stream data
  useEffect(() => {
    store.loadStream(stream.id, stream.cells);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.id]);

  // Create initial cell if stream is empty
  useEffect(() => {
    const blocks = store.getBlocksArray();
    if (store.streamId === stream.id && blocks.length === 0) {
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
      store.addBlock(initialCell);
      store.setNewBlockId(initialCell.id);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.streamId, stream.id]);

  // Track if we've done initial load (for pruning trailing empties only on load)
  const hasInitializedRef = useRef(false);

  // Ensure at least one trailing empty cell exists
  // - On initial load: prune extra trailing empty cells to just one
  // - During editing: only add if there's no trailing empty (user can create many by pressing Enter)
  useEffect(() => {
    if (store.streamId !== stream.id) return;

    const blocks = store.getBlocksArray();
    if (blocks.length === 0) return;

    // Count trailing empty cells
    let trailingEmptyCount = 0;
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (isEmptyCell(blocks[i].content) && blocks[i].type === 'text') {
        trailingEmptyCount++;
      } else {
        break;
      }
    }

    // If no trailing empty cell, add one (always, during editing or initial load)
    if (trailingEmptyCount === 0) {
      const lastBlock = blocks[blocks.length - 1];
      const newCell: CellType = {
        id: crypto.randomUUID(),
        streamId: stream.id,
        content: '',
        type: 'text',
        sourceBinding: null,
        order: lastBlock.order + 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.addBlock(newCell, lastBlock.id);
      bridge.send({
        type: 'saveCell',
        payload: {
          id: newCell.id,
          streamId: stream.id,
          content: '',
          type: 'text',
          order: newCell.order,
        },
      });
    }
    // Only prune extra trailing empty cells on initial load, not during editing
    // This allows users to create spacing by pressing Enter multiple times
    else if (trailingEmptyCount > 1 && !hasInitializedRef.current) {
      // Delete all but the last trailing empty cell
      for (let i = blocks.length - trailingEmptyCount; i < blocks.length - 1; i++) {
        const cellToDelete = blocks[i];
        store.deleteBlock(cellToDelete.id);
        bridge.send({ type: 'deleteCell', payload: { id: cellToDelete.id } });
      }
    }

    // Mark as initialized after first run
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.blocks, store.streamId, stream.id]);

  // Reset initialization flag when stream changes
  useEffect(() => {
    hasInitializedRef.current = false;
  }, [stream.id]);

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

      // Request for current stream ID (for native file drops)
      if (message.type === 'requestCurrentStreamId') {
        bridge.send({
          type: 'currentStreamId',
          payload: { streamId: stream.id }
        });
      }

      // AI streaming updates
      if (message.type === 'aiChunk' && message.payload?.cellId && message.payload?.chunk) {
        const cellId = message.payload.cellId as string;
        const chunk = message.payload.chunk as string;
        store.appendStreamingContent(cellId, chunk);
      }

      if (message.type === 'aiComplete' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        const rawContent = store.getStreamingContent(cellId) || '';
        const preservedImages = store.getPreservedImages(cellId) || '';
        const htmlContent = markdownToHtml(rawContent);

        // Combine preserved images with AI response
        const finalContent = preservedImages + htmlContent;

        // Update cell with final content
        const cell = store.getBlock(cellId);
        if (cell) {
          store.updateBlock(cellId, { content: finalContent });

          // Save to Swift (include modelId if set)
          bridge.send({
            type: 'saveCell',
            payload: {
              id: cellId,
              streamId: stream.id,
              content: finalContent,
              type: 'aiResponse',
              order: cell.order,
              originalPrompt: cell.originalPrompt,
              modelId: cell.modelId,
            },
          });
        }

        store.completeStreaming(cellId);
      }

      if (message.type === 'aiError' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        const error = message.payload.error as string;
        store.setError(cellId, error);
        store.completeStreaming(cellId);
      }

      // Model selection (sent before streaming starts)
      if (message.type === 'modelSelected' && message.payload?.cellId && message.payload?.modelId) {
        const cellId = message.payload.cellId as string;
        const modelId = message.payload.modelId as string;
        store.updateBlock(cellId, { modelId });
      }

      // Restatement updates (heading form of original prompt)
      if (message.type === 'restatementGenerated' && message.payload?.cellId && message.payload?.restatement) {
        const cellId = message.payload.cellId as string;
        const restatement = message.payload.restatement as string;
        store.updateBlock(cellId, { restatement });
      }

      // Modifier streaming updates
      if (message.type === 'modifierCreated' && message.payload?.cellId && message.payload?.modifier) {
        const cellId = message.payload.cellId as string;
        const modifier = message.payload.modifier as Modifier;
        console.log('[Modifier] Created:', { cellId, modifier });

        // Add the modifier to the cell
        const cell = store.getBlock(cellId);
        if (cell) {
          const existingModifiers = cell.modifiers || [];
          store.updateBlock(cellId, { modifiers: [...existingModifiers, modifier] });
        }

        // Update the tracking entry with the modifier ID
        store.setModifierId(cellId, modifier.id);
      }

      if (message.type === 'modifierChunk' && message.payload?.cellId && message.payload?.chunk) {
        const cellId = message.payload.cellId as string;
        const chunk = message.payload.chunk as string;
        console.log('[Modifier] Chunk:', { cellId, chunkLength: chunk.length });
        store.appendModifyingContent(cellId, chunk);
      }

      if (message.type === 'modifierComplete' && message.payload?.cellId && message.payload?.modifierId) {
        const cellId = message.payload.cellId as string;
        const modifierId = message.payload.modifierId as string;
        console.log('[Modifier] Complete:', { cellId, modifierId });

        const modifyingData = store.getModifyingData(cellId);
        if (!modifyingData) {
          console.warn('[Modifier] Complete but no modifying data found for:', cellId);
          return;
        }

        const rawContent = modifyingData.content;
        const htmlContent = markdownToHtml(rawContent);

        // Create new version with the modified content
        const newVersionId = crypto.randomUUID();
        const newVersion: CellVersion = {
          id: newVersionId,
          content: htmlContent,
          modifierIds: [modifierId],
          createdAt: new Date().toISOString(),
        };

        const cell = store.getBlock(cellId);
        if (!cell) {
          store.completeModifying(cellId);
          return;
        }

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

        // Update block
        store.updateBlock(cellId, {
          content: htmlContent,
          versions: updatedVersions,
          activeVersionId: newVersionId,
        });

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

        store.completeModifying(cellId);
      }

      if (message.type === 'modifierError' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        const error = message.payload.error as string;
        store.setError(cellId, error);
        store.completeModifying(cellId);
      }

      // Block refresh updates (live blocks, cascade updates)
      if (message.type === 'blockRefreshStart' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        console.log('[BlockRefresh] Start:', cellId);
        store.startRefreshing(cellId);
      }

      if (message.type === 'blockRefreshChunk' && message.payload?.cellId && message.payload?.chunk) {
        const cellId = message.payload.cellId as string;
        const chunk = message.payload.chunk as string;
        store.appendRefreshingContent(cellId, chunk);
      }

      if (message.type === 'blockRefreshComplete' && message.payload?.cellId && message.payload?.content) {
        const cellId = message.payload.cellId as string;
        const rawContent = message.payload.content as string;
        const htmlContent = markdownToHtml(rawContent);
        console.log('[BlockRefresh] Complete:', cellId);

        const cell = store.getBlock(cellId);
        if (cell) {
          store.updateBlock(cellId, { content: htmlContent });

          // Save refreshed content to Swift
          bridge.send({
            type: 'saveCell',
            payload: {
              id: cellId,
              streamId: stream.id,
              content: htmlContent,
              type: cell.type,
              order: cell.order,
              originalPrompt: cell.originalPrompt,
              processingConfig: cell.processingConfig,
              references: cell.references,
              blockName: cell.blockName,
            },
          });
        }

        store.completeRefreshing(cellId);
      }

      if (message.type === 'blockRefreshError' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        const error = message.payload.error as string;
        console.error('[BlockRefresh] Error:', cellId, error);
        store.setError(cellId, error);
        store.completeRefreshing(cellId);
      }
    });
    return unsubscribe;
  }, [stream.id, store]);

  const handleSourceAdded = useCallback((source: SourceReference) => {
    setSources(prev => [...prev, source]);
  }, []);

  const handleSourceRemoved = useCallback((sourceId: string) => {
    setSources(prev => prev.filter(s => s.id !== sourceId));
  }, []);

  const handleCellUpdate = useCallback((cellId: string, content: string) => {
    const cell = store.getBlock(cellId);
    if (cell) {
      store.updateBlock(cellId, { content });

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
  }, [stream.id, store]);

  // Cmd+Enter: Transform current cell into AI response
  const handleThink = useCallback((cellId: string) => {
    const cells = store.getBlocksArray();
    const cellIndex = cells.findIndex(c => c.id === cellId);
    const currentCell = cells[cellIndex];
    const originalPrompt = stripHtml(currentCell?.content || '').trim();
    if (!currentCell || !originalPrompt) return;

    // Extract images from the cell content - these will be preserved
    const images = extractImages(currentCell.content || '');
    const imageBlock = buildImageBlock(images);

    // Gather prior cells for context (exclude current cell and empty spacing cells)
    const priorCells = cells
      .slice(0, cellIndex)
      .filter(c => !isEmptyCell(c.content))
      .map(c => ({
        id: c.id,
        content: c.content,
        type: c.type,
      }));

    // Transform the current cell into an AI response
    // Keep images in content - they'll be prepended to the AI response
    store.updateBlock(cellId, {
      type: 'aiResponse',
      originalPrompt,
      content: imageBlock, // Preserve images, AI response will append
      restatement: undefined,
    });

    // Save transformed cell
    bridge.send({
      type: 'saveCell',
      payload: {
        id: cellId,
        streamId: stream.id,
        content: imageBlock,
        type: 'aiResponse',
        originalPrompt,
        order: currentCell.order,
      },
    });

    // Start streaming with preserved images
    store.startStreaming(cellId, imageBlock);
    store.clearError(cellId);

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
  }, [stream.id, store]);

  const handleCellDelete = useCallback((cellId: string) => {
    const cells = store.getBlocksArray();
    const index = cells.findIndex(c => c.id === cellId);
    if (index === -1) return;

    // Don't delete if it's the only cell
    if (cells.length === 1) return;

    store.deleteBlock(cellId);
    bridge.send({ type: 'deleteCell', payload: { id: cellId } });

    // Focus previous cell or next if deleting first
    const focusIndex = index > 0 ? index - 1 : 0;
    const focusId = cells[focusIndex]?.id;
    if (focusId && focusId !== cellId) {
      setTimeout(() => {
        cellFocusRefs.current.get(focusId)?.();
      }, 0);
    }
  }, [store]);

  // Block focus management for keyboard navigation
  const { focusedBlockId } = useBlockFocus({
    onDeleteBlock: handleCellDelete,
  });

  // When focusedBlockId changes (from keyboard nav), actually focus the DOM element
  useEffect(() => {
    if (focusedBlockId) {
      const focusFn = cellFocusRefs.current.get(focusedBlockId);
      if (focusFn) {
        focusFn();
      }
    }
  }, [focusedBlockId]);

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

    const cells = store.getBlocksArray();
    const afterId = cells[afterIndex]?.id;
    store.addBlock(newCell, afterId);
    store.setNewBlockId(newCell.id);

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
  }, [stream.id, store]);

  const handleFocusPrevious = useCallback((currentIndex: number) => {
    const cells = store.getBlocksArray();
    if (currentIndex > 0) {
      const prevId = cells[currentIndex - 1]?.id;
      if (prevId) {
        cellFocusRefs.current.get(prevId)?.();
      }
    }
  }, [store]);

  const handleFocusNext = useCallback((currentIndex: number) => {
    const cells = store.getBlocksArray();
    if (currentIndex < cells.length - 1) {
      const nextId = cells[currentIndex + 1]?.id;
      if (nextId) {
        cellFocusRefs.current.get(nextId)?.();
      }
    }
  }, [store]);

  const registerCellFocus = useCallback((cellId: string, focus: () => void) => {
    cellFocusRefs.current.set(cellId, focus);
  }, []);

  // Open overlay for a cell
  const handleOpenOverlay = useCallback((cellId: string) => {
    setOverlayBlockId(cellId);
  }, []);

  // Close overlay
  const handleCloseOverlay = useCallback(() => {
    setOverlayBlockId(null);
  }, []);

  // Select a version for a cell (used from overlay)
  const handleSelectVersion = useCallback((cellId: string, versionId: string) => {
    const cell = store.getBlock(cellId);
    if (!cell || !cell.versions) return;

    const version = cell.versions.find(v => v.id === versionId);
    if (!version) return;

    store.updateBlock(cellId, {
      content: version.content,
      activeVersionId: versionId,
    });

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
  }, [stream.id, store]);

  // Toggle live status for a cell
  const handleToggleLive = useCallback((cellId: string, isLive: boolean) => {
    const cell = store.getBlock(cellId);
    if (!cell) return;

    // Build the new processing config
    const newConfig = isLive
      ? { ...cell.processingConfig, refreshTrigger: 'onStreamOpen' as const }
      : { ...cell.processingConfig, refreshTrigger: undefined };

    // Update local state
    store.updateBlock(cellId, { processingConfig: newConfig });

    // Persist to backend
    bridge.send({
      type: 'saveCell',
      payload: {
        id: cellId,
        streamId: stream.id,
        content: cell.content,
        type: cell.type,
        order: cell.order,
        processingConfig: newConfig,
      },
    });
  }, [stream.id, store]);

  // Regenerate an AI cell with a new/edited prompt
  const handleRegenerate = useCallback((cellId: string, newPrompt: string) => {
    const cells = store.getBlocksArray();
    const cellIndex = cells.findIndex(c => c.id === cellId);
    const cell = cells[cellIndex];
    if (!cell || cell.type !== 'aiResponse') return;

    // Extract images from current cell content - preserve them across regeneration
    const images = extractImages(cell.content || '');
    const imageBlock = buildImageBlock(images);

    // Gather prior cells for context (exclude current cell and empty spacing cells)
    const priorCells = cells
      .slice(0, cellIndex)
      .filter(c => !isEmptyCell(c.content))
      .map(c => ({
        id: c.id,
        content: c.content,
        type: c.type,
      }));

    // Update the cell with new prompt, preserve images
    store.updateBlock(cellId, {
      originalPrompt: newPrompt,
      content: imageBlock, // Keep images
      restatement: undefined,
    });

    // Save updated cell
    bridge.send({
      type: 'saveCell',
      payload: {
        id: cellId,
        streamId: stream.id,
        content: imageBlock,
        type: 'aiResponse',
        originalPrompt: newPrompt,
        order: cell.order,
      },
    });

    // Start streaming with preserved images
    store.startStreaming(cellId, imageBlock);
    store.clearError(cellId);

    // Send think request with full context
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
  }, [stream.id, store]);

  // Scroll to a cell by ID (used for reference navigation)
  const handleScrollToCell = useCallback((cellId: string) => {
    // Find the cell element in the DOM
    const cellElement = document.querySelector(`[data-block-id="${cellId}"]`);
    if (cellElement) {
      // Scroll the cell into view
      cellElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Add a brief highlight animation
      cellElement.classList.add('block-wrapper--highlighted');
      setTimeout(() => {
        cellElement.classList.remove('block-wrapper--highlighted');
      }, 2000);

      // Focus the cell
      const focusFn = cellFocusRefs.current.get(cellId);
      if (focusFn) {
        setTimeout(() => focusFn(), 300); // Wait for scroll to complete
      }
    }
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

  // Get cells from store for rendering
  const cells = store.getBlocksArray();
  const newBlockId = store.newBlockId;

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
        <div
          className="stream-content"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
        >
          {cells.map((cell, index) => {
            const isStreaming = store.isStreaming(cell.id);
            const isRefreshing = store.isRefreshing(cell.id);
            const error = store.getError(cell.id);
            const streamingContent = store.getStreamingContent(cell.id);
            const refreshingContent = store.getRefreshingContent(cell.id);
            const preservedImages = store.getPreservedImages(cell.id);

            // Convert streaming/refreshing markdown to HTML for display
            // Prepend preserved images so they stay visible during streaming
            let displayContent = cell.content;
            if (isStreaming && streamingContent) {
              const imagesPrefix = preservedImages || '';
              displayContent = imagesPrefix + markdownToHtml(streamingContent);
            } else if (isRefreshing && refreshingContent) {
              displayContent = markdownToHtml(refreshingContent);
            }

            const showOverlay = overlayBlockId === cell.id;

            // Check if this is the first empty cell of an empty document (for showing placeholder)
            const isFirstEmptyCell = index === 0 &&
              cells.length === 1 &&
              isEmptyCell(cell.content) &&
              cell.type === 'text';

            return (
              <BlockWrapper
                key={cell.id}
                id={cell.id}
                onInfoClick={() => handleOpenOverlay(cell.id)}
              >
                <Cell
                  cell={(isStreaming || isRefreshing) ? { ...cell, content: displayContent } : cell}
                  isNew={cell.id === newBlockId}
                  isStreaming={isStreaming}
                  isRefreshing={isRefreshing}
                  isFirstEmptyCell={isFirstEmptyCell}
                  error={error}
                  onUpdate={(content) => handleCellUpdate(cell.id, content)}
                  onDelete={() => handleCellDelete(cell.id)}
                  onEnter={() => handleCreateCell(index)}
                  onThink={() => handleThink(cell.id)}
                  onFocusPrevious={() => handleFocusPrevious(index)}
                  onFocusNext={() => handleFocusNext(index)}
                  registerFocus={(focus) => registerCellFocus(cell.id, focus)}
                  onScrollToCell={handleScrollToCell}
                  onOpenOverlay={() => handleOpenOverlay(cell.id)}
                  onToggleLive={(isLive) => handleToggleLive(cell.id, isLive)}
                />
                {showOverlay && (
                  <CellOverlay
                    cell={cell}
                    onClose={handleCloseOverlay}
                    onSelectVersion={(versionId) => handleSelectVersion(cell.id, versionId)}
                    onScrollToCell={handleScrollToCell}
                    onToggleLive={(isLive) => handleToggleLive(cell.id, isLive)}
                    onRegenerate={(newPrompt) => handleRegenerate(cell.id, newPrompt)}
                  />
                )}
              </BlockWrapper>
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

      {/* Global reference preview tooltip */}
      <ReferencePreview onScrollToCell={handleScrollToCell} />
    </div>
  );
}
