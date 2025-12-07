import { useState, useRef, ReactNode } from 'react';
import { useBlockStore } from '../store/blockStore';
import { bridge } from '../types';

interface BlockWrapperProps {
  id: string;
  children: ReactNode;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

/**
 * Wrapper component that adds hover controls and drag handle to blocks
 * Provides a Notion-like interaction feel
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
    e.dataTransfer.setData('text/plain', id);
    setIsDragging(true);
    onDragStart?.();
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    onDragEnd?.();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId && draggedId !== id) {
      const fromIdx = store.getBlockIndex(draggedId);
      const toIdx = store.getBlockIndex(id);
      if (fromIdx !== -1 && toIdx !== -1) {
        store.reorderBlocks(fromIdx, toIdx);

        // Persist new order to database
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
    }
  };

  // Show processing indicator if block has live config
  const isLiveBlock = block?.processingConfig?.refreshTrigger === 'onStreamOpen';
  const hasDependencies = block?.processingConfig?.refreshTrigger === 'onDependencyChange';

  return (
    <div
      ref={wrapperRef}
      className={`block-wrapper ${isDragging ? 'block-wrapper--dragging' : ''} ${isHovered ? 'block-wrapper--hovered' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Hover controls - shown on left side */}
      <div className={`block-controls ${isHovered ? 'block-controls--visible' : ''}`}>
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
