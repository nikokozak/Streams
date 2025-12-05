import { useEffect, useState } from 'react';
import { bridge, Stream, StreamSummary } from './types';

type View = 'list' | 'stream';

export function App() {
  const [view, setView] = useState<View>('list');
  const [streams, setStreams] = useState<StreamSummary[]>([]);
  const [currentStream, setCurrentStream] = useState<Stream | null>(null);

  useEffect(() => {
    // Subscribe to bridge messages
    const unsubscribe = bridge.onMessage((message) => {
      switch (message.type) {
        case 'streamsLoaded':
          setStreams(message.payload?.streams as StreamSummary[]);
          break;
        case 'streamLoaded':
          setCurrentStream(message.payload?.stream as Stream);
          setView('stream');
          break;
      }
    });

    // Request initial data
    bridge.send({ type: 'loadStreams' });

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

  if (view === 'stream' && currentStream) {
    return (
      <StreamView
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
    />
  );
}

interface StreamListViewProps {
  streams: StreamSummary[];
  onSelect: (id: string) => void;
  onCreate: () => void;
}

function StreamListView({ streams, onSelect, onCreate }: StreamListViewProps) {
  return (
    <div className="stream-list">
      <header className="stream-list-header">
        <h1>Streams</h1>
        <button onClick={onCreate}>New Stream</button>
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

interface StreamViewProps {
  stream: Stream;
  onBack: () => void;
}

function StreamView({ stream, onBack }: StreamViewProps) {
  return (
    <div className="stream-view">
      <header className="stream-header">
        <button onClick={onBack}>← Back</button>
        <h1>{stream.title}</h1>
      </header>
      <div className="stream-content">
        {stream.cells.map((cell) => (
          <div key={cell.id} className="cell">
            {cell.content}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
