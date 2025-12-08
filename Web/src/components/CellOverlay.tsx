import { useEffect, useRef, useCallback } from 'react';
import { Cell } from '../types';
import { VersionDropdown } from './VersionDropdown';
import { useBlockStore } from '../store/blockStore';

interface CellOverlayProps {
  cell: Cell;
  onClose: () => void;
  onSelectVersion?: (versionId: string) => void;
  onScrollToCell?: (cellId: string) => void;
  onToggleLive?: (isLive: boolean) => void;
}

/**
 * Frosted glass overlay showing cell metadata:
 * - Original prompt (editable)
 * - Model used and timestamp
 * - Live status indicator
 * - Cells that reference this cell
 * - Version history dropdown
 */
export function CellOverlay({
  cell,
  onClose,
  onSelectVersion,
  onScrollToCell,
  onToggleLive,
}: CellOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const blocks = useBlockStore((state) => state.blocks);

  // Find cells that reference this cell
  const referencingCells = Object.values(blocks).filter((block) => {
    if (!block.references || block.id === cell.id) return false;
    return block.references.includes(cell.id);
  });

  // Close on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use timeout to avoid immediate close from the click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const handleReferenceClick = useCallback(
    (cellId: string) => {
      if (onScrollToCell) {
        onScrollToCell(cellId);
        onClose();
      }
    },
    [onScrollToCell, onClose]
  );

  const handleVersionSelect = useCallback(
    (versionId: string) => {
      if (onSelectVersion) {
        onSelectVersion(versionId);
      }
    },
    [onSelectVersion]
  );

  // Format timestamp
  const formatDate = (timestamp?: string) => {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Get metadata from cell
  const timestamp = cell.updatedAt || cell.createdAt;
  const modelId = cell.modelId;
  const isLive = cell.processingConfig?.refreshTrigger === 'onStreamOpen';
  const hasDependencyRefresh = cell.processingConfig?.refreshTrigger === 'onDependencyChange';
  const versions = cell.versions || [];

  return (
    <div className="cell-overlay" ref={overlayRef}>
      {/* Header with close button */}
      <div className="cell-overlay-header">
        <span className="cell-overlay-title">Cell Details</span>
        <button className="cell-overlay-close" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Original prompt */}
      {cell.originalPrompt && (
        <div className="cell-overlay-section">
          <div className="cell-overlay-label">Original Prompt</div>
          <div className="cell-overlay-prompt">{cell.originalPrompt}</div>
        </div>
      )}

      {/* Metadata row */}
      <div className="cell-overlay-section">
        <div className="cell-overlay-meta">
          {modelId && (
            <>
              <span className="cell-overlay-model">{modelId}</span>
              <span className="cell-overlay-separator">·</span>
            </>
          )}
          <span className="cell-overlay-time">{formatDate(timestamp)}</span>
          {isLive && (
            <>
              <span className="cell-overlay-separator">·</span>
              <span className="cell-overlay-live" title="Refreshes when stream opens">
                Live
              </span>
            </>
          )}
          {hasDependencyRefresh && (
            <>
              <span className="cell-overlay-separator">·</span>
              <span className="cell-overlay-dependency" title="Updates when dependencies change">
                Auto-refresh
              </span>
            </>
          )}
        </div>
      </div>

      {/* Live toggle */}
      {cell.type === 'aiResponse' && (
        <div className="cell-overlay-section">
          <div className="cell-overlay-label">Live Refresh</div>
          <button
            className={`cell-overlay-live-toggle ${isLive ? 'cell-overlay-live-toggle--active' : ''}`}
            onClick={() => onToggleLive?.(!isLive)}
          >
            <span className="cell-overlay-live-icon">⚡</span>
            <span className="cell-overlay-live-text">
              {isLive ? 'Live — refreshes when stream opens' : 'Not live — click to enable'}
            </span>
          </button>
        </div>
      )}

      {/* Referencing cells */}
      {referencingCells.length > 0 && (
        <div className="cell-overlay-section">
          <div className="cell-overlay-label">Referenced by</div>
          <div className="cell-overlay-references">
            {referencingCells.map((refCell) => (
              <button
                key={refCell.id}
                className="cell-overlay-ref-link"
                onClick={() => handleReferenceClick(refCell.id)}
              >
                {refCell.blockName || refCell.restatement || `Block ${refCell.id.slice(0, 4)}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Version history */}
      {versions.length > 1 && (
        <div className="cell-overlay-section">
          <div className="cell-overlay-label">Version History</div>
          <VersionDropdown
            versions={versions}
            activeVersionId={cell.activeVersionId}
            onSelectVersion={handleVersionSelect}
          />
        </div>
      )}
    </div>
  );
}
