import { useState, useEffect } from 'react';
import { SourceReference, bridge } from '../types';

interface SourcePanelProps {
  streamId: string;
  sources: SourceReference[];
  onSourceAdded?: (source: SourceReference) => void;
  onSourceRemoved: (sourceId: string) => void;
}

export function SourcePanel({
  streamId,
  sources,
  onSourceRemoved,
}: SourcePanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);

  const handleAddSource = () => {
    setError(null);
    bridge.send({ type: 'addSource', payload: { streamId } });
  };

  const handleRemoveSource = (id: string) => {
    setError(null);
    setPendingRemoval(id);
    bridge.send({ type: 'removeSource', payload: { id } });
  };

  // Clear error after a few seconds
  const showError = (message: string) => {
    setError(message);
    setTimeout(() => setError(null), 5000);
  };

  // Listen for source events from bridge
  useEffect(() => {
    const unsubscribe = bridge.onMessage((message) => {
      if (message.type === 'sourceError' && message.payload?.error) {
        showError(message.payload.error as string);
      }
      // Handle successful removal confirmation
      if (message.type === 'sourceRemoved' && message.payload?.id) {
        const removedId = message.payload.id as string;
        setPendingRemoval(null);
        onSourceRemoved(removedId);
      }
      // Handle removal failure
      if (message.type === 'sourceRemoveError' && message.payload?.error) {
        setPendingRemoval(null);
        showError(message.payload.error as string);
      }
    });
    return unsubscribe;
  }, [onSourceRemoved]);

  return (
    <div className={`source-panel ${isCollapsed ? 'source-panel--collapsed' : ''}`}>
      <div className="source-panel-header">
        <button
          className="source-panel-toggle"
          onClick={() => setIsCollapsed(!isCollapsed)}
          title={isCollapsed ? 'Expand sources' : 'Collapse sources'}
        >
          {isCollapsed ? '◀' : '▶'}
        </button>
        {!isCollapsed && (
          <>
            <h3>Sources</h3>
            <button onClick={handleAddSource} className="add-source-button">
              + Add
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="source-error">{error}</div>
      )}

      {!isCollapsed && (
        <div className="source-list">
          {sources.length === 0 ? (
            <p className="source-empty">No sources attached</p>
          ) : (
            sources.map((source) => (
              <SourceItem
                key={source.id}
                source={source}
                isRemoving={pendingRemoval === source.id}
                onRemove={() => handleRemoveSource(source.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface SourceItemProps {
  source: SourceReference;
  isRemoving: boolean;
  onRemove: () => void;
}

function SourceItem({ source, isRemoving, onRemove }: SourceItemProps) {
  const icon = getFileIcon(source.fileType);
  const statusClass = `source-status--${source.status}`;
  const embeddingInfo = getEmbeddingInfo(source.embeddingStatus);

  return (
    <div className={`source-item ${statusClass} ${isRemoving ? 'source-item--removing' : ''}`}>
      <span className="source-icon">{icon}</span>
      <div className="source-info">
        <span className="source-name">{source.displayName}</span>
        <div className="source-meta-row">
          {source.pageCount && (
            <span className="source-meta">{source.pageCount} pages</span>
          )}
          {embeddingInfo && (
            <span
              className={`source-embedding-status source-embedding-status--${source.embeddingStatus}`}
              title={embeddingInfo.tooltip}
            >
              {embeddingInfo.label}
            </span>
          )}
        </div>
      </div>
      <button
        className="source-remove"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Remove source"
        disabled={isRemoving}
      >
        {isRemoving ? '…' : '×'}
      </button>
    </div>
  );
}

function getEmbeddingInfo(status: string): { label: string; tooltip: string } | null {
  switch (status) {
    case 'processing':
      return { label: 'Indexing…', tooltip: 'Creating semantic index for AI search' };
    case 'complete':
      return { label: 'Indexed', tooltip: 'Ready for semantic search' };
    case 'failed':
      return { label: 'Index failed', tooltip: 'Semantic indexing failed - full text will be used' };
    case 'unconfigured':
      return { label: 'Not indexed', tooltip: 'Add OpenAI API key in Settings to enable semantic search' };
    case 'none':
    default:
      return null;
  }
}

function getFileIcon(fileType: string): string {
  switch (fileType) {
    case 'pdf':
      return '📄';
    case 'text':
    case 'markdown':
      return '📝';
    case 'image':
      return '🖼';
    default:
      return '📎';
  }
}
