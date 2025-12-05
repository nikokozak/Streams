import { useState, useEffect } from 'react';
import { bridge } from '../types';

interface SettingsData {
  hasOpenAIKey: boolean;
  openaiKeyPreview?: string;
}

interface SettingsProps {
  onClose: () => void;
}

export function Settings({ onClose }: SettingsProps) {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [openaiKey, setOpenaiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load settings on mount
  useEffect(() => {
    const unsubscribe = bridge.onMessage((message) => {
      if (message.type === 'settingsLoaded' && message.payload?.settings) {
        setSettings(message.payload.settings as SettingsData);
      }
    });

    bridge.send({ type: 'loadSettings' });

    return unsubscribe;
  }, []);

  const handleSave = () => {
    bridge.send({
      type: 'saveSettings',
      payload: { openaiAPIKey: openaiKey },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setOpenaiKey(''); // Clear input after save
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
    if (e.key === 'Enter' && openaiKey) {
      handleSave();
    }
  };

  return (
    <div className="settings" onKeyDown={handleKeyDown}>
      <header className="settings-header">
        <h1>Settings</h1>
        <button onClick={onClose} className="settings-close">
          Done
        </button>
      </header>

      <div className="settings-content">
        <section className="settings-section">
          <h2>API Keys</h2>

          <div className="settings-field">
            <label htmlFor="openai-key">OpenAI API Key</label>
            <div className="settings-key-input">
              <input
                id="openai-key"
                type={showKey ? 'text' : 'password'}
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder={settings?.openaiKeyPreview || 'sk-...'}
                autoComplete="off"
              />
              <button
                className="settings-toggle-visibility"
                onClick={() => setShowKey(!showKey)}
                type="button"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
              <button
                className="settings-save-key"
                onClick={handleSave}
                disabled={!openaiKey}
              >
                {saved ? 'Saved!' : 'Save'}
              </button>
            </div>
            <p className="settings-hint">
              {settings?.hasOpenAIKey
                ? 'Key is configured. Enter a new key to replace it.'
                : 'Required for AI features. Get one at platform.openai.com'}
            </p>
          </div>
        </section>

        <section className="settings-section">
          <h2>Keyboard Shortcuts</h2>
          <div className="settings-shortcuts">
            <div className="shortcut-row">
              <span className="shortcut-keys">/command</span>
              <span className="shortcut-desc">AI actions (summarize, expand, etc.)</span>
            </div>
            <div className="shortcut-row">
              <span className="shortcut-keys">Enter</span>
              <span className="shortcut-desc">New cell (at end of content)</span>
            </div>
            <div className="shortcut-row">
              <span className="shortcut-keys">Backspace</span>
              <span className="shortcut-desc">Delete empty cell</span>
            </div>
            <div className="shortcut-row">
              <span className="shortcut-keys">Arrow Up/Down</span>
              <span className="shortcut-desc">Navigate between cells</span>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2>About</h2>
          <p className="settings-about">
            Ticker V2 - An AI-augmented research space.
            <br />
            Think <em>through</em> documents, not just <em>about</em> them.
          </p>
        </section>
      </div>
    </div>
  );
}
