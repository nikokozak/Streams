import { useEffect, useState } from 'react';
import { bridge, Stream, StreamSummary } from './types';
import { StreamEditor } from './components/StreamEditor';
import { Settings } from './components/Settings';

type View = 'list' | 'stream' | 'settings';

export function App() {
  const [view, setView] = useState<View>('list');
  const [streams, setStreams] = useState<StreamSummary[]>([]);
  const [currentStream, setCurrentStream] = useState<Stream | null>(null);

  useEffect(() => {
    // Subscribe to bridge messages
    const unsubscribe = bridge.onMessage((message) => {
      switch (message.type) {
        case 'streamsLoaded':
          setStreams((message.payload?.streams as StreamSummary[]) || []);
          break;
        case 'streamLoaded':
          setCurrentStream(message.payload?.stream as Stream);
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
    bridge.send({ type: 'loadStream', payload: { id } });
  };

  const handleBackToList = () => {
    setCurrentStream(null);
    setView('list');
    bridge.send({ type: 'loadStreams' });
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
      />
    );
  }

  return (
    <StreamListView
      streams={streams}
      onSelect={handleSelectStream}
      onCreate={handleCreateStream}
      onSettings={handleOpenSettings}
    />
  );
}

interface StreamListViewProps {
  streams: StreamSummary[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onSettings: () => void;
}

function StreamListView({ streams, onSelect, onCreate, onSettings }: StreamListViewProps) {
  return (
    <div className="stream-list">
      <header className="stream-list-header">
        <h1>Streams</h1>
        <div className="stream-list-actions">
          <button onClick={onSettings} className="settings-button">
            Settings
          </button>
          <button onClick={onCreate}>New Stream</button>
        </div>
      </header>
      <div className="stream-list-content">
        {streams.length === 0 ? (
          <p className="empty-state">No streams yet. Create one to get started.</p>
        ) : (
          streams.map((stream) => (
            <button
              key={stream.id}
              className="stream-item"
              onClick={() => onSelect(stream.id)}
            >
              <span className="stream-title">{stream.title}</span>
              <span className="stream-meta">
                {stream.sourceCount} sources · {stream.cellCount} cells
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export default App;
