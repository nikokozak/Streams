import { useState, useRef, useEffect } from 'react';
import { Modifier, CellVersion } from '../types';

interface ModifierMenuRowProps {
  text: string;
  versionLabel?: string;
  isActive?: boolean;
  showRegenerate?: boolean;
  onRegenerate: (newText: string) => void;
  onSelect?: () => void;
}

function ModifierMenuRow({ text, versionLabel, isActive = false, showRegenerate = true, onRegenerate, onSelect }: ModifierMenuRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(text);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync editText when text prop changes
  useEffect(() => {
    setEditText(text);
  }, [text]);

  const handleTextClick = () => {
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleRegenerate = () => {
    if (editText.trim()) {
      onRegenerate(editText.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRegenerate();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditText(text);
    }
  };

  const handleBlur = () => {
    setIsEditing(false);
    setEditText(text);
  };

  return (
    <div className={`modifier-menu-row ${isActive ? 'modifier-menu-row--active' : ''}`}>
      {versionLabel && (
        <button
          className={`modifier-menu-version ${isActive ? 'modifier-menu-version--active' : ''}`}
          onClick={onSelect}
          title="Switch to this version"
        >
          {versionLabel}
        </button>
      )}
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          className="modifier-menu-input"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <span className="modifier-menu-text" onClick={handleTextClick}>
          {text}
        </span>
      )}
      {showRegenerate && (
        <button
          className="modifier-menu-regenerate"
          onClick={handleRegenerate}
          title="Regenerate from here"
        >
          ↻
        </button>
      )}
    </div>
  );
}

interface ModifierMenuProps {
  originalPrompt: string;
  modifiers: Modifier[];
  versions: CellVersion[];
  activeVersionId?: string;
  isProcessing?: boolean;
  pendingModifierPrompt?: string;
  onClose: () => void;
  onRegenerateFromOriginal: (newPrompt: string) => void;
  onRegenerateFromModifier: (modifierIndex: number, newPrompt: string) => void;
  onAddModifier: (prompt: string) => void;
  onSelectVersion: (versionId: string) => void;
}

export function ModifierMenu({
  originalPrompt,
  modifiers,
  versions,
  activeVersionId,
  isProcessing = false,
  pendingModifierPrompt,
  onClose,
  onRegenerateFromOriginal,
  onRegenerateFromModifier,
  onAddModifier,
  onSelectVersion,
}: ModifierMenuProps) {
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newModifierText, setNewModifierText] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  // Close on Escape only (not click outside, since menu is inline now)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Focus new modifier input when adding
  useEffect(() => {
    if (isAddingNew) {
      setTimeout(() => newInputRef.current?.focus(), 0);
    }
  }, [isAddingNew]);

  const handleAddModifier = () => {
    if (newModifierText.trim()) {
      onAddModifier(newModifierText.trim());
      setNewModifierText('');
      setIsAddingNew(false);
    }
  };

  const handleNewModifierKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddModifier();
    } else if (e.key === 'Escape') {
      setIsAddingNew(false);
      setNewModifierText('');
    }
  };

  // V1 is original, V2+ are from modifiers
  // Versions array: index 0 = V1 (original), index 1 = V2 (first modifier), etc.
  const totalVersions = versions.length || 1;

  // Determine which version is active (default to latest)
  const getActiveVersionIndex = (): number => {
    if (!activeVersionId || versions.length === 0) return totalVersions - 1;
    const idx = versions.findIndex(v => v.id === activeVersionId);
    return idx >= 0 ? idx : totalVersions - 1;
  };
  const activeIndex = getActiveVersionIndex();

  return (
    <div
      className="modifier-menu"
      ref={menuRef}
      // Keep clicks inside the menu from being swallowed by the editor's focus handling
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Original prompt row - only show regenerate if not processing */}
      <ModifierMenuRow
        text={originalPrompt}
        versionLabel="V1"
        isActive={activeIndex === 0}
        showRegenerate={!isProcessing && versions.length > 0}
        onRegenerate={onRegenerateFromOriginal}
        onSelect={versions.length > 0 ? () => onSelectVersion(versions[0].id) : undefined}
      />

      {/* Modifier rows with arrows and version labels */}
      {modifiers.map((mod, index) => {
        const versionIndex = index + 1;
        const version = versions[versionIndex];
        const isThisActive = activeIndex === versionIndex;
        // Only show regenerate if this version exists (streaming complete)
        const hasCompletedVersion = !!version;

        return (
          <div key={mod.id}>
            <div className="modifier-menu-arrow">↓</div>
            <ModifierMenuRow
              text={mod.prompt}
              versionLabel={`V${index + 2}`}
              isActive={isThisActive}
              showRegenerate={!isProcessing && hasCompletedVersion}
              onRegenerate={(newPrompt) => onRegenerateFromModifier(index, newPrompt)}
              onSelect={hasCompletedVersion ? () => onSelectVersion(version.id) : undefined}
            />
          </div>
        );
      })}

      {/* Pending modifier (being processed) */}
      {isProcessing && pendingModifierPrompt && (
        <div className="modifier-menu-pending">
          <div className="modifier-menu-arrow">↓</div>
          <div className="modifier-menu-row">
            <span className="modifier-menu-version modifier-menu-version--pending">V{totalVersions + 1}</span>
            <span className="modifier-menu-text modifier-menu-text--pending">{pendingModifierPrompt}</span>
            <div className="modifier-menu-spinner" />
          </div>
        </div>
      )}

      {/* Processing spinner for initial prompt (no pending modifier text) */}
      {isProcessing && !pendingModifierPrompt && modifiers.length === 0 && (
        <div className="modifier-menu-processing">
          <div className="modifier-menu-spinner" />
        </div>
      )}

      {/* Add new modifier section - hidden when processing */}
      {!isProcessing && (
        isAddingNew ? (
          <div className="modifier-menu-add-form">
            <div className="modifier-menu-arrow">↓</div>
            <div className="modifier-menu-row">
              <span className="modifier-menu-version modifier-menu-version--pending">V{totalVersions + 1}</span>
              <input
                ref={newInputRef}
                type="text"
                className="modifier-menu-input"
                value={newModifierText}
                onChange={(e) => setNewModifierText(e.target.value)}
                onKeyDown={handleNewModifierKeyDown}
                onBlur={() => {
                  // Don't auto-close on blur - focus can move unexpectedly due to
                  // TipTap/ProseMirror focus management. User can press Escape to cancel
                  // or click elsewhere to close the menu entirely.
                }}
                placeholder="e.g., make it shorter"
              />
              <button
                className="modifier-menu-regenerate"
                onClick={handleAddModifier}
                title="Apply modifier"
              >
                ↻
              </button>
            </div>
          </div>
        ) : (
          <button
            className="modifier-menu-add"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsAddingNew(true);
            }}
          >
            + Add modifier
          </button>
        )
      )}
    </div>
  );
}
