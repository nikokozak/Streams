# Ticker V2

An AI-augmented research space for macOS. Think *through* documents, not just *about* them.

> **IMPORTANT**: Never run the app (`swift run` or the built binary). Only build. The user will run the app themselves to avoid orphaned background processes.

> **Build with xcodebuild** (required for MLX Metal shaders):
> ```bash
> xcodebuild build -scheme Ticker -destination 'platform=OS X' -derivedDataPath .build/xcode
> ```
> The binary will be at `.build/xcode/Build/Products/Debug/Ticker`

---

## Philosophy

**Sound Architecture Over Speed.** Deep thought before implementation. No quick hacks. Either do it right or don't do it.

**Lens, not Silo.** Ticker attaches to your files as a thinking companion. Files stay where they are. Ticker adds a layer of cells, AI, and export on top.

---

## Architecture

```
Swift Shell (AppDelegate, Window, Services)
    ↓ Bridge (WKScriptMessageHandler)
WKWebView (React + TipTap)
```

- **Swift**: App lifecycle, window management, file access, AI calls, persistence
- **React**: Cell editing, UI state, streaming display
- **Bridge**: JSON messages between Swift and JavaScript

### Key File Paths

```
Sources/Ticker/
├── App/
│   ├── AppDelegate.swift        # App lifecycle, window setup
│   ├── WebViewManager.swift     # Bridge message handlers (CENTRAL HUB)
│   └── BridgeService.swift      # Swift ↔ JS communication
├── Services/
│   ├── PersistenceService.swift # SQLite/GRDB database
│   ├── AIService.swift          # OpenAI API, streaming, restatements
│   ├── DispatcherService.swift  # Query routing (search vs knowledge)
│   ├── MLXClassifier.swift      # Local LLM for intent classification
│   ├── PerplexityService.swift  # Real-time search API
│   ├── SourceService.swift      # File bookmarks, PDF extraction
│   └── SettingsService.swift    # UserDefaults storage
├── Models/
│   ├── Stream.swift             # Thinking session
│   ├── Cell.swift               # Content unit (text/aiResponse/quote)
│   └── SourceReference.swift    # File pointer with bookmark
└── Resources/

Web/src/
├── App.tsx                      # Root, view routing
├── components/
│   ├── StreamEditor.tsx         # Main editor (cells + sources)
│   ├── Cell.tsx                 # Single cell with dual-representation
│   ├── CellEditor.tsx           # TipTap wrapper
│   ├── SourcePanel.tsx          # Collapsible source sidebar
│   └── Settings.tsx             # API key configuration
├── types/
│   ├── models.ts                # Cell, Stream, Source types
│   └── bridge.ts                # Bridge message types
├── utils/
│   └── markdown.ts              # Markdown → HTML conversion
└── styles/
    └── index.css                # All styles
```

### Dispatcher Architecture

```
User Query → MLXClassifier (Qwen2.5-0.5B, local)
                ↓ classify intent
           DispatcherService
                ↓ route by intent
    ┌───────────┴───────────┐
    ▼                       ▼
AIService              PerplexityService
(OpenAI GPT)           (Real-time search)
```

The local MLX model runs entirely on-device for fast classification without API calls.
Intents: `search`, `knowledge`, `expand`, `summarize`, `rewrite`, `extract`, `ambiguous`

---

## Code Standards

### Non-Negotiables

1. **No hacks.** If it feels wrong, stop and think. Delete over patch.
2. **No dead code.** Remove unused imports, functions, files immediately.
3. **No magic numbers.** Constants go in one place with clear names.
4. **No force unwraps** in production code. Handle optionals properly.
5. **No technical debt.** Either do it right now or don't do it.
6. **Protocols for abstraction.** Design for testability and future extension.

### Swift Style

```swift
// Good: Clear, explicit, handles errors
func loadStream(id: UUID) async throws -> Stream {
    guard let stream = try await persistence.fetchStream(id: id) else {
        throw StreamError.notFound(id)
    }
    return stream
}

// Bad: Force unwraps, unclear intent
func loadStream(id: UUID) -> Stream {
    return persistence.fetchStream(id: id)!
}
```

- Use `async/await` for all asynchronous code
- Use `@MainActor` for UI-related services
- Prefer value types (structs) over reference types (classes)
- Use protocols for testability and abstraction boundaries
- Keep functions under 30 lines; extract if longer

### TypeScript Style

```typescript
// Good: Typed, explicit, null-safe
function getCell(id: string, cells: Cell[]): Cell | null {
  return cells.find(c => c.id === id) ?? null;
}

// Bad: Any types, implicit nulls
function getCell(id: any, cells: any) {
  return cells.find((c: any) => c.id === id);
}
```

- No `any` types. Ever.
- Use discriminated unions for state
- Prefer `const` over `let`
- Use optional chaining (`?.`) and nullish coalescing (`??`)

---

## Key Abstractions

### Stream
A thinking session. Has a title, sources, and cells.

### Cell
A unit of content. Types: `text` (user), `aiResponse` (AI), `quote` (from source).
- May have `restatement` - heading form shown in display mode
- May have `sourceBinding` linking to source location

### SourceReference
A pointer to an external file (PDF, text). Uses security-scoped bookmarks.

### Bridge Message
JSON messages between Swift and React. Always has `type` and optional `payload`.

---

## Current Features

- **Cmd+Enter**: Send cell to AI with full session context
- **Dual-representation cells**: Questions become headings, click to edit original
- **Markdown support**: Headings, lists, code blocks, blockquotes
- **Auto-prune**: Empty cells delete on blur
- **Collapsible sources**: Toggle source panel visibility
- **Editable titles**: Click stream title to rename

---

## Development Workflow

### Commands

```bash
# Swift
swift build                    # Build
swift run                      # Run (do this yourself)

# Web
cd Web && npm run dev          # Development server
cd Web && npm run typecheck    # Type checking
```

### Git

- **Never** commit without building first
- Commit messages: `type: description` (e.g., `feat: add source panel`)
- Types: `feat`, `fix`, `refactor`, `docs`, `chore`

---

## What NOT to Do

- Don't add features without thinking through architecture
- Don't optimize prematurely
- Don't add dependencies without good reason
- Don't write comments explaining *what*; write code that's self-evident
- Don't leave `print` statements in committed code (except temporary debug)
- Don't catch and ignore errors silently

---

## Reference

- `/Users/niko/Documents/ITP/ChatWindow` - Original Ticker (V1) for inspiration
