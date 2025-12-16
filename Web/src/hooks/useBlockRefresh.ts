import { useEffect } from 'react';
import { bridge } from '../types';
import { markdownToHtml } from '../utils/markdown';
import { useBlockStore } from '../store/blockStore';
import { toast } from '../store/toastStore';

interface UseBlockRefreshOptions {
  streamId: string;
}

/**
 * Handles block refresh messages: blockRefreshStart, blockRefreshChunk, blockRefreshComplete, blockRefreshError
 */
export function useBlockRefresh({ streamId }: UseBlockRefreshOptions) {
  const store = useBlockStore();

  useEffect(() => {
    const unsubscribe = bridge.onMessage((message) => {
      // Block refresh start
      if (message.type === 'blockRefreshStart' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        console.log('[BlockRefresh] Start:', cellId);
        store.startRefreshing(cellId);
      }

      // Block refresh chunk
      if (message.type === 'blockRefreshChunk' && message.payload?.cellId && message.payload?.chunk) {
        const cellId = message.payload.cellId as string;
        const chunk = message.payload.chunk as string;
        store.appendRefreshingContent(cellId, chunk);
      }

      // Block refresh complete
      if (message.type === 'blockRefreshComplete' && message.payload?.cellId && message.payload?.content) {
        const cellId = message.payload.cellId as string;
        const rawContent = message.payload.content as string;
        const htmlContent = markdownToHtml(rawContent);
        console.log('[BlockRefresh] Complete:', cellId);

        const cell = store.getBlock(cellId);
        if (cell) {
          store.updateBlock(cellId, { content: htmlContent });

          // Save refreshed content to Swift (preserve all metadata)
          bridge.send({
            type: 'saveCell',
            payload: {
              id: cellId,
              streamId,
              content: htmlContent,
              type: cell.type,
              order: cell.order,
              originalPrompt: cell.originalPrompt,
              restatement: cell.restatement,
              modelId: cell.modelId,
              processingConfig: cell.processingConfig,
              references: cell.references,
              blockName: cell.blockName,
              sourceApp: cell.sourceApp,
            },
          });
        }

        store.completeRefreshing(cellId);
      }

      // Block refresh error
      if (message.type === 'blockRefreshError' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        const error = message.payload.error as string;
        console.error('[BlockRefresh] Error:', cellId, error);
        store.setError(cellId, error);
        store.completeRefreshing(cellId);
        toast.error(`Refresh Error: ${error}`);
      }
    });

    return unsubscribe;
  }, [streamId, store]);
}
