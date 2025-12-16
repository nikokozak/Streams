import { useEffect } from 'react';
import { Cell, bridge } from '../types';
import { useBlockStore } from '../store/blockStore';

interface UseQuickPanelSyncOptions {
  streamId: string;
}

/**
 * Handles Quick Panel sync messages: quickPanelCellsAdded, imageDropped, requestCurrentStreamId
 */
export function useQuickPanelSync({ streamId }: UseQuickPanelSyncOptions) {
  const store = useBlockStore();

  useEffect(() => {
    const unsubscribe = bridge.onMessage((message) => {
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
              const referencedImageURLs: string[] = [];
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
        console.log('[useQuickPanelSync] imageDropped payload:', JSON.stringify(message.payload));
        if (message.payload?.assetUrl) {
          const assetUrl = message.payload.assetUrl as string;
          const { focusedBlockId, blockOrder } = store;
          console.log('[useQuickPanelSync] Inserting image:', assetUrl, 'focusedBlock:', focusedBlockId);

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
          console.warn('[useQuickPanelSync] imageDropped but no assetUrl in payload');
        }
      }
    });

    return unsubscribe;
  }, [streamId, store]);
}
