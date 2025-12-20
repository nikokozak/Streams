# Ticker

macOS research app: Swift backend + React/TipTap frontend in WKWebView + global Quick Panel.

## CRITICAL: Working Practices

**These rules override default behavior. Follow them exactly.**

### Before Any Implementation

1. **Restate the requirement in your own words** and get explicit confirmation before writing code
2. **Ask clarifying questions** if there is ANY ambiguity about what is being requested
3. **Distinguish between** what the user said vs what you interpreted vs what you assume
4. **If a task seems straightforward, be MORE suspicious** — that's when misunderstandings happen

### During Implementation

1. **Work in small, verifiable increments** — commit and test frequently
2. **Stop and ask** if scope expands or you encounter unexpected complexity
3. **Do not "improve" or add features** beyond what was explicitly requested
4. **If you're uncertain, say so** — don't paper over uncertainty with code

### After Implementation

1. **Describe what you built** in plain terms — does it match what was asked?
2. **Identify what you did NOT implement** — make omissions explicit
3. **Ask the user to verify** before moving on

### Collaboration with GPT-5.2

For non-trivial work:
- Ask GPT-5.2 for blast radius analysis and edge cases BEFORE starting
- Ask GPT-5.2 to review diffs AFTER each change
- If GPT-5.2 flags a concern, address it before continuing

### Commit Approval Workflow

**DO NOT COMMIT until GPT approves the change.**

After completing a slice/task, provide a comprehensive summary that includes:

1. **What was built** — Files created/modified, their purpose, key implementation details
2. **Schema/architecture decisions** — Any structural choices and why
3. **What was NOT built** — Explicit list of deferred functionality
4. **How it integrates** — How new code connects to existing systems
5. **Testing instructions** — How to verify the change works
6. **Risks/concerns** — Anything that might break or needs attention
7. **Code snippets** — Key code sections for review (not just file names)

The user will share this summary with GPT for review. Only commit after approval.

## Commands

```bash
xcodebuild build -project Ticker.xcodeproj -scheme Ticker -destination 'platform=macOS' -derivedDataPath .build/xcode
cd Web && npm run typecheck
```

**Never run the app** — only build. User runs to avoid orphaned processes.

> **iCloud Note**: If building from an iCloud-synced workspace causes codesign/xattr errors ("resource fork, Finder information, or similar detritus not allowed"), move the repo out of iCloud (preferred) or use `-derivedDataPath /tmp/ticker-xcode-build` as a workaround.

> **Build Number**: For release builds, set `CURRENT_PROJECT_VERSION=$(git rev-list --count HEAD)` to get monotonic build numbers. CI does this automatically.

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
| `Models/Cell.swift` | Cell with modifiers, processing config |

### Web (`Web/src/`)

| File | Purpose |
|------|---------|
| `App.tsx` | Root — stream loading, layout, toast display |
| `components/UnifiedStreamEditor.tsx` | **Main editor** — single TipTap instance for cross-cell selection |
| `components/StreamEditor.tsx` | Legacy editor (fallback via Settings or `?unified=false`) |
| `components/CellOverlay.tsx` | AI cell info overlay — regenerate, model, live toggle |
| `components/SidePanel.tsx` | Tabbed sidebar — outline + sources |
| `components/SearchModal.tsx` | Cmd+K hybrid search |
| `components/ToastStack.tsx` | Error/info toast notifications |
| `extensions/CellBlock.ts` | TipTap node — `cellBlock` with `block+` content |
| `extensions/CellBlockView.tsx` | React NodeView — cell chrome, drag handle, streaming indicator |
| `extensions/CellKeymap.ts` | Enter/Backspace/Arrow boundary rules |
| `extensions/CellClipboard.ts` | Cross-cell copy/paste handling |
| `store/blockStore.ts` | Zustand — cells, streaming state, errors, overlay |
| `store/toastStore.ts` | Zustand — toast notification state |
| `hooks/useBridgeMessages.ts` | Handles all bridge messages from Swift |
| `utils/featureFlags.ts` | Runtime flags (unified editor default ON) |
| `utils/markdown.ts` | Markdown → sanitized HTML (DOMPurify) |
| `types/` | TypeScript types and bridge message definitions |

## Data Model

- **Stream**: Research session with cells and source references
- **Cell**: Content block (`text`, `aiResponse`, `quote`)
  - `modifiers`: Transformation chain (e.g., "make shorter")
  - `originalPrompt`: User's input (for AI response cells)
  - `sourceApp`: Origin app name (for quote cells from Quick Panel)
  - `processingConfig`: Live block settings (refresh triggers)
- **SourceReference**: Attached file with extracted text, embeddings

## Editor Architecture

The app uses a **unified editor** — a single TipTap instance for the entire stream:

- **Schema**: `doc -> cellBlock+`, where `cellBlock -> block+` (rich content)
- **Cross-cell selection**: Native ProseMirror selection spans multiple cells
- **Cell identity**: UUID-based (`data-cell-id` attribute), never positional
- **Data flow**: TipTap → Store → Persistence (one direction during editing)
- **External updates** (AI complete, Quick Panel): Write TO TipTap, then normal flow resumes

Legacy editor remains available via Settings toggle or `?unified=false` URL param.

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

## Code Standards

1. Delete over patch — no hacks
2. No dead code
3. No force unwraps in Swift
4. No `any` types in TypeScript
5. `async/await` for async code

## Strategic Guidance

When discussing product direction: challenge assumptions, name tradeoffs, ground opinions in evidence. Distinguish "exciting" from "valuable." Be concrete about feasibility. The goal is collaborative rigor.
