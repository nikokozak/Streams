import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import { NodeViewProps } from '@tiptap/core';
import { useState } from 'react';

// Info icon SVG component (copied from BlockWrapper)
function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

// Drag handle SVG component
function DragHandleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <circle cx="4" cy="3" r="1.5" />
      <circle cx="10" cy="3" r="1.5" />
      <circle cx="4" cy="7" r="1.5" />
      <circle cx="10" cy="7" r="1.5" />
      <circle cx="4" cy="11" r="1.5" />
      <circle cx="10" cy="11" r="1.5" />
    </svg>
  );
}

/**
 * CellBlockView - React NodeView for rendering cell blocks.
 *
 * Renders controls similar to BlockWrapper (info button, drag handle, live indicators)
 * with NodeViewContent for the editable content area.
 *
 * Controls use contentEditable={false} to not interfere with text selection.
 */
export function CellBlockView({ node }: NodeViewProps) {
  const [isHovered, setIsHovered] = useState(false);

  const { id, type, isLive, hasDependencies } = node.attrs;
  const isAiBlock = type === 'aiResponse';

  const handleInfoClick = () => {
    // TODO: Implement overlay opening via store or callback
    console.log('Info clicked for cell:', id);
  };

  return (
    <NodeViewWrapper
      className={`cell-block-wrapper ${isHovered ? 'cell-block-wrapper--hovered' : ''}`}
      data-cell-id={id}
      data-cell-type={type}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Controls - left side, non-editable */}
      <div
        className={`cell-block-controls ${isHovered ? 'cell-block-controls--visible' : ''}`}
        contentEditable={false}
      >
        {/* Info button - only for AI cells */}
        {isAiBlock && (
          <button
            className="cell-block-info-button"
            onClick={handleInfoClick}
            title="View details"
          >
            <InfoIcon />
          </button>
        )}

        {/* Drag handle - TODO: implement drag reorder in later slice */}
        <button
          className="cell-block-drag-handle"
          title="Drag to reorder"
        >
          <DragHandleIcon />
        </button>

        {/* Block type indicators */}
        {isLive && (
          <span className="cell-block-indicator cell-block-indicator--live" title="Live block (refreshes on open)">
            ⚡
          </span>
        )}
        {hasDependencies && (
          <span className="cell-block-indicator cell-block-indicator--dependent" title="Updates when dependencies change">
            🔗
          </span>
        )}
      </div>

      {/* Content area - editable */}
      <NodeViewContent className="cell-block-content" />
    </NodeViewWrapper>
  );
}
