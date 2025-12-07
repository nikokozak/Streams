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
│   ├── AIOrchestrator.swift     # Routes queries to providers
│   ├── AIService.swift          # OpenAI streaming (LLMProvider)
│   ├── PerplexityService.swift  # Real-time search (LLMProvider)
│   ├── MLXClassifier.swift      # Local intent classification
│   ├── PersistenceService.swift # SQLite/GRDB
│   ├── SourceService.swift      # File bookmarks, PDF extraction
│   ├── SettingsService.swift    # UserDefaults
│   └── Providers/
│       └── LLMProvider.swift    # Protocol for AI providers
├── Models/
│   ├── Cell.swift               # Cell with modifiers, versions, processing
│   ├── ProcessingConfig.swift   # Live blocks, schemas, auto-transforms
│   ├── Stream.swift
│   └── SourceReference.swift
└── Resources/

Web/src/
├── components/
│   ├── StreamEditor.tsx         # Main editor
│   ├── Cell.tsx                 # Dual-representation cells
│   ├── CellEditor.tsx           # TipTap wrapper
│   ├── SourcePanel.tsx          # Source sidebar
│   └── Settings.tsx             # API keys, routing toggle
├── store/
│   └── blockStore.ts            # Zustand state (cells, streaming, errors)
├── utils/markdown.ts            # Markdown → HTML
├── types/models.ts              # TypeScript types
└── styles/index.css
```

### Smart Routing

```
Query → AIOrchestrator → MLXClassifier (local)
                             ├→ PerplexityService (search/news)
                             └→ AIService (knowledge)
```

Enable in Settings. Requires Perplexity API key.

### Provider Pattern

AI services implement `LLMProvider` protocol for extensibility:
```swift
protocol LLMProvider {
    var id: String { get }
    var isConfigured: Bool { get }
    func stream(request: LLMRequest, onChunk:, onComplete:, onError:) async
}
```

### Block Processing (WIP)

Cells can have `ProcessingConfig` for:
- `refreshTrigger`: `onStreamOpen` (live), `onDependencyChange`, `manual`
- `schema`: JSON Schema validation
- `autoTransform`: Rules for automatic transformations
- `references`: Block dependencies (`@block-xxxx` syntax)
- `blockName`: Short name for @mentions

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
- **Cell**: Content unit (`text`, `aiResponse`, `quote`)
  - `restatement`: Heading form for prompts
  - `originalPrompt`: User's original text (for AI responses)
  - `modifiers`: Chain of applied transformations
  - `versions`: Content snapshots from modifier chain
  - `processingConfig`: Live refresh, schemas, auto-transforms
- **blockStore (Zustand)**: Centralized state for all cells
- **Prompts.swift**: Edit to tune AI behavior

---

## Strategic Engagement Guidelines

When discussing product direction, architecture decisions, or strategic pivots:

1. **Do not simply agree.** The user needs a thinking partner who will find holes, identify risks, and present contrary evidence—not a mirror that reflects their current enthusiasm back at them.

2. **Ground opinions in evidence.** Before offering a recommendation, research: What have similar apps done? What worked? What failed? What does the competitive landscape look like? What do users actually do (not what they say they want)?

3. **Name the tradeoffs explicitly.** Every direction has costs. If recommending path A, articulate what's lost by not taking path B. If something feels like an obvious choice, that's a signal to look harder for what's being missed.

4. **Distinguish between "exciting" and "valuable."** Technically interesting features may not be what users need. Novel ideas may not have product-market fit. Evaluate ideas against: Who specifically would use this? What are they doing today instead? Why would they switch?

5. **Maintain independent perspective across the conversation.** If the user's position shifts, don't automatically shift with it. Ask: What new information justified this change? Was the previous direction actually wrong, or just less fashionable now?

6. **Be concrete about feasibility.** Time estimates, technical complexity, dependencies, risks. Vague optimism helps no one.

The goal is collaborative rigor, not conflict—but rigor requires willingness to disagree.
