import { useEffect } from 'react';
import { Modifier, CellVersion, bridge } from '../types';
import { markdownToHtml } from '../utils/markdown';
import { useBlockStore } from '../store/blockStore';
import { toast } from '../store/toastStore';

interface UseModifierStreamingOptions {
  streamId: string;
}

/**
 * Handles modifier streaming messages: modifierCreated, modifierChunk, modifierComplete, modifierError
 */
export function useModifierStreaming({ streamId }: UseModifierStreamingOptions) {
  const store = useBlockStore();

  useEffect(() => {
    const unsubscribe = bridge.onMessage((message) => {
      // Modifier created
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

      // Modifier chunk
      if (message.type === 'modifierChunk' && message.payload?.cellId && message.payload?.chunk) {
        const cellId = message.payload.cellId as string;
        const chunk = message.payload.chunk as string;
        console.log('[Modifier] Chunk:', { cellId, chunkLength: chunk.length });
        store.appendModifyingContent(cellId, chunk);
      }

      // Modifier complete
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

      // Modifier error
      if (message.type === 'modifierError' && message.payload?.cellId) {
        const cellId = message.payload.cellId as string;
        const error = message.payload.error as string;
        console.error('[Modifier] Error:', { cellId, error });

        // Get the modifier ID that was being applied (from tracking)
        const modifyingData = store.getModifyingData(cellId);
        const failedModifierId = modifyingData?.modifierId;

        // Remove the failed modifier from the cell if it was added
        if (failedModifierId) {
          const cell = store.getBlock(cellId);
          if (cell && cell.modifiers) {
            const cleanedModifiers = cell.modifiers.filter(m => m.id !== failedModifierId);
            store.updateBlock(cellId, { modifiers: cleanedModifiers });
          }
        }

        store.setError(cellId, error);
        store.completeModifying(cellId);
        toast.error(`Modifier failed: ${error}`);
      }
    });

    return unsubscribe;
  }, [streamId, store]);
}
