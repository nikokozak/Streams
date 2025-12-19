import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CellBlockView } from './CellBlockView';

export interface CellBlockAttrs {
  id: string | null;
  type: 'text' | 'aiResponse' | 'quote';
  modelId?: string | null;
  originalPrompt?: string | null;
  sourceApp?: string | null;
  blockName?: string | null;
  isLive?: boolean;
  hasDependencies?: boolean;
}

/**
 * CellBlock node - the core building block of the unified stream editor.
 *
 * Schema: doc -> cellBlock+
 * Each cellBlock contains block+ content (paragraphs, headings, lists, code, images).
 * Cell metadata is stored as node attributes.
 */
export const CellBlock = Node.create({
  name: 'cellBlock',

  group: 'block',

  // CRITICAL: block+ allows rich content (headings, lists, code blocks, etc.)
  // This was a key lesson from the previous failed attempt.
  content: 'block+',

  // Cell metadata stored as attributes
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-cell-id'),
        renderHTML: (attributes) => ({
          'data-cell-id': attributes.id,
        }),
      },
      type: {
        default: 'text',
        parseHTML: (element) => element.getAttribute('data-cell-type') || 'text',
        renderHTML: (attributes) => ({
          'data-cell-type': attributes.type,
        }),
      },
      modelId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-model-id'),
        renderHTML: (attributes) => {
          if (!attributes.modelId) return {};
          return { 'data-model-id': attributes.modelId };
        },
      },
      originalPrompt: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-original-prompt'),
        renderHTML: (attributes) => {
          if (!attributes.originalPrompt) return {};
          return { 'data-original-prompt': attributes.originalPrompt };
        },
      },
      sourceApp: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-source-app'),
        renderHTML: (attributes) => {
          if (!attributes.sourceApp) return {};
          return { 'data-source-app': attributes.sourceApp };
        },
      },
      blockName: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-name'),
        renderHTML: (attributes) => {
          if (!attributes.blockName) return {};
          return { 'data-block-name': attributes.blockName };
        },
      },
      isLive: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-is-live') === 'true',
        renderHTML: (attributes) => {
          if (!attributes.isLive) return {};
          return { 'data-is-live': 'true' };
        },
      },
      hasDependencies: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-has-dependencies') === 'true',
        renderHTML: (attributes) => {
          if (!attributes.hasDependencies) return {};
          return { 'data-has-dependencies': 'true' };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-cell-block]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-cell-block': '' }),
      0, // content hole
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CellBlockView);
  },
});
