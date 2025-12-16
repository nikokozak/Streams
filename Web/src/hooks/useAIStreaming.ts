import { useEffect } from 'react';
import { bridge } from '../types';
import { markdownToHtml } from '../utils/markdown';
import { useBlockStore } from '../store/blockStore';
import { toast } from '../store/toastStore';

interface UseAIStreamingOptions {
  streamId: string;
}

/**
 * Handles AI streaming messages: aiChunk, aiComplete, aiError, modelSelected, restatementGenerated
 */
export function useAIStreaming({ streamId }: UseAIStreamingOptions) {
  const store = useBlockStore();

  useEffect(() => {
    const unsubscribe = bridge.onMessage((message) => {
      // AI streaming chunk
      if (message.type === 'aiChunk' && message.payload?.cellId && message.payload?.chunk) {
        const cellId = message.payload.cellId as string;
        const chunk = message.payload.chunk as string;
        store.appendStreamingContent(cellId, chunk);
      }

      // AI streaming complete
      if (message.type === 'aiComplete' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        const rawContent = store.getStreamingContent(cellId) || '';
        const preservedImages = store.getPreservedImages(cellId) || '';
        const htmlContent = markdownToHtml(rawContent);

        // Combine preserved images with AI response
        const finalContent = preservedImages + htmlContent;

        // Update cell with final content
        const cell = store.getBlock(cellId);
        if (cell) {
          store.updateBlock(cellId, { content: finalContent });

          // Save to Swift (include modelId if set, preserve sourceApp and references)
          bridge.send({
            type: 'saveCell',
            payload: {
              id: cellId,
              streamId,
              content: finalContent,
              type: 'aiResponse',
              order: cell.order,
              originalPrompt: cell.originalPrompt,
              modelId: cell.modelId,
              sourceApp: cell.sourceApp,
              references: cell.references,
            },
          });
        }

        store.completeStreaming(cellId);
      }

      // AI streaming error
      if (message.type === 'aiError' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        const error = message.payload.error as string;
        store.setError(cellId, error);
        store.completeStreaming(cellId);
        toast.error(`AI Error: ${error}`);
      }

      // Model selection (sent before streaming starts)
      if (message.type === 'modelSelected' && message.payload?.cellId && message.payload?.modelId) {
        const cellId = message.payload.cellId as string;
        const modelId = message.payload.modelId as string;
        store.updateBlock(cellId, { modelId });
      }

      // Restatement updates (heading form of original prompt)
      if (message.type === 'restatementGenerated' && message.payload?.cellId && message.payload?.restatement) {
        const cellId = message.payload.cellId as string;
        const restatement = message.payload.restatement as string;
        store.updateBlock(cellId, { restatement });
      }
    });

    return unsubscribe;
  }, [streamId, store]);
}
