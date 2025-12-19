import { useEffect } from 'react';
import { bridge } from '../types';
import { useBlockStore } from '../store/blockStore';
import { useEditorUIStore } from '../store/editorUIStore';
import { toast } from '../store/toastStore';
import { useEditorAPI } from '../contexts/EditorContext';

interface UseBlockRefreshOptions {
  streamId: string;
}

/**
 * Handles block refresh messages: blockRefreshStart, blockRefreshChunk, blockRefreshComplete, blockRefreshError
 */
export function useBlockRefresh({ streamId }: UseBlockRefreshOptions) {
  const store = useBlockStore();
  const editorAPI = useEditorAPI();

  useEffect(() => {
    const unsubscribe = bridge.onMessage((message) => {
      // CRITICAL: Filter by streamId to prevent cross-stream corruption
      const messageStreamId = message.payload?.streamId as string | undefined;

      // Block refresh start
      if (message.type === 'blockRefreshStart' && message.payload?.cellId) {
        // Skip if this message is for a different stream
        if (messageStreamId && messageStreamId !== streamId) return;

        const cellId = message.payload.cellId as string;
        console.log('[BlockRefresh] Start:', cellId);
        store.startRefreshing(cellId);

        // Clear content in editor and mark as streaming
        if (editorAPI) {
          editorAPI.replaceCellWithMarkdown(cellId, '', {
            addToHistory: false,      // System action - don't pollute undo stack
            origin: 'refresh',
            skipUserEditCheck: true,  // Force clear even during streaming
          });
          editorAPI.setCellStreaming(cellId, true);
        }
      }

      // Block refresh chunk
      if (message.type === 'blockRefreshChunk' && message.payload?.cellId && message.payload?.chunk) {
        // Skip if this message is for a different stream
        if (messageStreamId && messageStreamId !== streamId) return;

        const cellId = message.payload.cellId as string;
        const chunk = message.payload.chunk as string;
        store.appendRefreshingContent(cellId, chunk);

        // Update unified editor with ACCUMULATED content (not just the chunk)
        if (editorAPI) {
          const accumulatedContent = store.getRefreshingContent(cellId) || '';
          editorAPI.replaceCellWithMarkdown(cellId, accumulatedContent, {
            addToHistory: false, // Intermediate chunks don't pollute undo
            origin: 'refresh',
          });
        }
      }

      // Block refresh complete
      if (message.type === 'blockRefreshComplete' && message.payload?.cellId && message.payload?.content) {
        // Skip if this message is for a different stream
        if (messageStreamId && messageStreamId !== streamId) return;

        const cellId = message.payload.cellId as string;
        const refreshedContent = message.payload.content as string;
        // Restatement might come with the refresh payload, or we preserve the existing one
        const newRestatement = message.payload.restatement as string | undefined;
        console.log('[BlockRefresh] Complete:', cellId);

        const cell = store.getBlock(cellId);

        // Comprehensive logging to trace the restatement extraction issue
        console.log('[BlockRefresh] DEBUG - cell exists:', !!cell);
        console.log('[BlockRefresh] DEBUG - cell.rawMarkdown:', cell?.rawMarkdown?.slice(0, 100));
        console.log('[BlockRefresh] DEBUG - cell.restatement:', cell?.restatement);
        console.log('[BlockRefresh] DEBUG - newRestatement from payload:', newRestatement);

        if (cell) {
          // Get restatement - prefer new one from payload, fall back to existing cell restatement
          // Also check if the existing rawMarkdown starts with a ## heading (integrated restatement)
          let restatement = newRestatement || cell.restatement;

          // If no restatement, try to extract from rawMarkdown
          // Use regex to be more flexible with heading format (## with varying whitespace)
          if (!restatement && cell.rawMarkdown) {
            const trimmed = cell.rawMarkdown.trimStart();
            console.log('[BlockRefresh] DEBUG - trimmed rawMarkdown:', trimmed.slice(0, 100));
            // Match ## followed by whitespace(s) and capture the heading text until newline or end
            const match = trimmed.match(/^##\s+(.+?)(\n|$)/);
            if (match) {
              restatement = match[1].trim();
              console.log('[BlockRefresh] Extracted restatement from rawMarkdown:', restatement);
            } else {
              console.log('[BlockRefresh] Could not extract restatement, rawMarkdown starts with:', trimmed.slice(0, 50));
            }
          } else if (!restatement) {
            console.log('[BlockRefresh] DEBUG - no rawMarkdown to extract from');
          }

          // Integrate restatement as ## heading (same as aiComplete)
          const rawContent = restatement ? `## ${restatement}\n\n${refreshedContent}` : refreshedContent;

          // SLICE 11 (Option B'): Complete refreshing BEFORE editor update
          // This allows saveCells to run (it skips refreshing cells)
          // The editor update triggers onCellsChange → saveCells with TipTap-derived HTML
          store.completeRefreshing(cellId);

          // Clear restatement field; it will be represented in content (heading cell) if present
          store.updateBlock(cellId, {
            restatement: undefined,
          });

          if (editorAPI) {
            // Option B: Replace a single refreshing cell with multiple atomic cells based on markdown blocks.
            const splitResult = editorAPI.replaceStreamingCellWithMarkdownCells(cellId, rawContent, {
              type: cell.type,
              modelId: cell.modelId,
              originalPrompt: cell.originalPrompt,
              sourceApp: cell.sourceApp,
              blockName: cell.blockName,
            });

            if (!splitResult.applied) {
              // User edited during refresh -> do not overwrite. Stop streaming UI and force-save current TipTap state.
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
        }
      }

      // Block refresh error
      if (message.type === 'blockRefreshError' && message.payload?.cellId) {
        // Skip if this message is for a different stream
        if (messageStreamId && messageStreamId !== streamId) return;

        const cellId = message.payload.cellId as string;
        const error = message.payload.error as string;
        console.error('[BlockRefresh] Error:', cellId, error);
        store.setError(cellId, error);

        // Clear streaming state in editor
        if (editorAPI) {
          editorAPI.setCellStreaming(cellId, false);
        }

        // Complete refreshing unconditionally with setTimeout
        setTimeout(() => {
          store.completeRefreshing(cellId);
        }, 0);
        toast.error(`Refresh Error: ${error}`);
      }
    });

    return unsubscribe;
  }, [streamId, store, editorAPI]);
}
