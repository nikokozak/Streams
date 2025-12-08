import { useState, useRef, useEffect } from 'react';
import { CellVersion } from '../types';

interface VersionDropdownProps {
  versions: CellVersion[];
  activeVersionId?: string;
  onSelectVersion: (versionId: string) => void;
}

export function VersionDropdown({
  versions,
  activeVersionId,
  onSelectVersion,
}: VersionDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Determine current version number
  const currentVersionIndex = activeVersionId
    ? versions.findIndex(v => v.id === activeVersionId)
    : versions.length - 1;
  const currentVersionNumber = currentVersionIndex >= 0 ? currentVersionIndex + 1 : versions.length;

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleSelectVersion = (versionId: string) => {
    onSelectVersion(versionId);
    setIsOpen(false);
  };

  // Format version date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="version-dropdown" ref={dropdownRef}>
      <button
        className="version-dropdown-trigger"
        onClick={() => setIsOpen(!isOpen)}
        title={`Version ${currentVersionNumber} of ${versions.length}`}
      >
        v{currentVersionNumber}
      </button>

      {isOpen && versions.length > 1 && (
        <div className="version-dropdown-menu">
          {versions.map((version, index) => {
            const isActive = version.id === activeVersionId ||
              (index === versions.length - 1 && !activeVersionId);

            return (
              <button
                key={version.id}
                className={`version-dropdown-item ${isActive ? 'version-dropdown-item--active' : ''}`}
                onClick={() => handleSelectVersion(version.id)}
              >
                <span className="version-dropdown-item-label">v{index + 1}</span>
                <span className="version-dropdown-item-time">{formatDate(version.createdAt)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
