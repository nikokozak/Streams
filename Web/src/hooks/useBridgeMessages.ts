import { useState, useEffect } from 'react';
import { SourceReference } from '../types';
import { useAIStreaming } from './useAIStreaming';
import { useModifierStreaming } from './useModifierStreaming';
import { useBlockRefresh } from './useBlockRefresh';
import { useSourceSync } from './useSourceSync';
import { useQuickPanelSync } from './useQuickPanelSync';

interface UseBridgeMessagesOptions {
  streamId: string;
  initialSources: SourceReference[];
}

/**
 * Orchestrator hook that composes all bridge message handlers
 * Each sub-hook handles a specific domain of messages
 */
export function useBridgeMessages({ streamId, initialSources }: UseBridgeMessagesOptions) {
  const [sources, setSources] = useState<SourceReference[]>(initialSources);

  // Update sources when initialSources changes (stream switch)
  useEffect(() => {
    setSources(initialSources);
  }, [initialSources]);

  // Compose all sub-hooks
  useAIStreaming({ streamId });
  useModifierStreaming({ streamId });
  useBlockRefresh({ streamId });
  useSourceSync({ streamId, setSources });
  useQuickPanelSync({ streamId });

  return {
    sources,
    setSources,
  };
}
