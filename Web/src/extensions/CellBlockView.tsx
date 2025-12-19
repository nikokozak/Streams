import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import { NodeViewProps } from '@tiptap/core';
import { useState } from 'react';
import { useBlockStore } from '../store/blockStore';
import { bridge } from '../types';

const IS_DEV = Boolean((import.meta as any).env?.DEV);

// Spinner SVG component for streaming/refreshing states
function Spinner() {
  return (
    <svg
      className="cell-block-spinner"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

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
 *
 * Slice 05: Subscribes to store for streaming/refreshing indicators.
 */
export function CellBlockView({ node, updateAttributes }: NodeViewProps) {
  const [isHovered, setIsHovered] = useState(false);

  const { id } = node.attrs;

  // IMPORTANT: node.attrs can be stale for dynamic data (type/model/live) because we don't
  // always update node attrs when store changes. Use store as source of truth for UI chrome.
  const cellType = useBlockStore((s) => (id ? s.getBlock(id)?.type : undefined)) ?? node.attrs.type;
  const modelId = useBlockStore((s) => (id ? s.getBlock(id)?.modelId : undefined)) ?? node.attrs.modelId;
  const processingTrigger = useBlockStore((s) => (id ? s.getBlock(id)?.processingConfig?.refreshTrigger : undefined));
  const isLive = processingTrigger === 'onStreamOpen';
  const hasDependencies = processingTrigger === 'onDependencyChange';

  const isAiBlock = cellType === 'aiResponse';

  // Subscribe to streaming/refreshing state for this cell
  const isStreaming = useBlockStore((s) => s.isStreaming(id));
  const isRefreshing = useBlockStore((s) => s.isRefreshing(id));
  const showSpinner = isStreaming || isRefreshing;

  const handleToggleLive = (nextIsLive: boolean) => {
    if (!id) return;
    const store = useBlockStore.getState();
    const cell = store.getBlock(id);
    if (!cell) return;

    const nextConfig = nextIsLive
      ? { ...cell.processingConfig, refreshTrigger: 'onStreamOpen' as const }
      : { ...cell.processingConfig, refreshTrigger: undefined };

    store.updateBlock(id, { processingConfig: nextConfig });

    // Keep node attrs roughly in sync for serialization/debugging.
    // (UI reads from store; attrs are secondary.)
    updateAttributes({
      isLive: nextIsLive,
      hasDependencies: false,
    });

    // Persist immediately — content didn't change, so debounced content saves won't fire.
    bridge.send({
      type: 'saveCell',
      payload: {
        id,
        streamId: cell.streamId,
        content: cell.content,
        type: cell.type,
        order: cell.order,
        originalPrompt: cell.originalPrompt,
        restatement: cell.restatement,
        modelId: cell.modelId,
        processingConfig: nextConfig,
        references: cell.references,
        blockName: cell.blockName,
        sourceApp: cell.sourceApp,
        modifiers: cell.modifiers,
        versions: cell.versions,
        activeVersionId: cell.activeVersionId,
        sourceBinding: cell.sourceBinding,
      },
    });
  };

  const handleInfoClick = () => {
    // TODO: Implement overlay opening via store or callback
    if (IS_DEV) {
      console.log('Info clicked for cell:', id);
    }
  };

  return (
    <NodeViewWrapper
      className={`cell-block-wrapper ${isHovered ? 'cell-block-wrapper--hovered' : ''} ${showSpinner ? 'cell-block-wrapper--streaming' : ''}`}
      data-cell-id={id}
      data-cell-type={cellType}
      data-streaming={showSpinner ? 'true' : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Top-right AI metadata badge (model + live toggle) */}
      {isAiBlock && !showSpinner && (
        <div className="cell-meta-badge" contentEditable={false}>
          <span className="cell-meta-badge-label" title={modelId || 'AI'}>
            {modelId || 'AI'}
          </span>
          <button
            className={`cell-meta-live-toggle ${isLive ? 'cell-meta-live-toggle--active' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleToggleLive(!isLive);
            }}
            title={isLive ? 'Live (click to disable)' : 'Click to make live'}
            type="button"
          >
            ⚡
          </button>
        </div>
      )}

      {/* Controls - left side, non-editable */}
      <div
        className={`cell-block-controls ${isHovered || showSpinner ? 'cell-block-controls--visible' : ''}`}
        contentEditable={false}
      >
        {/* Streaming/refreshing spinner */}
        {showSpinner && (
          <span className="cell-block-indicator cell-block-indicator--streaming" title={isStreaming ? 'AI is thinking...' : 'Refreshing...'}>
            <Spinner />
          </span>
        )}

        {/* Info button - only for AI cells when not streaming */}
        {isAiBlock && !showSpinner && (
          <button
            className="cell-block-info-button"
            type="button"
            onClick={handleInfoClick}
            title="View details"
          >
            <InfoIcon />
          </button>
        )}

        {/* Drag handle - TODO: implement drag reorder in later slice */}
        {!showSpinner && (
          <button
            className="cell-block-drag-handle"
            type="button"
            title="Drag to reorder"
          >
            <DragHandleIcon />
          </button>
        )}

        {/* Block type indicators */}
        {isLive && !showSpinner && (
          <span className="cell-block-indicator cell-block-indicator--live" title="Live block (refreshes on open)">
            ⚡
          </span>
        )}
        {hasDependencies && !showSpinner && (
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
