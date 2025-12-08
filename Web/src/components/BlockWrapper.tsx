import { useState, useRef, ReactNode, useEffect } from 'react';
import { useBlockStore } from '../store/blockStore';
import { bridge } from '../types';

// Global drag state to coordinate between BlockWrappers
let globalDraggedId: string | null = null;
let lastReorderTime = 0;

interface BlockWrapperProps {
  id: string;
  children: ReactNode;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

/**
 * Wrapper component that adds hover controls and drag handle to blocks
 * Provides a Notion-like interaction feel with live reordering during drag
 */
export function BlockWrapper({
  id,
  children,
  onDragStart,
  onDragEnd,
}: BlockWrapperProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const store = useBlockStore();
  const block = store.getBlock(id);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-block-id', id);
    globalDraggedId = id;
    setIsDragging(true);
    onDragStart?.();
  };

  const handleDragEnd = () => {
    // Persist final order to database
    if (globalDraggedId) {
      const { streamId, blockOrder } = useBlockStore.getState();
      if (streamId) {
        const orders = blockOrder.map((blockId, idx) => ({
          id: blockId,
          order: idx,
        }));
        bridge.send({
          type: 'reorderBlocks',
          payload: { streamId, orders },
        });
      }
    }
    globalDraggedId = null;
    setIsDragging(false);
    onDragEnd?.();
  };

  const handleDragOver = (e: React.DragEvent) => {
    // Only handle our block drags, not text drags
    if (!globalDraggedId || globalDraggedId === id) return;

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    // Live reorder as user drags (throttled)
    const now = Date.now();
    if (now - lastReorderTime > 100) {
      lastReorderTime = now;
      const fromIdx = store.getBlockIndex(globalDraggedId);
      const toIdx = store.getBlockIndex(id);
      if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
        store.reorderBlocks(fromIdx, toIdx);
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Clear drag state immediately to prevent "return" animation
    globalDraggedId = null;
  };

  // Prevent ProseMirror from handling our block drags
  // We attach to the .block-content child to stop events before they reach TipTap
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const blockContent = wrapper?.querySelector('.block-content');
    if (!blockContent) return;

    const preventEditorDrag = (e: Event) => {
      if (globalDraggedId) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Only intercept on the content area (where TipTap lives), not the whole wrapper
    blockContent.addEventListener('drop', preventEditorDrag, true);
    blockContent.addEventListener('dragover', preventEditorDrag, true);
    blockContent.addEventListener('dragenter', preventEditorDrag, true);
    return () => {
      blockContent.removeEventListener('drop', preventEditorDrag, true);
      blockContent.removeEventListener('dragover', preventEditorDrag, true);
      blockContent.removeEventListener('dragenter', preventEditorDrag, true);
    };
  }, []);

  // Show processing indicator if block has live config
  const isLiveBlock = block?.processingConfig?.refreshTrigger === 'onStreamOpen';
  const hasDependencies = block?.processingConfig?.refreshTrigger === 'onDependencyChange';

  return (
    <div
      ref={wrapperRef}
      data-block-id={id}
      className={`block-wrapper ${isDragging ? 'block-wrapper--dragging' : ''} ${isHovered ? 'block-wrapper--hovered' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Hover controls - shown on left side */}
      <div className={`block-controls ${isHovered && !globalDraggedId ? 'block-controls--visible' : ''}`}>
        {/* Drag handle */}
        <button
          className="block-drag-handle"
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          title="Drag to reorder"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <circle cx="4" cy="3" r="1.5" />
            <circle cx="10" cy="3" r="1.5" />
            <circle cx="4" cy="7" r="1.5" />
            <circle cx="10" cy="7" r="1.5" />
            <circle cx="4" cy="11" r="1.5" />
            <circle cx="10" cy="11" r="1.5" />
          </svg>
        </button>

        {/* Block type indicators */}
        {isLiveBlock && (
          <span className="block-indicator block-indicator--live" title="Live block (refreshes on open)">
            ⚡
          </span>
        )}
        {hasDependencies && (
          <span className="block-indicator block-indicator--dependent" title="Updates when dependencies change">
            🔗
          </span>
        )}
      </div>

      {/* Block content */}
      <div className="block-content">
        {children}
      </div>
    </div>
  );
}
