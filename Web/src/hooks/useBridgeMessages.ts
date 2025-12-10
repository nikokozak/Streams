import { useState, useEffect } from 'react';
import { SourceReference, Modifier, CellVersion, Cell, bridge } from '../types';
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
    console.log('[useBridgeMessages] Setting up message handler for streamId:', streamId);

    const unsubscribe = bridge.onMessage((message) => {
      try {
      // Debug: log all messages to see what's coming through
      console.log('[useBridgeMessages] Received:', message.type);

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

      // Quick Panel: cells added via global hotkey capture
      if (message.type === 'quickPanelCellsAdded' && message.payload?.cells) {
        const addedStreamId = message.payload.streamId as string;
        const cells = message.payload.cells as Cell[];
        const triggerAI = message.payload.triggerAI as string | undefined;

        console.log('[QuickPanel] Cells added:', { streamId: addedStreamId, cellCount: cells.length, triggerAI });

        // Only process if this is for the current stream
        if (addedStreamId === streamId) {
          // Add each cell to the store
          for (const cell of cells) {
            store.addBlock({
              id: cell.id,
              streamId: cell.streamId,
              content: cell.content,
              type: cell.type,
              order: cell.order,
              sourceBinding: cell.sourceBinding || null,
              originalPrompt: cell.originalPrompt,
              references: cell.references,
              sourceApp: cell.sourceApp,
              createdAt: cell.createdAt || new Date().toISOString(),
              updatedAt: cell.updatedAt || new Date().toISOString(),
            });
          }

          // If triggerAI is set, start AI streaming for that cell
          if (triggerAI) {
            const aiCell = cells.find(c => c.id === triggerAI);
            if (aiCell) {
              console.log('[QuickPanel] Triggering AI for cell:', triggerAI);
              store.startStreaming(triggerAI);

              // Get prior cells for context (exclude the AI cell itself)
              const priorCells = store.blockOrder
                .map(id => store.getBlock(id))
                .filter((b): b is NonNullable<typeof b> => b !== undefined && b.id !== triggerAI)
                .map(b => ({
                  content: b.content,
                  type: b.type,
                }));

              // Get referenced content (e.g., the quote cell from Quick Panel)
              // This is the highlighted text/screenshot that the user is asking about
              let referencedContent: string | undefined;
              let referencedImageURLs: string[] = [];
              if (aiCell.references && aiCell.references.length > 0) {
                const refCell = cells.find(c => c.id === aiCell.references?.[0]);
                if (refCell) {
                  referencedContent = refCell.content;
                  // Extract image URLs from referenced content
                  const imgMatches = refCell.content.matchAll(/<img[^>]+src="([^"]+)"/g);
                  for (const match of imgMatches) {
                    if (match[1]) {
                      referencedImageURLs.push(match[1]);
                    }
                  }
                }
              }

              // Send think request to Swift
              bridge.send({
                type: 'think',
                payload: {
                  cellId: triggerAI,
                  currentCell: aiCell.originalPrompt || '',
                  referencedContent,  // The quote/screenshot the user selected
                  referencedImageURLs, // Image URLs from the referenced cell
                  priorCells,
                  streamId,
                },
              });
            }
          }
        }
      }

      // Request for current stream ID (for native file drops)
      if (message.type === 'requestCurrentStreamId') {
        console.log('[Bridge] requestCurrentStreamId, responding with:', streamId);
        bridge.send({
          type: 'currentStreamId',
          payload: { streamId }
        });
      }

      // Image dropped via native drag-and-drop
      if (message.type === 'imageDropped') {
        console.log('[useBridgeMessages] imageDropped payload:', JSON.stringify(message.payload));
        if (message.payload?.assetUrl) {
          const assetUrl = message.payload.assetUrl as string;
          const { focusedBlockId, blockOrder } = store;
          console.log('[useBridgeMessages] Inserting image:', assetUrl, 'focusedBlock:', focusedBlockId);

          store.insertImageInFocusedBlock(assetUrl);

          // Save the updated block to persist the image reference
          // insertImageInFocusedBlock uses focusedBlockId or falls back to last block
          const targetBlockId = focusedBlockId || blockOrder[blockOrder.length - 1];
          const block = store.getBlock(targetBlockId);
          if (block) {
            bridge.send({
              type: 'saveCell',
              payload: {
                id: block.id,
                streamId,
                content: block.content,
                type: block.type,
                order: block.order,
                sourceApp: block.sourceApp,
                references: block.references,
              },
            });
          }
        } else {
          console.warn('[useBridgeMessages] imageDropped but no assetUrl in payload');
        }
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

        // Save to Swift (preserve sourceApp and references)
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
            sourceApp: cell.sourceApp,
            references: cell.references,
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

      if (message.type === 'blockRefreshError' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        const error = message.payload.error as string;
        console.error('[BlockRefresh] Error:', cellId, error);
        store.setError(cellId, error);
        store.completeRefreshing(cellId);
      }
      } catch (err) {
        console.error('[useBridgeMessages] Error handling message:', message.type, err);
      }
    });

    return () => {
      console.log('[useBridgeMessages] Cleaning up message handler for streamId:', streamId);
      unsubscribe();
    };
  }, [streamId, store]);

  return {
    sources,
    setSources,
  };
}
