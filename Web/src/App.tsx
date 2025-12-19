import { useEffect, useState } from 'react';
import { bridge, Stream, StreamSummary } from './types';
import { StreamEditor } from './components/StreamEditor';
import { UnifiedStreamEditor } from './components/UnifiedStreamEditor';
import { Settings } from './components/Settings';
import { useBlockStore } from './store/blockStore';
import { isUnifiedEditorEnabled } from './utils/featureFlags';

type View = 'list' | 'stream' | 'settings';

export function App() {
  const [view, setView] = useState<View>('list');
  const [streams, setStreams] = useState<StreamSummary[]>([]);
  const [currentStream, setCurrentStream] = useState<Stream | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingStream, setIsLoadingStream] = useState(false);
  const clearStream = useBlockStore((state) => state.clearStream);

  useEffect(() => {
    // Subscribe to bridge messages
    const unsubscribe = bridge.onMessage((message) => {
      switch (message.type) {
        case 'streamsLoaded':
          setStreams((message.payload?.streams as StreamSummary[]) || []);
          setIsLoading(false);
          break;
        case 'streamLoaded':
          setCurrentStream(message.payload?.stream as Stream);
          setIsLoadingStream(false);
          setView('stream');
          break;
        case 'streamCreated':
          // Quick Panel created a new stream - add to list and switch to it
          if (message.payload?.stream) {
            const newStream = message.payload.stream as Stream;
            console.log('[App] Stream created via Quick Panel:', newStream.id);
            setCurrentStream(newStream);
            setView('stream');
            // Also add to streams list
            setStreams(prev => [{
              id: newStream.id,
              title: newStream.title,
              sourceCount: 0,
              cellCount: 0,
              updatedAt: newStream.updatedAt,
              previewText: null
            }, ...prev]);
          }
          break;
        case 'quickPanelCellsAdded':
          // Quick Panel added cells - if it's a new stream, load it and update list
          if (message.payload?.isNewStream && message.payload?.streamId) {
            const streamId = message.payload.streamId as string;
            const cellCount = (message.payload.cells as unknown[])?.length || 0;
            console.log('[App] Quick Panel created new stream with cells:', streamId);

            // Add to streams list so it appears when navigating back
            setStreams(prev => {
              // Avoid duplicates
              if (prev.some(s => s.id === streamId)) return prev;
              return [{
                id: streamId,
                title: 'Untitled',
                sourceCount: 0,
                cellCount,
                updatedAt: new Date().toISOString(),
                previewText: null
              }, ...prev];
            });

            // Load the stream from DB - cells are already saved
            bridge.send({ type: 'loadStream', payload: { id: streamId } });
          }
          break;
      }
    });

    // Request initial data after a short delay to ensure bridge is ready
    setTimeout(() => {
      bridge.send({ type: 'loadStreams' });
    }, 100);

    return unsubscribe;
  }, []);

  const handleCreateStream = () => {
    bridge.send({ type: 'createStream' });
  };

  const handleSelectStream = (id: string) => {
    setIsLoadingStream(true);
    bridge.send({ type: 'loadStream', payload: { id } });
  };

  const handleBackToList = () => {
    clearStream();
    setCurrentStream(null);
    setView('list');
    bridge.send({ type: 'loadStreams' });
  };

  const handleDeleteStream = () => {
    if (currentStream) {
      bridge.send({ type: 'deleteStream', payload: { id: currentStream.id } });
      clearStream();
      setCurrentStream(null);
      setView('list');
    }
  };

  // Navigate to a different stream and scroll to a specific cell or source
  const [pendingCellId, setPendingCellId] = useState<string | null>(null);
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);

  const handleNavigateToStream = (streamId: string, targetId: string, targetType: 'cell' | 'source' = 'cell') => {
    if (targetType === 'source') {
      setPendingSourceId(targetId);
      setPendingCellId(null);
    } else {
      setPendingCellId(targetId);
      setPendingSourceId(null);
    }
    setIsLoadingStream(true);
    bridge.send({ type: 'loadStream', payload: { id: streamId } });
  };

  const handleOpenSettings = () => {
    setView('settings');
  };

  const handleCloseSettings = () => {
    setView('list');
  };

  if (view === 'settings') {
    return <Settings onClose={handleCloseSettings} />;
  }

  if (view === 'stream' && currentStream) {
    // Feature flag: use unified editor for cross-cell selection support
    const EditorComponent = isUnifiedEditorEnabled() ? UnifiedStreamEditor : StreamEditor;

    return (
      <EditorComponent
        stream={currentStream}
        onBack={handleBackToList}
        onDelete={handleDeleteStream}
        onNavigateToStream={handleNavigateToStream}
        pendingCellId={pendingCellId}
        pendingSourceId={pendingSourceId}
        onClearPendingCell={() => setPendingCellId(null)}
        onClearPendingSource={() => setPendingSourceId(null)}
      />
    );
  }

  return (
    <StreamListView
      streams={streams}
      isLoading={isLoading}
      isLoadingStream={isLoadingStream}
      onSelect={handleSelectStream}
      onCreate={handleCreateStream}
      onSettings={handleOpenSettings}
    />
  );
}

interface StreamListViewProps {
  streams: StreamSummary[];
  isLoading: boolean;
  isLoadingStream: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onSettings: () => void;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function StreamListView({ streams, isLoading, isLoadingStream, onSelect, onCreate, onSettings }: StreamListViewProps) {
  // Sort streams by updatedAt (most recent first)
  const sortedStreams = [...streams].sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <div className="stream-list">
      <header className="stream-list-header">
        <h1>Streams</h1>
        <div className="stream-list-actions">
          <button onClick={onSettings} className="settings-button">
            Settings
          </button>
          <button onClick={onCreate} className="primary-button">New Stream</button>
        </div>
      </header>
      <div className="stream-list-content">
        {isLoading ? (
          <div className="loading-state">
            <div className="loading-spinner" />
            <p>Loading...</p>
          </div>
        ) : streams.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📝</div>
            <h2>No streams yet</h2>
            <p>Create a stream to start capturing your thoughts.</p>
            <button onClick={onCreate} className="primary-button">Create your first stream</button>
          </div>
        ) : (
          sortedStreams.map((stream) => (
            <button
              key={stream.id}
              className={`stream-item ${isLoadingStream ? 'stream-item--loading' : ''}`}
              onClick={() => onSelect(stream.id)}
              disabled={isLoadingStream}
            >
              <span className="stream-title">{stream.title}</span>
              <span className="stream-meta">
                {formatRelativeTime(stream.updatedAt)} · {stream.sourceCount} {stream.sourceCount === 1 ? 'source' : 'sources'} · {stream.cellCount} {stream.cellCount === 1 ? 'cell' : 'cells'}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export default App;
