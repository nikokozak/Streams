import { useEffect, useState } from 'react';
import { bridge, Stream, StreamSummary } from './types';
import { StreamEditor } from './components/StreamEditor';
import { Settings } from './components/Settings';
import { useBlockStore } from './store/blockStore';

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
    return (
      <StreamEditor
        stream={currentStream}
        onBack={handleBackToList}
        onDelete={handleDeleteStream}
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

function StreamListView({ streams, isLoading, isLoadingStream, onSelect, onCreate, onSettings }: StreamListViewProps) {
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
          streams.map((stream) => (
            <button
              key={stream.id}
              className={`stream-item ${isLoadingStream ? 'stream-item--loading' : ''}`}
              onClick={() => onSelect(stream.id)}
              disabled={isLoadingStream}
            >
              <span className="stream-title">{stream.title}</span>
              <span className="stream-meta">
                {stream.sourceCount} {stream.sourceCount === 1 ? 'source' : 'sources'} · {stream.cellCount} {stream.cellCount === 1 ? 'cell' : 'cells'}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export default App;
