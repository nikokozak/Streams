import { useState, useEffect } from 'react';
import { SourceReference, Modifier, CellVersion, bridge } from '../types';
import { markdownToHtml } from '../utils/markdown';
import { useBlockStore } from '../store/blockStore';

interface UseBridgeMessagesOptions {
  streamId: string;
  initialSources: SourceReference[];
}

/**
 * Hook to handle all bridge messages from Swift backend
 * Manages AI streaming, modifiers, refresh, and source updates
 */
export function useBridgeMessages({ streamId, initialSources }: UseBridgeMessagesOptions) {
  const store = useBlockStore();
  const [sources, setSources] = useState<SourceReference[]>(initialSources);

  // Update sources when initialSources changes (stream switch)
  useEffect(() => {
    setSources(initialSources);
  }, [initialSources]);

  useEffect(() => {
    const unsubscribe = bridge.onMessage((message) => {
      // Source updates
      if (message.type === 'sourceAdded' && message.payload?.source) {
        const source = message.payload.source as SourceReference;
        if (source.streamId === streamId) {
          setSources(prev => [...prev, source]);
        }
      }
      if (message.type === 'sourceRemoved' && message.payload?.id) {
        setSources(prev => prev.filter(s => s.id !== message.payload?.id));
      }

      // Request for current stream ID (for native file drops)
      if (message.type === 'requestCurrentStreamId') {
        bridge.send({
          type: 'currentStreamId',
          payload: { streamId }
        });
      }

      // AI streaming updates
      if (message.type === 'aiChunk' && message.payload?.cellId && message.payload?.chunk) {
        const cellId = message.payload.cellId as string;
        const chunk = message.payload.chunk as string;
        store.appendStreamingContent(cellId, chunk);
      }

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

          // Save to Swift (include modelId if set)
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
            },
          });
        }

        store.completeStreaming(cellId);
      }

      if (message.type === 'aiError' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        const error = message.payload.error as string;
        store.setError(cellId, error);
        store.completeStreaming(cellId);
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

      // Modifier streaming updates
      if (message.type === 'modifierCreated' && message.payload?.cellId && message.payload?.modifier) {
        const cellId = message.payload.cellId as string;
        const modifier = message.payload.modifier as Modifier;
        console.log('[Modifier] Created:', { cellId, modifier });

        // Add the modifier to the cell
        const cell = store.getBlock(cellId);
        if (cell) {
          const existingModifiers = cell.modifiers || [];
          store.updateBlock(cellId, { modifiers: [...existingModifiers, modifier] });
        }

        // Update the tracking entry with the modifier ID
        store.setModifierId(cellId, modifier.id);
      }

      if (message.type === 'modifierChunk' && message.payload?.cellId && message.payload?.chunk) {
        const cellId = message.payload.cellId as string;
        const chunk = message.payload.chunk as string;
        console.log('[Modifier] Chunk:', { cellId, chunkLength: chunk.length });
        store.appendModifyingContent(cellId, chunk);
      }

      if (message.type === 'modifierComplete' && message.payload?.cellId && message.payload?.modifierId) {
        const cellId = message.payload.cellId as string;
        const modifierId = message.payload.modifierId as string;
        console.log('[Modifier] Complete:', { cellId, modifierId });

        const modifyingData = store.getModifyingData(cellId);
        if (!modifyingData) {
          console.warn('[Modifier] Complete but no modifying data found for:', cellId);
          return;
        }

        const rawContent = modifyingData.content;
        const htmlContent = markdownToHtml(rawContent);

        // Create new version with the modified content
        const newVersionId = crypto.randomUUID();
        const newVersion: CellVersion = {
          id: newVersionId,
          content: htmlContent,
          modifierIds: [modifierId],
          createdAt: new Date().toISOString(),
        };

        const cell = store.getBlock(cellId);
        if (!cell) {
          store.completeModifying(cellId);
          return;
        }

        // Get existing versions or create initial version from current content
        let existingVersions = cell.versions || [];
        if (existingVersions.length === 0 && cell.content) {
          existingVersions = [{
            id: crypto.randomUUID(),
            content: cell.content,
            modifierIds: [],
            createdAt: cell.createdAt,
          }];
        }

        const updatedVersions = [...existingVersions, newVersion];

        // Update block
        store.updateBlock(cellId, {
          content: htmlContent,
          versions: updatedVersions,
          activeVersionId: newVersionId,
        });

        // Save to Swift
        bridge.send({
          type: 'saveCell',
          payload: {
            id: cellId,
            streamId,
            content: htmlContent,
            type: cell.type,
            order: cell.order,
            modifiers: cell.modifiers,
            versions: updatedVersions,
            activeVersionId: newVersionId,
          },
        });

        store.completeModifying(cellId);
      }

      if (message.type === 'modifierError' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        const error = message.payload.error as string;
        store.setError(cellId, error);
        store.completeModifying(cellId);
      }

      // Block refresh updates (live blocks, cascade updates)
      if (message.type === 'blockRefreshStart' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        console.log('[BlockRefresh] Start:', cellId);
        store.startRefreshing(cellId);
      }

      if (message.type === 'blockRefreshChunk' && message.payload?.cellId && message.payload?.chunk) {
        const cellId = message.payload.cellId as string;
        const chunk = message.payload.chunk as string;
        store.appendRefreshingContent(cellId, chunk);
      }

      if (message.type === 'blockRefreshComplete' && message.payload?.cellId && message.payload?.content) {
        const cellId = message.payload.cellId as string;
        const rawContent = message.payload.content as string;
        const htmlContent = markdownToHtml(rawContent);
        console.log('[BlockRefresh] Complete:', cellId);

        const cell = store.getBlock(cellId);
        if (cell) {
          store.updateBlock(cellId, { content: htmlContent });

          // Save refreshed content to Swift
          bridge.send({
            type: 'saveCell',
            payload: {
              id: cellId,
              streamId,
              content: htmlContent,
              type: cell.type,
              order: cell.order,
              originalPrompt: cell.originalPrompt,
              processingConfig: cell.processingConfig,
              references: cell.references,
              blockName: cell.blockName,
            },
          });
        }

        store.completeRefreshing(cellId);
      }

      if (message.type === 'blockRefreshError' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        const error = message.payload.error as string;
        console.error('[BlockRefresh] Error:', cellId, error);
        store.setError(cellId, error);
        store.completeRefreshing(cellId);
      }
    });
    return unsubscribe;
  }, [streamId, store]);

  return {
    sources,
    setSources,
  };
}
