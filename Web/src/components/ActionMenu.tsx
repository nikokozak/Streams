import { useEffect, useRef } from 'react';

export interface Action {
  id: string;
  name: string;
  description: string;
}

export const ACTIONS: Action[] = [
  { id: 'summarize', name: 'Summarize', description: 'Create a concise summary' },
  { id: 'expand', name: 'Expand', description: 'Add more detail and examples' },
  { id: 'rewrite', name: 'Rewrite', description: 'Improve clarity and polish' },
  { id: 'ask', name: 'Ask', description: 'Ask a question about the sources' },
  { id: 'extract', name: 'Extract', description: 'Pull out key points' },
];

interface ActionMenuProps {
  filter: string;
  selectedIndex: number;
  position: { top: number; left: number };
  onSelect: (action: Action) => void;
  onClose: () => void;
}

export function ActionMenu({
  filter,
  selectedIndex,
  position,
  onSelect,
  onClose,
}: ActionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const filteredActions = ACTIONS.filter(
    (action) =>
      action.name.toLowerCase().includes(filter.toLowerCase()) ||
      action.id.toLowerCase().includes(filter.toLowerCase())
  );

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (filteredActions.length === 0) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      className="action-menu"
      style={{ top: position.top, left: position.left }}
    >
      {filteredActions.map((action, index) => (
        <button
          key={action.id}
          className={`action-menu-item ${index === selectedIndex ? 'selected' : ''}`}
          onClick={() => onSelect(action)}
        >
          <span className="action-name">/{action.id}</span>
          <span className="action-description">{action.description}</span>
        </button>
      ))}
    </div>
  );
}

export function getFilteredActions(filter: string): Action[] {
  return ACTIONS.filter(
    (action) =>
      action.name.toLowerCase().includes(filter.toLowerCase()) ||
      action.id.toLowerCase().includes(filter.toLowerCase())
  );
}
