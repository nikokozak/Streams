import { Stream } from '../types';

interface UnifiedStreamEditorProps {
  stream: Stream;
  onBack: () => void;
  onDelete: () => void;
  onNavigateToStream?: (streamId: string, targetId: string, targetType?: 'cell' | 'source') => void;
  pendingCellId?: string | null;
  pendingSourceId?: string | null;
  onClearPendingCell?: () => void;
  onClearPendingSource?: () => void;
}

/**
 * Unified stream editor - single TipTap instance for the entire stream.
 * Enables true cross-cell text selection.
 *
 * This is a placeholder that will be implemented in subsequent slices.
 */
export function UnifiedStreamEditor({
  stream,
  onBack,
}: UnifiedStreamEditorProps) {
  return (
    <div className="stream-editor">
      <header className="stream-header">
        <button onClick={onBack} className="back-button">
          &larr; Back
        </button>
        <h1 className="stream-title-editable">{stream.title}</h1>
        <span className="stream-hint">Unified Editor (coming soon)</span>
      </header>

      <div className="stream-body">
        <div className="stream-content">
          <div style={{
            padding: '40px',
            textAlign: 'center',
            color: 'var(--color-text-secondary)',
          }}>
            <h2>Unified Editor</h2>
            <p>This editor will support cross-cell text selection.</p>
            <p style={{ fontSize: '14px', marginTop: '20px' }}>
              Stream: {stream.title} ({stream.cells.length} cells)
            </p>
            <p style={{ fontSize: '12px', marginTop: '10px', opacity: 0.6 }}>
              To disable: remove ?unified=true from URL or clear localStorage
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
