# Ticker V2

AI-augmented research space for macOS.

> **IMPORTANT**: Never run the app. Only build. User runs it to avoid orphaned processes.

> **Build**: `xcodebuild build -scheme Ticker -destination 'platform=OS X' -derivedDataPath .build/xcode`

---

## Architecture

```
Swift (AppDelegate, Services) ↔ Bridge ↔ WKWebView (React + TipTap)
```

### Key Paths

```
Sources/Ticker/
├── App/
│   ├── AppDelegate.swift        # Window setup
│   ├── WebViewManager.swift     # Bridge handlers (CENTRAL HUB)
│   └── BridgeService.swift      # Swift ↔ JS messaging
├── Services/
│   ├── Prompts.swift            # All AI prompts (edit to tune behavior)
│   ├── AIService.swift          # OpenAI streaming
│   ├── PerplexityService.swift  # Real-time search
│   ├── DispatcherService.swift  # Query routing
│   ├── MLXClassifier.swift      # Local intent classification
│   ├── PersistenceService.swift # SQLite/GRDB
│   ├── SourceService.swift      # File bookmarks, PDF extraction
│   └── SettingsService.swift    # UserDefaults
├── Models/                      # Stream, Cell, SourceReference
└── Resources/

Web/src/
├── components/
│   ├── StreamEditor.tsx         # Main editor
│   ├── Cell.tsx                 # Dual-representation cells
│   ├── CellEditor.tsx           # TipTap wrapper
│   ├── SourcePanel.tsx          # Source sidebar
│   └── Settings.tsx             # API keys, routing toggle
├── utils/markdown.ts            # Markdown → HTML
└── styles/index.css
```

### Smart Routing

```
Query → MLXClassifier (local) → DispatcherService
                                    ├→ PerplexityService (search/news)
                                    └→ AIService (knowledge)
```

Enable in Settings. Requires Perplexity API key.

---

## Code Standards

1. No hacks. Delete over patch.
2. No dead code.
3. No force unwraps.
4. `async/await` for async code.
5. No `any` types in TypeScript.

---

## Commands

```bash
./dev.sh                          # Start Vite + build + run
cd Web && npm run typecheck       # Type check
```

---

## Key Concepts

- **Stream**: A thinking session with cells and sources
- **Cell**: Content unit (`text`, `aiResponse`, `quote`). May have `restatement` (heading form)
- **Prompts.swift**: Edit to tune AI behavior (markdown, terseness, etc.)
