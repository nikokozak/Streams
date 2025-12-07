import { create } from 'zustand';
import { Cell as CellType } from '../types/models';

/** Streaming content accumulator for AI responses */
interface StreamingBlock {
  content: string;
}

/** Modifier application in progress */
interface ModifyingBlock {
  modifierId: string;
  content: string;
  prompt: string;
}

interface BlockState {
  // Core data
  streamId: string | null;
  blocks: Map<string, CellType>;
  blockOrder: string[];

  // UI State
  streamingBlocks: Map<string, StreamingBlock>;
  modifyingBlocks: Map<string, ModifyingBlock>;
  errorBlocks: Map<string, string>;
  focusedBlockId: string | null;
  newBlockId: string | null;
}

interface BlockActions {
  // Stream lifecycle
  loadStream: (streamId: string, cells: CellType[]) => void;
  clearStream: () => void;

  // Block CRUD
  addBlock: (block: CellType, afterId?: string) => void;
  updateBlock: (id: string, updates: Partial<CellType>) => void;
  deleteBlock: (id: string) => void;
  reorderBlocks: (fromIdx: number, toIdx: number) => void;

  // Get computed values
  getBlock: (id: string) => CellType | undefined;
  getBlocksArray: () => CellType[];
  getBlockIndex: (id: string) => number;

  // Streaming state
  startStreaming: (id: string) => void;
  appendStreamingContent: (id: string, chunk: string) => void;
  completeStreaming: (id: string) => void;
  isStreaming: (id: string) => boolean;
  getStreamingContent: (id: string) => string | undefined;

  // Modifier state
  startModifying: (id: string, prompt: string) => void;
  setModifierId: (id: string, modifierId: string) => void;
  appendModifyingContent: (id: string, chunk: string) => void;
  completeModifying: (id: string) => void;
  isModifying: (id: string) => boolean;
  getModifyingData: (id: string) => ModifyingBlock | undefined;

  // Error state
  setError: (id: string, error: string) => void;
  clearError: (id: string) => void;
  getError: (id: string) => string | undefined;

  // Focus management
  setFocus: (id: string | null) => void;
  setNewBlockId: (id: string | null) => void;
  focusNext: () => void;
  focusPrevious: () => void;
}

type BlockStore = BlockState & BlockActions;

