import { useState, useEffect } from 'react';
import { bridge } from '../types';

interface SettingsData {
  hasOpenAIKey: boolean;
  openaiKeyPreview?: string;
  hasPerplexityKey: boolean;
  perplexityKeyPreview?: string;
  smartRoutingEnabled: boolean;
  classifierReady?: boolean;
  classifierLoading?: boolean;
  classifierError?: string;
}

interface SettingsProps {
  onClose: () => void;
}

export function Settings({ onClose }: SettingsProps) {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [openaiKey, setOpenaiKey] = useState('');
  const [perplexityKey, setPerplexityKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showPerplexityKey, setShowPerplexityKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [perplexitySaved, setPerplexitySaved] = useState(false);

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

  const handleSaveOpenAI = () => {
    bridge.send({
      type: 'saveSettings',
      payload: { openaiAPIKey: openaiKey },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setOpenaiKey(''); // Clear input after save
  };

  const handleSavePerplexity = () => {
    bridge.send({
      type: 'saveSettings',
      payload: { perplexityAPIKey: perplexityKey },
    });
    setPerplexitySaved(true);
    setTimeout(() => setPerplexitySaved(false), 2000);
    setPerplexityKey(''); // Clear input after save
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
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
                onClick={handleSaveOpenAI}
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

          <div className="settings-field">
            <label htmlFor="perplexity-key">Perplexity API Key (Optional)</label>
            <div className="settings-key-input">
              <input
                id="perplexity-key"
                type={showPerplexityKey ? 'text' : 'password'}
                value={perplexityKey}
                onChange={(e) => setPerplexityKey(e.target.value)}
                placeholder={settings?.perplexityKeyPreview || 'pplx-...'}
                autoComplete="off"
              />
              <button
                className="settings-toggle-visibility"
                onClick={() => setShowPerplexityKey(!showPerplexityKey)}
                type="button"
              >
                {showPerplexityKey ? 'Hide' : 'Show'}
              </button>
              <button
                className="settings-save-key"
                onClick={handleSavePerplexity}
                disabled={!perplexityKey}
              >
                {perplexitySaved ? 'Saved!' : 'Save'}
              </button>
            </div>
            <p className="settings-hint">
              {settings?.hasPerplexityKey
                ? 'Key is configured. Enables real-time search for current events.'
                : 'Enables real-time search. Get one at perplexity.ai'}
            </p>
          </div>
        </section>

        <section className="settings-section">
          <h2>AI Routing</h2>
          <div className="settings-field">
            <label
              className="settings-toggle-label"
              title={!settings?.hasPerplexityKey ? 'Requires Perplexity API key' : undefined}
            >
              <input
                type="checkbox"
                checked={settings?.smartRoutingEnabled ?? false}
                onChange={(e) => {
                  bridge.send({
                    type: 'saveSettings',
                    payload: { smartRoutingEnabled: e.target.checked },
                  });
                }}
                disabled={!settings?.hasPerplexityKey}
              />
              <span>Smart Routing</span>
            </label>
            <p className="settings-hint">
              {settings?.hasPerplexityKey
                ? 'When enabled, a local AI model analyzes your query to route it optimally: current events and real-time data go to Perplexity search, while knowledge questions go to GPT.'
                : 'Requires Perplexity API key. When enabled, queries are automatically routed to the best AI backend.'}
            </p>
            {settings?.smartRoutingEnabled && settings?.hasPerplexityKey && (
              <p className="settings-classifier-status">
                {settings.classifierError ? (
                  <span className="classifier-error">Classifier failed: {settings.classifierError}</span>
                ) : settings.classifierLoading && !settings.classifierReady ? (
                  <span className="classifier-loading">Loading local classifier...</span>
                ) : settings.classifierReady ? (
                  <span className="classifier-ready">Local classifier ready</span>
                ) : null}
              </p>
            )}
          </div>
        </section>

        <section className="settings-section">
          <h2>Keyboard Shortcuts</h2>
          <div className="settings-shortcuts">
            <div className="shortcut-row">
              <span className="shortcut-keys">Cmd+Enter</span>
              <span className="shortcut-desc">Think with AI</span>
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
