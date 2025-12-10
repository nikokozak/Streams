# Ticker

macOS research app: Swift backend + React/TipTap frontend in WKWebView.

## Commands

```bash
xcodebuild build -scheme Ticker -destination 'platform=OS X' -derivedDataPath .build/xcode
cd Web && npm run typecheck
```

**Never run the app** — only build. User runs to avoid orphaned processes.

## Architecture

```
Swift Services ↔ BridgeService ↔ WKWebView (React + Zustand + TipTap)
```

### Swift (`Sources/Ticker/`)

| File | Purpose |
|------|---------|
| `App/WebViewManager.swift` | Central hub — all bridge message handlers |
| `App/BridgeService.swift` | Swift ↔ JS messaging |
| `App/AssetSchemeHandler.swift` | Serves `ticker-asset://` URLs to webview |
| `Services/Prompts.swift` | All AI prompts — edit to tune behavior |
| `Services/AIOrchestrator.swift` | Routes queries to AI providers |
| `Services/AIService.swift` | OpenAI streaming (implements `LLMProvider`) |
| `Services/PerplexityService.swift` | Real-time search (implements `LLMProvider`) |
| `Services/PersistenceService.swift` | SQLite via GRDB |
| `Services/AssetService.swift` | Local image storage in `~/.config/ticker/assets/` |
| `Services/RetrievalService.swift` | RAG — semantic search over sources |
| `Services/EmbeddingService.swift` | Local embeddings via MLX |
| `Models/Cell.swift` | Cell with modifiers, versions, processing config |

### Web (`Web/src/`)

| File | Purpose |
|------|---------|
| `App.tsx` | Root — stream loading, layout |
| `components/StreamEditor.tsx` | Main editor surface |
| `components/BlockWrapper.tsx` | Cell chrome — hover controls, drag handle |
| `components/CellEditor.tsx` | TipTap editor wrapper |
| `components/SourcePanel.tsx` | Right sidebar — sources, embeddings |
| `store/blockStore.ts` | Zustand — cells, streaming state, errors |
| `hooks/useBridgeMessages.ts` | Handles all bridge messages from Swift |
| `utils/markdown.ts` | Markdown → sanitized HTML (DOMPurify) |
| `types/` | TypeScript types and bridge message definitions |

## Data Model

- **Stream**: Research session with cells and source references
- **Cell**: Content block (`text`, `aiResponse`, `quote`)
  - `modifiers`: Transformation chain (e.g., "make shorter")
  - `versions`: Content snapshots from modifier applications
  - `originalPrompt`: User's input (for AI response cells)
- **SourceReference**: Attached file with extracted text, embeddings

## Code Standards

1. Delete over patch — no hacks
2. No dead code
3. No force unwraps in Swift
4. No `any` types in TypeScript
5. `async/await` for async code

## Strategic Guidance

When discussing product direction: challenge assumptions, name tradeoffs, ground opinions in evidence. Distinguish "exciting" from "valuable." Be concrete about feasibility. The goal is collaborative rigor.
