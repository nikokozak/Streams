import { ReactRenderer } from '@tiptap/react';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Cell } from '../types/models';
import { getShortId } from '../utils/references';

interface SuggestionItem {
  id: string;
  label: string;
  shortId: string;
  type: string;
}

interface SuggestionListProps {
  items: SuggestionItem[];
  command: (item: SuggestionItem) => void;
}

interface SuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

const SuggestionList = forwardRef<SuggestionListRef, SuggestionListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    const selectItem = (index: number) => {
      const item = items[index];
      if (item) {
        command(item);
      }
    };

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
          return true;
        }

        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length);
          return true;
        }

        if (event.key === 'Enter') {
          selectItem(selectedIndex);
          return true;
        }

        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="reference-suggestion-list">
          <div className="reference-suggestion-item reference-suggestion-item--empty">
            No cells found
          </div>
        </div>
      );
    }

    return (
      <div className="reference-suggestion-list">
        {items.map((item, index) => (
          <button
            key={item.id}
            className={`reference-suggestion-item ${
              index === selectedIndex ? 'reference-suggestion-item--selected' : ''
            }`}
            onClick={() => selectItem(index)}
          >
            <span className="reference-suggestion-label">{item.label}</span>
            <span className="reference-suggestion-id">@block-{item.shortId}</span>
          </button>
        ))}
      </div>
    );
  }
);

SuggestionList.displayName = 'SuggestionList';

export function createReferenceSuggestion(
  getCells: () => Cell[]
): Omit<SuggestionOptions<SuggestionItem>, 'editor'> {
  return {
    char: '@',
    allowSpaces: false,
    startOfLine: false,

    items: ({ query }): SuggestionItem[] => {
      const cells = getCells();
      const lowerQuery = query.toLowerCase();

      return cells
        .filter((cell) => {
          // Filter by blockName or short ID
          const blockName = cell.blockName?.toLowerCase() || '';
          const shortId = getShortId(cell.id);
          const content = cell.content.replace(/<[^>]*>/g, '').toLowerCase();

          // Match against blockName, shortId, or content preview
          return (
            blockName.includes(lowerQuery) ||
            shortId.includes(lowerQuery) ||
            content.includes(lowerQuery)
          );
        })
        .slice(0, 8) // Limit to 8 suggestions
        .map((cell) => ({
          id: cell.id,
          label: cell.blockName || cell.content.replace(/<[^>]*>/g, '').slice(0, 40) || 'Untitled',
          shortId: cell.blockName || getShortId(cell.id),
          type: cell.type,
        }));
    },

    render: () => {
      let component: ReactRenderer<SuggestionListRef>;
      let popup: TippyInstance[];

      return {
        onStart: (props: SuggestionProps<SuggestionItem>) => {
          component = new ReactRenderer(SuggestionList, {
            props,
            editor: props.editor,
          });

          if (!props.clientRect) return;

          popup = tippy('body', {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: 'manual',
            placement: 'bottom-start',
          });
        },

        onUpdate(props: SuggestionProps<SuggestionItem>) {
          component.updateProps(props);

          if (!props.clientRect) return;

          popup[0].setProps({
            getReferenceClientRect: props.clientRect as () => DOMRect,
          });
        },

        onKeyDown(props: { event: KeyboardEvent }) {
          if (props.event.key === 'Escape') {
            popup[0].hide();
            return true;
          }

          return component.ref?.onKeyDown(props.event) ?? false;
        },

        onExit() {
          popup[0].destroy();
          component.destroy();
        },
      };
    },
  };
}