export const useBlockStore = create<BlockStore>((set, get) => ({
  // Initial state
  streamId: null,
  blocks: new Map(),
  blockOrder: [],
  streamingBlocks: new Map(),
  modifyingBlocks: new Map(),
  errorBlocks: new Map(),
  focusedBlockId: null,
  newBlockId: null,

  // Stream lifecycle
  loadStream: (streamId, cells) => {
    const blocks = new Map<string, CellType>();
    const blockOrder: string[] = [];

    // Sort by order and build maps
    const sorted = [...cells].sort((a, b) => a.order - b.order);
    for (const cell of sorted) {
      blocks.set(cell.id, cell);
      blockOrder.push(cell.id);
    }

    set({
      streamId,
      blocks,
      blockOrder,
      streamingBlocks: new Map(),
      modifyingBlocks: new Map(),
      errorBlocks: new Map(),
      focusedBlockId: null,
      newBlockId: null,
    });
  },

  clearStream: () => {
    set({
      streamId: null,
      blocks: new Map(),
      blockOrder: [],
      streamingBlocks: new Map(),
      modifyingBlocks: new Map(),
      errorBlocks: new Map(),
      focusedBlockId: null,
      newBlockId: null,
    });
  },

  // Block CRUD
  addBlock: (block, afterId) => {
    const { blocks, blockOrder } = get();
    const newBlocks = new Map(blocks);
    newBlocks.set(block.id, block);

    let newOrder: string[];
    if (afterId) {
      const afterIndex = blockOrder.indexOf(afterId);
      if (afterIndex !== -1) {
        newOrder = [...blockOrder];
        newOrder.splice(afterIndex + 1, 0, block.id);
      } else {
        newOrder = [...blockOrder, block.id];
      }
    } else {
      newOrder = [...blockOrder, block.id];
    }

    // Update order property on all blocks
    newOrder.forEach((id, idx) => {
      const existing = newBlocks.get(id);
      if (existing && existing.order !== idx) {
        newBlocks.set(id, { ...existing, order: idx });
      }
    });

    set({ blocks: newBlocks, blockOrder: newOrder });
  },

  updateBlock: (id, updates) => {
    const { blocks } = get();
    const existing = blocks.get(id);
    if (!existing) return;

    const newBlocks = new Map(blocks);
    newBlocks.set(id, {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    });
    set({ blocks: newBlocks });
  },

  deleteBlock: (id) => {
    const { blocks, blockOrder } = get();
    if (!blocks.has(id)) return;

    const newBlocks = new Map(blocks);
    newBlocks.delete(id);

    const newOrder = blockOrder.filter((bid) => bid !== id);

    // Update order property on remaining blocks
    newOrder.forEach((bid, idx) => {
      const existing = newBlocks.get(bid);
      if (existing && existing.order !== idx) {
        newBlocks.set(bid, { ...existing, order: idx });
      }
    });

    set({ blocks: newBlocks, blockOrder: newOrder });
  },

  reorderBlocks: (fromIdx, toIdx) => {
    const { blocks, blockOrder } = get();
    if (fromIdx === toIdx) return;
    if (fromIdx < 0 || fromIdx >= blockOrder.length) return;
    if (toIdx < 0 || toIdx >= blockOrder.length) return;

    const newOrder = [...blockOrder];
    const [removed] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, removed);

    // Update order property on all blocks
    const newBlocks = new Map(blocks);
    newOrder.forEach((id, idx) => {
      const existing = newBlocks.get(id);
      if (existing) {
        newBlocks.set(id, { ...existing, order: idx });
      }
    });

    set({ blocks: newBlocks, blockOrder: newOrder });
  },

  // Getters
  getBlock: (id) => get().blocks.get(id),

  getBlocksArray: () => {
    const { blocks, blockOrder } = get();
    return blockOrder.map((id) => blocks.get(id)).filter(Boolean) as CellType[];
  },

  getBlockIndex: (id) => get().blockOrder.indexOf(id),

  // Streaming
  startStreaming: (id) => {
    const { streamingBlocks } = get();
    const newStreaming = new Map(streamingBlocks);
    newStreaming.set(id, { content: '' });
    set({ streamingBlocks: newStreaming });
  },

  appendStreamingContent: (id, chunk) => {
    const { streamingBlocks } = get();
    const existing = streamingBlocks.get(id);
    if (!existing) return;

    const newStreaming = new Map(streamingBlocks);
    newStreaming.set(id, { content: existing.content + chunk });
    set({ streamingBlocks: newStreaming });
  },

  completeStreaming: (id) => {
    const { streamingBlocks } = get();
    const newStreaming = new Map(streamingBlocks);
    newStreaming.delete(id);
    set({ streamingBlocks: newStreaming });
  },

  isStreaming: (id) => get().streamingBlocks.has(id),

  getStreamingContent: (id) => get().streamingBlocks.get(id)?.content,

  // Modifying
  startModifying: (id, prompt) => {
    const { modifyingBlocks } = get();
    const newModifying = new Map(modifyingBlocks);
    newModifying.set(id, { modifierId: '', content: '', prompt });
    set({ modifyingBlocks: newModifying });
  },

  setModifierId: (id, modifierId) => {
    const { modifyingBlocks } = get();
    const existing = modifyingBlocks.get(id);
    if (!existing) return;

    const newModifying = new Map(modifyingBlocks);
    newModifying.set(id, { ...existing, modifierId });
    set({ modifyingBlocks: newModifying });
  },

  appendModifyingContent: (id, chunk) => {
    const { modifyingBlocks } = get();
    const existing = modifyingBlocks.get(id);
    if (!existing) return;

    const newModifying = new Map(modifyingBlocks);
    newModifying.set(id, { ...existing, content: existing.content + chunk });
    set({ modifyingBlocks: newModifying });
  },

  completeModifying: (id) => {
    const { modifyingBlocks } = get();
    const newModifying = new Map(modifyingBlocks);
    newModifying.delete(id);
    set({ modifyingBlocks: newModifying });
  },

  isModifying: (id) => get().modifyingBlocks.has(id),

  getModifyingData: (id) => get().modifyingBlocks.get(id),

  // Errors
  setError: (id, error) => {
    const { errorBlocks } = get();
    const newErrors = new Map(errorBlocks);
    newErrors.set(id, error);
    set({ errorBlocks: newErrors });
  },

  clearError: (id) => {
    const { errorBlocks } = get();
    const newErrors = new Map(errorBlocks);
    newErrors.delete(id);
    set({ errorBlocks: newErrors });
  },

  getError: (id) => get().errorBlocks.get(id),

  // Focus
  setFocus: (id) => set({ focusedBlockId: id }),

  setNewBlockId: (id) => set({ newBlockId: id }),

  focusNext: () => {
    const { focusedBlockId, blockOrder } = get();
    if (!focusedBlockId) return;

    const currentIndex = blockOrder.indexOf(focusedBlockId);
    if (currentIndex < blockOrder.length - 1) {
      set({ focusedBlockId: blockOrder[currentIndex + 1] });
    }
  },

  focusPrevious: () => {
    const { focusedBlockId, blockOrder } = get();
    if (!focusedBlockId) return;

    const currentIndex = blockOrder.indexOf(focusedBlockId);
    if (currentIndex > 0) {
      set({ focusedBlockId: blockOrder[currentIndex - 1] });
    }
  },
}));
