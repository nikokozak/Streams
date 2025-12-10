# Ticker

macOS research app: Swift backend + React/TipTap frontend in WKWebView + global Quick Panel.

## Commands

```bash
xcodebuild build -scheme Ticker -destination 'platform=OS X' -derivedDataPath .build/xcode
cd Web && npm run typecheck
```

**Never run the app** — only build. User runs to avoid orphaned processes.

## Architecture

```
                    AppDelegate
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   HotkeyService    Main Window      Quick Panel
   (global Cmd+L)   (NSWindow)       (NSPanel)
        │                │                │
        │           WKWebView        SwiftUI
        │           (React)          (Native)
        │                │                │
        └───────> BridgeService <─────────┘
                         │
                  Swift Services
```

### Swift (`Sources/Ticker/`)

| File | Purpose |
|------|---------|
| `App/AppDelegate.swift` | App entry, hotkeys, window management |
| `App/WebViewManager.swift` | Central hub — all bridge message handlers |
| `App/BridgeService.swift` | Swift ↔ JS messaging |
| `App/AssetSchemeHandler.swift` | Serves `ticker-asset://` URLs to webview |
| `App/QuickPanel/QuickPanelWindow.swift` | Floating NSPanel for global capture |
| `App/QuickPanel/QuickPanelManager.swift` | Panel lifecycle, cell creation |
| `App/QuickPanel/QuickPanelView.swift` | SwiftUI panel UI |
| `Services/System/HotkeyService.swift` | Global hotkey registration (Carbon) |
| `Services/System/SelectionReaderService.swift` | Read selected text (Accessibility) |
| `Services/System/ClipboardService.swift` | Clipboard image detection |
| `Services/StreamActivityService.swift` | Track active stream for targeting |
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
| `components/SidePanel.tsx` | Tabbed sidebar — outline + sources |
| `components/SearchModal.tsx` | Cmd+K hybrid search |
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
  - `sourceApp`: Origin app name (for quote cells from Quick Panel)
- **SourceReference**: Attached file with extracted text, embeddings

## Quick Panel

Global capture panel accessible via **Cmd+L** from any app. Captures selected text, screenshots, and notes.

**Hotkeys:**
- `Cmd+L` — Toggle Quick Panel (captures selection before opening)
- `Cmd+;` — Screenshot mode (triggers screencapture, then opens panel)

**Input Modes:**
| Context | Action | Result |
|---------|--------|--------|
| Selection + ENTER | Capture | Quote cell with sourceApp |
| Selection + text + ENTER | Capture + note | Quote + text cells |
| Selection + text + CMD+ENTER | Capture + AI | Quote + AI response |
| Text only + ENTER | Note | Text cell |
| Text only + CMD+ENTER | AI query | AI response cell |

**Stream Targeting:**
- Default: Most recently modified stream
- After 15min idle: Show stream picker
- No streams: Create "Untitled"

**Reference Implementation:** See `/Users/niko/Documents/ITP/ChatWindow/` for patterns (HotkeyService, SelectionReaderService, QuickPanelManager)

## Known Technical Debt

### MAJOR: Markdown-first editing (not yet implemented)
Currently cells store rendered HTML and TipTap edits the rich text directly. This means users cannot edit the underlying markdown source (e.g., change `## Header` to `### Header`).

**Required refactor:**
- Store raw markdown as the source of truth, not HTML
- Render markdown → HTML only for display
- TipTap edits should produce markdown, not HTML
- Consider CodeMirror/Monaco for true markdown editing, or TipTap with markdown storage

This is a fundamental architecture change affecting: `CellEditor.tsx`, `markdownToHtml()`, cell persistence, AI response handling.

## Code Standards

1. Delete over patch — no hacks
2. No dead code
3. No force unwraps in Swift
4. No `any` types in TypeScript
5. `async/await` for async code

## Strategic Guidance

When discussing product direction: challenge assumptions, name tradeoffs, ground opinions in evidence. Distinguish "exciting" from "valuable." Be concrete about feasibility. The goal is collaborative rigor.
