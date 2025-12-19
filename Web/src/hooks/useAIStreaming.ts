import { useEffect } from 'react';
import { bridge } from '../types';
import { useBlockStore } from '../store/blockStore';
import { useEditorUIStore } from '../store/editorUIStore';
import { toast } from '../store/toastStore';
import { useEditorAPI } from '../contexts/EditorContext';

interface UseAIStreamingOptions {
  streamId: string;
}

/**
 * Handles AI streaming messages: aiChunk, aiComplete, aiError, modelSelected, restatementGenerated
 */
export function useAIStreaming({ streamId }: UseAIStreamingOptions) {
  const store = useBlockStore();
  const editorAPI = useEditorAPI();

  useEffect(() => {
    const unsubscribe = bridge.onMessage((message) => {
      // CRITICAL: Filter by streamId to prevent cross-stream corruption
      const messageStreamId = message.payload?.streamId as string | undefined;

      // AI streaming chunk
      if (message.type === 'aiChunk' && message.payload?.cellId && message.payload?.chunk) {
        // Skip if this message is for a different stream
        if (messageStreamId && messageStreamId !== streamId) {
          console.log('[useAIStreaming] aiChunk filtered - wrong stream:', { messageStreamId, streamId });
          return;
        }

        const cellId = message.payload.cellId as string;
        const chunk = message.payload.chunk as string;

        console.log('[useAIStreaming] aiChunk received:', { cellId, chunkLength: chunk.length, hasEditorAPI: !!editorAPI });

        // Update store (for compatibility)
        store.appendStreamingContent(cellId, chunk);

        // Update unified editor with FULL accumulated content
        // This avoids the issue of insertContentAt creating new paragraphs for each chunk
        if (editorAPI) {
          const accumulatedContent = store.getStreamingContent(cellId) || '';
          // Use forceStreaming because the store's streaming state is authoritative.
          // The TipTap node attribute might be reset by reconciliation, but the store
          // knows the cell is streaming (via editorUIStore.streamingBlocks).
          editorAPI.replaceCellWithMarkdown(cellId, accumulatedContent, {
            addToHistory: false, // Intermediate chunks don't pollute undo
            origin: 'ai',
            forceStreaming: true, // Trust store's streaming state over TipTap attribute
          });
        } else {
          console.warn('[useAIStreaming] No editorAPI available for chunk update');
        }
      }

      // AI streaming complete
      if (message.type === 'aiComplete' && message.payload?.cellId) {
        // Skip if this message is for a different stream
        if (messageStreamId && messageStreamId !== streamId) return;

        const cellId = message.payload.cellId as string;
        const streamedContent = store.getStreamingContent(cellId) || '';
        const cell = store.getBlock(cellId);

        if (cell) {
          const restatement = cell.restatement;
          const rawContent = restatement ? `## ${restatement}\n\n${streamedContent}` : streamedContent;

          // SLICE 11 (Option B'): Complete streaming BEFORE editor update
          // This allows saveCells to run (it skips streaming cells)
          // The editor update triggers onCellsChange → saveCells with TipTap-derived HTML
          store.completeStreaming(cellId);

          // Clear restatement field; it will be represented in content (heading cell) if present
          store.updateBlock(cellId, {
            restatement: undefined, // No longer stored separately
          });

          if (editorAPI) {
            // Option B: Replace a single streaming cell with multiple atomic cells based on markdown blocks.
            // This preserves semantic structure (headings, list items, code blocks) in a Notion-like way.
            // Use forceStreaming because reconciliation might have reset the TipTap isStreaming attribute
            // after store.updateBlock triggered a re-render.
            const splitResult = editorAPI.replaceStreamingCellWithMarkdownCells(cellId, rawContent, {
              type: 'aiResponse',
              modelId: cell.modelId,
              originalPrompt: cell.originalPrompt,
              sourceApp: cell.sourceApp,
              blockName: cell.blockName,
            }, { forceStreaming: true });

            if (!splitResult.applied) {
              // User edited during streaming (or cell not streaming) -> do NOT overwrite.
              // Just stop streaming UI and force-save whatever TipTap currently contains.
              editorAPI.setCellStreaming(cellId, false);
              const tiptapContent = editorAPI.getCellContent(cellId);
              if (tiptapContent) {
                store.updateBlock(cellId, { rawMarkdown: tiptapContent.rawMarkdown });
                bridge.send({
                  type: 'saveCell',
                  payload: {
                    id: cellId,
                    streamId,
                    content: tiptapContent.html,
                    rawMarkdown: tiptapContent.rawMarkdown,
                    type: cell.type,
                    order: cell.order,
                    kind: cell.kind,
                    indent: cell.indent,
                    headingLevel: cell.headingLevel,
                    checked: cell.checked,
                    language: cell.language,
                    imageUrl: cell.imageUrl,
                    modelId: cell.modelId,
                    originalPrompt: cell.originalPrompt,
                    sourceApp: cell.sourceApp,
                    blockName: cell.blockName,
                    processingConfig: cell.processingConfig,
                    references: cell.references,
                    sourceBinding: cell.sourceBinding,
                  },
                });
              }
            }
          }

          // Clear focus so the rendered content is shown instead of raw markdown
          const uiStore = useEditorUIStore.getState();
          if (uiStore.focusedBlockId === cellId) {
            uiStore.setFocus(null);
          }
        } else {
          // Even if cell not in store, try to update editor
          store.completeStreaming(cellId);
          if (editorAPI) {
            editorAPI.setCellStreaming(cellId, false);
          }
        }
      }

      // AI streaming error
      if (message.type === 'aiError' && message.payload?.cellId) {
        // Skip if this message is for a different stream
        if (messageStreamId && messageStreamId !== streamId) return;

        const cellId = message.payload.cellId as string;
        const error = message.payload.error as string;
        store.setError(cellId, error);
        // Complete streaming unconditionally with setTimeout for consistent re-render
        setTimeout(() => {
          store.completeStreaming(cellId);
        }, 0);
        toast.error(`AI Error: ${error}`);
      }

      // Model selection (sent before streaming starts)
      if (message.type === 'modelSelected' && message.payload?.cellId && message.payload?.modelId) {
        // Skip if this message is for a different stream
        if (messageStreamId && messageStreamId !== streamId) return;

        const cellId = message.payload.cellId as string;
        const modelId = message.payload.modelId as string;
        store.updateBlock(cellId, { modelId });
        // Sync to TipTap node attributes so UI updates immediately
        editorAPI?.setCellBlockAttributes(cellId, { modelId });
      }

      // Restatement updates (heading form of original prompt)
      if (message.type === 'restatementGenerated' && message.payload?.cellId && message.payload?.restatement) {
        // Skip if this message is for a different stream
        if (messageStreamId && messageStreamId !== streamId) return;

        const cellId = message.payload.cellId as string;
        const restatement = message.payload.restatement as string;
        store.updateBlock(cellId, { restatement });
      }
    });

    return unsubscribe;
  }, [streamId, store, editorAPI]);
}
