import { useEffect } from 'react';
import { SourceReference, bridge } from '../types';

interface UseSourceSyncOptions {
  streamId: string;
  setSources: React.Dispatch<React.SetStateAction<SourceReference[]>>;
}

/**
 * Handles source sync messages: sourceAdded, sourceRemoved
 */
export function useSourceSync({ streamId, setSources }: UseSourceSyncOptions) {
  useEffect(() => {
    const unsubscribe = bridge.onMessage((message) => {
      // Source added
      if (message.type === 'sourceAdded' && message.payload?.source) {
        const source = message.payload.source as SourceReference;
        if (source.streamId === streamId) {
          setSources(prev => [...prev, source]);
        }
      }

      // Source removed
      if (message.type === 'sourceRemoved' && message.payload?.id) {
        setSources(prev => prev.filter(s => s.id !== message.payload?.id));
      }
    });

    return unsubscribe;
  }, [streamId, setSources]);
}
