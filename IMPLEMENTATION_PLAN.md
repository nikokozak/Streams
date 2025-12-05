# Ticker V2: Implementation Plan

**Version:** 3.0 (Source-Attached Model)
**Date:** December 2024
**Architecture:** Hybrid Swift + WKWebView

---

## Executive Summary

### The Core Philosophy: Lens, Not Silo

Ticker is a **thinking companion** that attaches to your work, not a destination that replaces your workflow.

| Approach | Mental Model | Product Category |
|----------|--------------|------------------|
| **Notion/Roam (Silo)** | "Bring everything here" | Destination workspace |
| **Ticker (Lens)** | "Think alongside your files" | AI-augmented research space |

The key insight: people think *about* things—documents, articles, data. The blank-canvas model assumes creation ex nihilo. Ticker assumes thinking is always **situated in existing material**.

### What Changed From V2 of This Plan

Based on peer review focusing on the "file ecosystem" question:

| Aspect | V2 Plan | V3 Plan (Source-Attached) |
|--------|---------|---------------------------|
| **Mental Model** | Files are imported, become cells | Files are referenced, remain external |
| **Stream Concept** | Collection of cells | Thinking layer attached to sources |
| **File Handling** | Single file → single cell | Multiple source attachments per stream |
| **Cell-to-Source** | No binding | SourceBinding with location |
| **UI Structure** | Single pane editor | Editor + collapsible source panel |
| **Entry Point** | Blank stream | Stream list with "New" / "New from File" |
| **Scope** | 25 days, 5 weeks | 30 days, 6 weeks |

### Why Source-Attached

1. **Matches real knowledge work** - Academics annotate sources then synthesize. Analysts gather data then interpret. Writers research then draft. Ticker becomes a *thinking tool* rather than a *writing tool*.

2. **Solves the "dead copy" problem** - Imported files drift from originals. Live references mean the source is canonical. Ticker's cells are *commentary*, not replacement.

3. **Location binding is novel** - "Cell 5 references page 12 of contract.pdf" enables jump-to-source, citation export, and grounded AI context. No AI writing tool does this well.

4. **Answers "why use this?"** - The blank-canvas model competes with every note app. Source-attached has a clear answer: *"I have this document. I want to think through it with AI."*

### Why Hybrid Architecture

The "cell editing" problem is the highest-risk part of this build. Three reviewers independently flagged that building a native block editor in Swift would consume most of our timeline.

**The solution:** Use web technologies (React + TipTap) for the editor, embedded in a native Swift shell via WKWebView.

**Benefits:**
- TipTap solves cell editing in days, not weeks
- WKWebView uses system WebKit (lightweight, not Chromium)
- Swift shell gives native hotkeys, window management, accessibility APIs
- This is how Bear, Craft, and other modern Mac editors work

---

## 1. Product Definition

### 1.1 One-Sentence Description

Ticker is an AI-augmented research space where you think *through* documents—attaching sources, annotating with cells, and building understanding with AI as collaborator.

### 1.2 Core Concepts

| Concept | Description |
|---------|-------------|
| **Stream** | A thinking session attached to source materials |
| **Sources** | External files (PDF, text, images) that remain live references |
| **Cells** | Thoughts, annotations, AI explorations about sources |
| **Source Binding** | Link from cell → specific location in source |
| **Actions** | AI transformations invoked via `/commands` |
| **Export** | Stream → Markdown with citations |

### 1.3 The Two Entry Points

1. **"New from File..."** - Create stream anchored to a source document (primary use case)
2. **"New Stream"** - Blank thinking space without sources (scratchpad mode)

Both are valid. A stream can have zero, one, or many sources.

### 1.4 What V0.1 Is NOT

- Not a general-purpose text editor (no rich formatting)
- Not a file manager or Finder replacement
- Not a notebook with executable code cells
- Not collaborative (single-user only)
- Not cross-platform (macOS only)
- Not a "capture from anywhere" tool (Quick Panel is V0.2)
- Not a file storage system (files stay where they are)

### 1.5 The "Lens" Philosophy

Ticker is a **computational lens** over your work, not a **destination silo**.

- Files are **referenced**, not copied—the source is canonical
- Cells are **commentary** on sources, not replacements
- Context is **gathered** from attached sources
- Output is **exportable** with proper citations
- The stream **augments** your thinking, it doesn't own your files

### 1.6 Key UX Principle

Every interaction should reinforce:
> "You bring something. We help you think through it. The source stays primary."

---

## 2. Architecture Overview

### 2.1 High-Level Structure

```
┌───────────────────────────────────────────────────────────────────┐
│                      Swift Application Shell                       │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                       MainWindow                           │   │
│  │                                                           │   │
│  │  ┌─────────┬─────────────────────────────────────────┐   │   │
│  │  │ Source  │              WKWebView                   │   │   │
│  │  │ Panel   │  ┌───────────────────────────────────┐  │   │   │
│  │  │         │  │     React + TipTap Editor         │  │   │   │
│  │  │ 📄 src1 │  │                                   │  │   │   │
│  │  │ 📄 src2 │  │  Stream List | Cell Editor        │  │   │   │
│  │  │         │  │                                   │  │   │   │
│  │  │  [+]    │  │  Sources, Cells, Actions, AI      │  │   │   │
│  │  │         │  │                                   │  │   │   │
│  │  │(collaps)│  └───────────────────────────────────┘  │   │   │
│  │  └─────────┴─────────────────────────────────────────┘   │   │
│  └───────────────────────────────────────────────────────────┘   │
│                              ▲                                    │
│                              │ Bridge                             │
│                              ▼                                    │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │
│  │ AIService   │  │ SourceService│  │ PersistenceService      │  │
│  │ (OpenAI)    │  │ (Bookmarks)  │  │ (SQLite)                │  │
│  └─────────────┘  └──────────────┘  └─────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

**Key change from V2:** The Source Panel is a collapsible sidebar showing attached files. The main editor shows either the stream list (when no stream selected) or the cell editor (when editing a stream).

### 2.2 Directory Structure

```
ticker-v2/
├── Package.swift                    # Swift package manifest
├── Sources/
│   └── Ticker/
│       ├── App/
│       │   ├── AppDelegate.swift    # App lifecycle
│       │   ├── MainWindow.swift     # Window management
│       │   └── WebViewManager.swift # WKWebView setup & bridge
│       │
│       ├── Services/
│       │   ├── AIService.swift      # OpenAI streaming
│       │   ├── SourceService.swift  # Security-scoped bookmarks, text extraction
│       │   ├── PersistenceService.swift  # SQLite via GRDB
│       │   └── BridgeService.swift  # Swift ↔ JS communication
│       │
│       ├── Models/
│       │   ├── Cell.swift           # Cell model
│       │   ├── Stream.swift         # Stream model (with sources)
│       │   ├── SourceReference.swift # External file reference
│       │   ├── SourceBinding.swift  # Cell → Source location link
│       │   └── BridgeMessages.swift # Message types for bridge
│       │
│       └── Resources/
│           └── index.html           # Entry point for web layer
│
├── Web/                             # React application
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx                 # React entry
│   │   ├── App.tsx                  # Root component
│   │   ├── components/
│   │   │   ├── StreamList.tsx       # Stream browser / home
│   │   │   ├── StreamEditor.tsx     # Cell editing view
│   │   │   ├── SourcePanel.tsx      # Collapsible source sidebar
│   │   │   ├── Cell.tsx             # Individual cell
│   │   │   ├── CellEditor.tsx       # TipTap editor wrapper
│   │   │   ├── SourceBadge.tsx      # Cell's source binding indicator
│   │   │   ├── ActionMenu.tsx       # Slash command menu
│   │   │   └── StreamingText.tsx    # AI response display
│   │   ├── hooks/
│   │   │   ├── useBridge.ts         # Swift communication
│   │   │   ├── useStreams.ts        # Stream list management
│   │   │   ├── useStream.ts         # Single stream state
│   │   │   └── useAI.ts             # AI action handling
│   │   ├── types/
│   │   │   └── index.ts             # TypeScript types
│   │   └── styles/
│   │       └── globals.css          # Tailwind + custom styles
│   └── tailwind.config.js
│
└── README.md
```

### 2.3 The Bridge: Swift ↔ JavaScript Communication

**Swift → JavaScript:**
```swift
// Send data to web layer
webView.evaluateJavaScript("window.bridge.receive(\(jsonData))")
```

**JavaScript → Swift:**
```typescript
// Send data to Swift
window.webkit.messageHandlers.bridge.postMessage({
  type: 'saveCell',
  payload: { id: '...', content: '...' }
});
```

**Message Types:**

| Direction | Type | Payload | Purpose |
|-----------|------|---------|---------|
| Swift → JS | `streamsLoaded` | `[StreamSummary]` | Load stream list |
| Swift → JS | `streamLoaded` | `Stream` | Load single stream with sources |
| Swift → JS | `sourceAdded` | `SourceReference` | New source attached |
| Swift → JS | `sourceRemoved` | `{ sourceId }` | Source detached |
| Swift → JS | `sourceStatusChanged` | `{ sourceId, status }` | File availability changed |
| Swift → JS | `aiChunk` | `{ cellId, chunk }` | Streaming AI response |
| Swift → JS | `aiComplete` | `{ cellId }` | AI finished |
| Swift → JS | `aiError` | `{ cellId, error }` | AI failed |
| JS → Swift | `loadStreams` | `{}` | Request stream list |
| JS → Swift | `loadStream` | `{ streamId }` | Open specific stream |
| JS → Swift | `createStream` | `{ title, sourceUrl? }` | New stream (optionally with source) |
| JS → Swift | `deleteStream` | `{ streamId }` | Remove stream |
| JS → Swift | `addSource` | `{ streamId }` | Open file picker, attach source |
| JS → Swift | `removeSource` | `{ streamId, sourceId }` | Detach source |
| JS → Swift | `openSource` | `{ sourceId, location? }` | Open file in system viewer |
| JS → Swift | `saveCell` | `Cell` | Persist cell changes |
| JS → Swift | `deleteCell` | `{ id }` | Remove cell |
| JS → Swift | `executeAction` | `{ action, targetCellIds, sourceContext? }` | Run AI action |
| JS → Swift | `exportMarkdown` | `{ streamId }` | Trigger export |
| JS → Swift | `resize` | `{ height }` | Adjust window height |

---

## 3. Data Models

### 3.1 SourceReference

An external file attached to a stream. Files are **referenced, not copied**.

**Swift Model:**
```swift
struct SourceReference: Identifiable, Codable {
    let id: UUID
    let streamId: UUID
    var displayName: String              // User-friendly name
    var fileType: SourceFileType
    var bookmarkData: Data               // Security-scoped bookmark
    var status: SourceStatus
    var extractedText: String?           // Cached text content for LLM context
    var pageCount: Int?                  // For PDFs
    let addedAt: Date
}

enum SourceFileType: String, Codable {
    case pdf
    case plainText      // .txt, .md
    case image          // .png, .jpg, etc.
    case other
}

enum SourceStatus: String, Codable {
    case available      // File accessible
    case missing        // File moved/deleted
    case stale          // Bookmark needs refresh
}
```

**TypeScript Model:**
```typescript
interface SourceReference {
  id: string;
  streamId: string;
  displayName: string;
  fileType: 'pdf' | 'plainText' | 'image' | 'other';
  status: 'available' | 'missing' | 'stale';
  pageCount?: number;
  addedAt: string;
}
```

### 3.2 SourceBinding

A link from a cell to a specific location in a source file.

**Swift Model:**
```swift
struct SourceBinding: Codable {
    let sourceId: UUID                   // Which source file
    let location: SourceLocation         // Where in that file
}

enum SourceLocation: Codable {
    case whole                           // Entire file
    case page(Int)                       // PDF page number
    case pageRange(Int, Int)             // PDF page range
    // V0.2+: case textRange(start: Int, end: Int)
    // V0.2+: case boundingBox(page: Int, x: Double, y: Double, w: Double, h: Double)
}
```

**TypeScript Model:**
```typescript
interface SourceBinding {
  sourceId: string;
  location: SourceLocation;
}

type SourceLocation =
  | { type: 'whole' }
  | { type: 'page'; page: number }
  | { type: 'pageRange'; start: number; end: number };
```

### 3.3 Cell

The atomic unit of content. Now includes optional source binding.

**Swift Model:**
```swift
struct Cell: Identifiable, Codable {
    let id: UUID
    let streamId: UUID
    var type: CellType
    var content: String
    var state: CellState
    var sourceBinding: SourceBinding?    // NEW: link to source location
    var metadata: CellMetadata
    let createdAt: Date
    var updatedAt: Date
}

enum CellType: String, Codable {
    case text           // User-written prose
    case aiResponse     // AI-generated content
    case quote          // Excerpt from a source (has sourceBinding)
}

enum CellState: String, Codable {
    case idle           // Normal state
    case editing        // User is typing
    case loading        // AI is generating
    case error          // Something failed
}

struct CellMetadata: Codable {
    var origin: CellOrigin
    var references: [UUID]          // IDs of referenced cells
    var action: CellAction?         // For aiResponse cells
    var errorMessage: String?       // If state == .error
}

enum CellOrigin: String, Codable {
    case user           // Typed by user
    case ai             // Generated by AI
    case source         // Extracted/quoted from source
}
```

**TypeScript Model:**
```typescript
interface Cell {
  id: string;
  streamId: string;
  type: 'text' | 'aiResponse' | 'quote';
  content: string;
  state: 'idle' | 'editing' | 'loading' | 'error';
  sourceBinding?: SourceBinding;
  metadata: {
    origin: 'user' | 'ai' | 'source';
    references: string[];
    action?: CellAction;
    errorMessage?: string;
  };
  createdAt: string;
  updatedAt: string;
}
```

### 3.4 Stream

A thinking session with attached sources.

**Swift Model:**
```swift
struct Stream: Identifiable, Codable {
    let id: UUID
    var title: String
    var sources: [SourceReference]       // NEW: attached files
    var cells: [Cell]
    let createdAt: Date
    var updatedAt: Date
}

/// Lightweight summary for stream list
struct StreamSummary: Identifiable, Codable {
    let id: UUID
    var title: String
    var sourceCount: Int
    var cellCount: Int
    var updatedAt: Date
}
```

**TypeScript Model:**
```typescript
interface Stream {
  id: string;
  title: string;
  sources: SourceReference[];
  cells: Cell[];
  createdAt: string;
  updatedAt: string;
}

interface StreamSummary {
  id: string;
  title: string;
  sourceCount: number;
  cellCount: number;
  updatedAt: string;
}
```

### 3.5 CellAction

Available AI actions.

```swift
enum CellAction: String, Codable, CaseIterable {
    case summarize
    case expand
    case rewrite
    case ask
    case extract      // NEW: extract structured data from source

    var displayName: String {
        switch self {
        case .summarize: return "Summarize"
        case .expand: return "Expand"
        case .rewrite: return "Rewrite"
        case .ask: return "Ask"
        case .extract: return "Extract"
        }
    }

    var command: String { "/\(rawValue)" }

    var systemPrompt: String {
        switch self {
        case .summarize:
            return "Summarize the following content concisely. Preserve key facts and insights."
        case .expand:
            return "Expand on the following content. Add detail, examples, and depth."
        case .rewrite:
            return "Rewrite the following content for clarity and impact."
        case .ask:
            return "Answer the following question based on the provided context."
        case .extract:
            return "Extract the key structured information from this content (dates, names, figures, etc.)."
        }
    }
}
```

---

## 4. Database Schema

### 4.1 SQLite Tables (via GRDB)

```sql
-- Streams (thinking sessions)
CREATE TABLE streams (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

-- Source References (attached files)
CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    stream_id TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    bookmark_data BLOB NOT NULL,         -- Security-scoped bookmark
    status TEXT NOT NULL DEFAULT 'available',
    extracted_text TEXT,                  -- Cached for LLM context
    page_count INTEGER,
    added_at REAL NOT NULL
);

CREATE INDEX idx_sources_stream ON sources(stream_id);

-- Cells
CREATE TABLE cells (
    id TEXT PRIMARY KEY,
    stream_id TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'idle',
    source_binding_json TEXT,            -- JSON: { sourceId, location }
    metadata_json TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    position INTEGER NOT NULL
);

CREATE INDEX idx_cells_stream ON cells(stream_id);
CREATE INDEX idx_cells_position ON cells(stream_id, position);
```

### 4.2 Persistence Strategy

- **Write immediately** on cell changes (debounce not needed for V0.1)
- **WAL mode** enabled for robustness
- **Bookmark persistence** - Store security-scoped bookmarks as BLOB
- **Text extraction caching** - Store extracted text to avoid re-parsing
- **Auto-save** - no explicit save action needed
- **Cascade delete** - Deleting a stream removes its sources and cells

---

## 5. Service Specifications

### 5.1 AIService (Swift)

Handles OpenAI API calls with streaming. Now supports source context.

```swift
@MainActor
final class AIService {
    private let apiKey: String
    private let model = "gpt-4o"

    /// Execute an action with optional source context
    func executeAction(
        action: CellAction,
        cellContext: String,
        sourceContext: SourceContext?,
        onChunk: @escaping (String) -> Void,
        onComplete: @escaping () -> Void,
        onError: @escaping (Error) -> Void
    ) async {
        let prompt = buildPrompt(
            action: action,
            cellContext: cellContext,
            sourceContext: sourceContext
        )

        do {
            let stream = try await streamCompletion(prompt: prompt)
            for try await chunk in stream {
                onChunk(chunk)
            }
            onComplete()
        } catch {
            onError(error)
        }
    }

    private func buildPrompt(
        action: CellAction,
        cellContext: String,
        sourceContext: SourceContext?
    ) -> String {
        var prompt = action.systemPrompt + "\n\n"

        if let source = sourceContext {
            prompt += "SOURCE DOCUMENT (\(source.displayName)):\n"
            prompt += source.relevantText + "\n\n"
        }

        prompt += "USER CONTENT:\n\(cellContext)"
        return prompt
    }

    private func streamCompletion(prompt: String) async throws -> AsyncThrowingStream<String, Error> {
        // SSE streaming implementation
    }
}

/// Context from attached sources for AI calls
struct SourceContext {
    let displayName: String
    let relevantText: String       // Extracted/selected text from source
    let location: SourceLocation?  // Where in the source
}
```

### 5.2 SourceService (Swift)

Handles file references, text extraction, and bookmark management.

```swift
@MainActor
final class SourceService {

    // MARK: - Bookmark Management

    /// Create a source reference from a user-selected file
    func createSource(from url: URL, for streamId: UUID) throws -> SourceReference {
        let bookmark = try url.bookmarkData(
            options: .withSecurityScope,
            includingResourceValuesForKeys: [.contentTypeKey],
            relativeTo: nil
        )

        let fileType = detectFileType(url)
        let extractedText = try? extractText(from: url, fileType: fileType)
        let pageCount = fileType == .pdf ? countPages(url) : nil

        return SourceReference(
            id: UUID(),
            streamId: streamId,
            displayName: url.lastPathComponent,
            fileType: fileType,
            bookmarkData: bookmark,
            status: .available,
            extractedText: extractedText,
            pageCount: pageCount,
            addedAt: Date()
        )
    }

    /// Resolve a bookmark and access the file
    func accessFile(source: SourceReference) throws -> URL {
        var isStale = false
        let url = try URL(
            resolvingBookmarkData: source.bookmarkData,
            options: .withSecurityScope,
            relativeTo: nil,
            bookmarkDataIsStale: &isStale
        )

        if isStale {
            throw SourceError.staleBookmark(sourceId: source.id)
        }

        guard url.startAccessingSecurityScopedResource() else {
            throw SourceError.accessDenied(sourceId: source.id)
        }

        return url
        // Caller must call url.stopAccessingSecurityScopedResource()
    }

    /// Check if source file is still accessible
    func checkStatus(source: SourceReference) -> SourceStatus {
        do {
            let url = try accessFile(source: source)
            url.stopAccessingSecurityScopedResource()
            return .available
        } catch SourceError.staleBookmark {
            return .stale
        } catch {
            return .missing
        }
    }

    // MARK: - Text Extraction

    /// Extract text content from a source file
    func extractText(from url: URL, fileType: SourceFileType) throws -> String {
        switch fileType {
        case .pdf:
            return try extractPDFText(from: url)
        case .plainText:
            return try String(contentsOf: url, encoding: .utf8)
        case .image:
            return "" // No text extraction for images in V0.1
        case .other:
            return ""
        }
    }

    private func extractPDFText(from url: URL) throws -> String {
        guard let document = PDFDocument(url: url) else {
            throw SourceError.extractionFailed
        }

        var text = ""
        for i in 0..<document.pageCount {
            if let page = document.page(at: i),
               let pageText = page.string {
                text += pageText + "\n\n"
            }
        }
        return text
    }

    /// Get text for specific pages (for location-bound context)
    func extractPages(_ pages: [Int], from source: SourceReference) throws -> String {
        guard source.fileType == .pdf else {
            return source.extractedText ?? ""
        }

        let url = try accessFile(source: source)
        defer { url.stopAccessingSecurityScopedResource() }

        guard let document = PDFDocument(url: url) else {
            throw SourceError.extractionFailed
        }

        var text = ""
        for pageNum in pages where pageNum < document.pageCount {
            if let page = document.page(at: pageNum),
               let pageText = page.string {
                text += "--- Page \(pageNum + 1) ---\n"
                text += pageText + "\n\n"
            }
        }
        return text
    }

    // MARK: - Helpers

    private func detectFileType(_ url: URL) -> SourceFileType {
        let ext = url.pathExtension.lowercased()
        switch ext {
        case "pdf": return .pdf
        case "txt", "md", "markdown": return .plainText
        case "png", "jpg", "jpeg", "gif", "webp": return .image
        default: return .other
        }
    }

    private func countPages(_ url: URL) -> Int? {
        guard let document = PDFDocument(url: url) else { return nil }
        return document.pageCount
    }
}

enum SourceError: Error {
    case staleBookmark(sourceId: UUID)
    case accessDenied(sourceId: UUID)
    case extractionFailed
    case fileNotFound
}
```

### 5.3 BridgeService (Swift)

Handles Swift ↔ JavaScript communication.

```swift
@MainActor
final class BridgeService: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    var onMessage: ((BridgeMessage) -> Void)?

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String,
              let payload = body["payload"] else { return }

        let bridgeMessage = BridgeMessage(type: type, payload: payload)
        onMessage?(bridgeMessage)
    }

    func send(_ message: BridgeMessage) {
        guard let webView = webView else { return }
        let json = message.toJSON()
        webView.evaluateJavaScript("window.bridge.receive(\(json))")
    }
}
```

### 5.4 PersistenceService (Swift)

SQLite operations via GRDB.

```swift
@MainActor
final class PersistenceService {
    private let dbQueue: DatabaseQueue

    init() throws {
        let path = Self.databasePath()
        dbQueue = try DatabaseQueue(path: path)
        try migrator.migrate(dbQueue)
    }

    func loadStream() throws -> Stream? {
        try dbQueue.read { db in
            // Load stream and cells
        }
    }

    func saveCell(_ cell: Cell) throws {
        try dbQueue.write { db in
            try cell.save(db)
        }
    }

    func deleteCell(id: UUID) throws {
        try dbQueue.write { db in
            try Cell.deleteOne(db, id: id)
        }
    }
}
```

---

## 6. Web Layer (React + TipTap)

### 6.1 Core Components

**App.tsx** - Root component with view routing
```tsx
function App() {
  const { streams, currentStream, loadStream, createStream } = useStreams();
  const [view, setView] = useState<'list' | 'editor'>('list');

  return (
    <div className="flex h-screen bg-white dark:bg-gray-900">
      {/* Source Panel (collapsible sidebar) */}
      {currentStream && (
        <SourcePanel
          sources={currentStream.sources}
          onAddSource={() => bridge.addSource({ streamId: currentStream.id })}
          onRemoveSource={(id) => bridge.removeSource({ streamId: currentStream.id, sourceId: id })}
          onOpenSource={(id) => bridge.openSource({ sourceId: id })}
        />
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {view === 'list' ? (
          <StreamList
            streams={streams}
            onSelectStream={(id) => { loadStream(id); setView('editor'); }}
            onCreateStream={createStream}
          />
        ) : (
          <StreamEditor
            stream={currentStream!}
            onBack={() => setView('list')}
          />
        )}
      </div>
    </div>
  );
}
```

**StreamList.tsx** - Stream browser / home view
```tsx
interface StreamListProps {
  streams: StreamSummary[];
  onSelectStream: (id: string) => void;
  onCreateStream: (title: string, sourceUrl?: string) => void;
}

function StreamList({ streams, onSelectStream, onCreateStream }: StreamListProps) {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-6">Your Streams</h1>

      {/* Stream cards */}
      <div className="space-y-3">
        {streams.map(stream => (
          <div
            key={stream.id}
            onClick={() => onSelectStream(stream.id)}
            className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer"
          >
            <div className="font-medium">{stream.title}</div>
            <div className="text-sm text-gray-500 mt-1">
              {stream.sourceCount > 0 && (
                <span>{stream.sourceCount} source{stream.sourceCount > 1 ? 's' : ''} · </span>
              )}
              {stream.cellCount} cell{stream.cellCount !== 1 ? 's' : ''} ·
              Updated {formatRelativeTime(stream.updatedAt)}
            </div>
          </div>
        ))}
      </div>

      {/* Create buttons */}
      <div className="mt-6 flex gap-3">
        <button
          onClick={() => onCreateStream('Untitled')}
          className="px-4 py-2 bg-gray-100 rounded hover:bg-gray-200"
        >
          + New Stream
        </button>
        <button
          onClick={() => bridge.createStreamFromFile()}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          + New from File...
        </button>
      </div>
    </div>
  );
}
```

**SourcePanel.tsx** - Collapsible source sidebar
```tsx
interface SourcePanelProps {
  sources: SourceReference[];
  onAddSource: () => void;
  onRemoveSource: (id: string) => void;
  onOpenSource: (id: string, location?: SourceLocation) => void;
}

function SourcePanel({ sources, onAddSource, onRemoveSource, onOpenSource }: SourcePanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="w-10 border-r flex flex-col items-center py-3">
        <button onClick={() => setCollapsed(false)} title="Show sources">
          <ChevronRight className="w-4 h-4" />
        </button>
        {sources.map(s => (
          <div key={s.id} className="mt-2" title={s.displayName}>
            <FileIcon fileType={s.fileType} className="w-4 h-4" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="w-48 border-r flex flex-col">
      <div className="p-3 border-b flex items-center justify-between">
        <span className="text-sm font-medium">Sources</span>
        <button onClick={() => setCollapsed(true)}>
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sources.map(source => (
          <div
            key={source.id}
            className="flex items-center gap-2 p-2 rounded hover:bg-gray-100 group"
          >
            <FileIcon fileType={source.fileType} className="w-4 h-4 flex-shrink-0" />
            <span
              className="text-sm truncate flex-1 cursor-pointer"
              onClick={() => onOpenSource(source.id)}
              title={source.displayName}
            >
              {source.displayName}
            </span>
            {source.status !== 'available' && (
              <WarningIcon className="w-3 h-3 text-yellow-500" />
            )}
            <button
              onClick={() => onRemoveSource(source.id)}
              className="opacity-0 group-hover:opacity-100"
            >
              <XIcon className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="p-2 border-t">
        <button
          onClick={onAddSource}
          className="w-full text-sm text-gray-600 hover:text-gray-900 py-1"
        >
          + Add source
        </button>
      </div>
    </div>
  );
}
```

**Cell.tsx** - Individual cell with source binding indicator
```tsx
interface CellProps {
  cell: Cell;
  sources: SourceReference[];
  isStreaming: boolean;
  onUpdate: (content: string) => void;
  onDelete: () => void;
  onExecuteAction: (action: CellAction) => void;
  onJumpToSource: (sourceId: string, location?: SourceLocation) => void;
}

function Cell({ cell, sources, isStreaming, onUpdate, onDelete, onExecuteAction, onJumpToSource }: CellProps) {
  const [isHovered, setIsHovered] = useState(false);

  // Find source for binding badge
  const boundSource = cell.sourceBinding
    ? sources.find(s => s.id === cell.sourceBinding!.sourceId)
    : null;

  return (
    <div
      className={cn(
        "relative py-4 px-6",
        cell.type === 'aiResponse' && "border-l-2 border-blue-200",
        cell.type === 'quote' && "border-l-2 border-green-200",
        cell.state === 'error' && "border-l-2 border-red-300"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Source binding badge */}
      {boundSource && (
        <SourceBadge
          source={boundSource}
          location={cell.sourceBinding!.location}
          onClick={() => onJumpToSource(boundSource.id, cell.sourceBinding!.location)}
        />
      )}

      {isHovered && cell.state === 'idle' && (
        <CellActions
          onAction={onExecuteAction}
          onDelete={onDelete}
          isAICell={cell.type === 'aiResponse'}
        />
      )}

      {isStreaming ? (
        <StreamingText content={cell.content} />
      ) : (
        <CellEditor
          content={cell.content}
          onChange={onUpdate}
          onCommand={onExecuteAction}
        />
      )}

      {cell.state === 'error' && (
        <div className="text-sm text-red-500 mt-2">
          {cell.metadata.errorMessage || 'An error occurred'}
        </div>
      )}
    </div>
  );
}
```

**SourceBadge.tsx** - Shows cell's source binding
```tsx
interface SourceBadgeProps {
  source: SourceReference;
  location: SourceLocation;
  onClick: () => void;
}

function SourceBadge({ source, location, onClick }: SourceBadgeProps) {
  const locationText = formatLocation(location);

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-2"
    >
      <FileIcon fileType={source.fileType} className="w-3 h-3" />
      <span>{source.displayName}</span>
      {locationText && <span className="text-gray-400">· {locationText}</span>}
      <ExternalLink className="w-3 h-3" />
    </button>
  );
}

function formatLocation(location: SourceLocation): string | null {
  switch (location.type) {
    case 'page': return `p. ${location.page}`;
    case 'pageRange': return `pp. ${location.start}-${location.end}`;
    case 'whole': return null;
  }
}
```

**CellEditor.tsx** - TipTap wrapper
```tsx
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

interface CellEditorProps {
  content: string;
  onChange: (content: string) => void;
  onCommand: (action: CellAction) => void;
}

function CellEditor({ content, onChange, onCommand }: CellEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      SlashCommand.configure({ onCommand }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getText());
    },
  });

  return <EditorContent editor={editor} className="prose prose-sm" />;
}
```

### 6.2 Bridge Hook

```tsx
// hooks/useBridge.ts
const bridge = {
  send: (message: BridgeMessage) => {
    window.webkit?.messageHandlers?.bridge?.postMessage(message);
  },

  receive: (handler: (message: BridgeMessage) => void) => {
    window.bridge = { receive: handler };
  },

  saveCell: (cell: Cell) => bridge.send({ type: 'saveCell', payload: cell }),
  deleteCell: (id: string) => bridge.send({ type: 'deleteCell', payload: { id } }),
  executeAction: (action: CellAction, targetCellIds: string[]) =>
    bridge.send({ type: 'executeAction', payload: { action, targetCellIds } }),
  exportMarkdown: () => bridge.send({ type: 'exportMarkdown', payload: {} }),
  resize: (height: number) => bridge.send({ type: 'resize', payload: { height } }),
};

function useBridge() {
  const [stream, setStream] = useState<Stream | null>(null);

  useEffect(() => {
    bridge.receive((message) => {
      switch (message.type) {
        case 'streamLoaded':
          setStream(message.payload);
          break;
        case 'aiChunk':
          // Append chunk to cell content
          break;
        case 'aiComplete':
          // Mark cell as idle
          break;
        case 'aiError':
          // Mark cell as error
          break;
      }
    });
  }, []);

  return { stream, bridge };
}
```

### 6.3 Slash Command Extension

```tsx
// TipTap extension for /commands
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';

const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      onCommand: () => {},
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        items: ({ query }) => {
          const commands = [
            { id: 'summarize', label: 'Summarize', description: 'Condense content' },
            { id: 'expand', label: 'Expand', description: 'Add detail' },
            { id: 'rewrite', label: 'Rewrite', description: 'Improve clarity' },
            { id: 'ask', label: 'Ask', description: 'Ask a question' },
          ];
          return commands.filter(cmd =>
            cmd.label.toLowerCase().includes(query.toLowerCase())
          );
        },
        command: ({ editor, props }) => {
          editor.commands.deleteRange({ from: props.range.from, to: props.range.to });
          this.options.onCommand(props.id);
        },
      }),
    ];
  },
});
```

---

## 7. UI/UX Specifications

### 7.1 Design Principles

1. **Source-Aware** - Files are visible companions, not hidden imports
2. **Content First** - Cells are just text until interacted with
3. **Progressive Disclosure** - Actions and metadata appear on hover
4. **Keyboard-Native** - Everything accessible without mouse
5. **Minimal Chrome** - No visible borders or heavy UI
6. **Instant Feedback** - Streaming responses, immediate updates

### 7.2 Overall Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ [≡]                          Ticker                                  │
├─────────┬───────────────────────────────────────────────────────────┤
│         │                                                           │
│ Sources │                    Stream List                            │
│         │                    (or Stream Editor)                     │
│ ────────│                                                           │
│ 📄 src1 │  ┌─────────────────────────────────────────────────────┐  │
│ 📄 src2 │  │ Q3 Analysis                                         │  │
│ 📄 src3 │  │ 2 sources · 12 cells · Updated 2h ago               │  │
│         │  └─────────────────────────────────────────────────────┘  │
│  [+]    │  ┌─────────────────────────────────────────────────────┐  │
│         │  │ Research Notes                                      │  │
│(collaps)│  │ 1 source · 5 cells · Updated yesterday              │  │
│         │  └─────────────────────────────────────────────────────┘  │
│         │                                                           │
│         │  [+ New Stream]  [+ New from File...]                     │
│         │                                                           │
└─────────┴───────────────────────────────────────────────────────────┘
```

### 7.3 Stream Editor Layout (with sources)

```
┌─────────┬───────────────────────────────────────────────────────────┐
│ Sources │ [←]  Q3 Analysis                          [Export ▼]      │
│ ────────├───────────────────────────────────────────────────────────┤
│         │                                                           │
│ 📄 Q3   │  📄 Q3_Report.pdf · p.12                                  │
│    Rep  │  The quarterly results show a declining trend since Q2.   │
│         │  Revenue dropped 12% year-over-year.                      │
│ 📑 Notes│                                                           │
│         │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  [+]    │                                                           │
│         │  │ The enterprise segment was particularly affected by    │
│         │  │ budget freezes in Q3. However, SMB growth (+8%)        │
│         │  │ partially offset these losses.           [↻] [✎]       │
│         │                                                           │
│         │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│         │                                                           │
│         │  [cursor] _                                               │
│         │                                                           │
└─────────┴───────────────────────────────────────────────────────────┘
```

Key elements:
- **Source panel** (left): Collapsible sidebar showing attached files
- **Source badge** on cells: Shows which file/location the cell references
- **Back button** [←]: Returns to stream list
- **Export**: Generates Markdown with citations

### 7.4 Cell States

| State | Visual Treatment |
|-------|------------------|
| **idle** | Plain text, no decoration |
| **editing** | Cursor visible, subtle focus ring |
| **loading** | Content streaming in, pulsing indicator |
| **error** | Red left border, error message below |

### 7.5 Cell Types (Visual)

| Type | Visual Treatment |
|------|------------------|
| **text** | Plain text, no decoration |
| **aiResponse** | Faint blue left border (2px) |
| **quote** | Faint green left border (2px), source badge above |

### 7.6 AI Response Cells

- Faint blue left border (2px)
- Hover reveals: [↻ Regenerate] [✎ Edit]
- Editable like any other cell
- Source action shown in subtle metadata on hover

### 7.7 Quote Cells (from sources)

- Faint green left border (2px)
- Source badge above content: `📄 filename.pdf · p.12 ↗`
- Clicking badge opens file in system viewer
- Content is the extracted/quoted text
- Editable (editing doesn't change original file)

### 7.8 Keyboard Navigation

| Key | Context | Action |
|-----|---------|--------|
| `Enter` | End of cell | Create new cell below |
| `Backspace` | Start of empty cell | Delete cell, focus previous |
| `↑` | Start of cell | Focus previous cell |
| `↓` | End of cell | Focus next cell |
| `Cmd+Enter` | Any | Execute cell as command |
| `Escape` | Editing | Exit edit mode |
| `/` | Start of line | Open command menu |

### 7.9 Slash Command Menu

When user types `/`:

```
┌─────────────────────────────────────────────────────────────┐
│ /sum                                                        │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ▶ /summarize    Condense content                        │ │
│ │   /expand       Add detail                              │ │
│ │   /rewrite      Improve clarity                         │ │
│ │   /ask          Ask a question                          │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- Filtered as user types
- Arrow keys to navigate
- Enter to select
- Escape to cancel

### 7.10 Window Resizing

The Swift window adjusts height based on content:

1. React calculates `document.body.scrollHeight`
2. Sends `resize` message to Swift
3. Swift animates window frame
4. Debounced to prevent jitter (100ms)

Constraints:
- Minimum height: 200px
- Maximum height: 80% of screen

---

## 8. Context Window Management

### 8.1 Token Budget

- **Model:** GPT-4o (128k context)
- **Budget per action:** 8,000 tokens for context
- **Reserve:** 2,000 tokens for response

### 8.2 Context Assembly

When executing an action, context is assembled from:
1. **Source context** (if stream has sources): Extracted text from attached files
2. **Cell context**: Target cells (from `@previous` or explicit selection)
3. **System prompt**: Action-specific instructions

```swift
func assembleContext(
    action: CellAction,
    targetCellIds: [UUID],
    sources: [SourceReference]
) -> (cellContext: String, sourceContext: SourceContext?) {

    // 1. Assemble cell context
    let cells = targetCellIds.compactMap { getCellById($0) }
    var cellContext = cells.map { $0.content }.joined(separator: "\n\n")

    // 2. Assemble source context (if sources attached)
    var sourceContext: SourceContext? = nil
    if let primarySource = sources.first,
       let extractedText = primarySource.extractedText {
        sourceContext = SourceContext(
            displayName: primarySource.displayName,
            relevantText: truncateToTokenBudget(extractedText, budget: 6000),
            location: nil
        )
    }

    // 3. Truncate cell context if needed
    let cellBudget = sourceContext != nil ? 2000 : 8000
    cellContext = truncateToTokenBudget(cellContext, budget: cellBudget)

    return (cellContext, sourceContext)
}

func truncateToTokenBudget(_ text: String, budget: Int) -> String {
    let estimatedTokens = text.count / 4
    if estimatedTokens <= budget {
        return text
    }
    let targetChars = budget * 4
    let startIndex = text.index(text.endIndex, offsetBy: -targetChars)
    return "...[truncated]...\n\n" + String(text[startIndex...])
}
```

### 8.3 Source-Aware Context Strategy

| Scenario | Cell Budget | Source Budget | Total |
|----------|-------------|---------------|-------|
| No sources attached | 8,000 | 0 | 8,000 |
| One source attached | 2,000 | 6,000 | 8,000 |
| Multiple sources | 2,000 | 6,000 (primary only) | 8,000 |

For V0.1, only the first source is included in context. V0.2 will add intelligent source selection.

### 8.4 User Visibility

When context is truncated, show indicator:
```
┌─────────────────────────────────────────────────────────────┐
│ ℹ️ Context truncated to fit model limits                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Error Handling

### 9.1 Error States by Component

| Component | Error | User Sees | Recovery |
|-----------|-------|-----------|----------|
| **AI streaming** | Network failure | Partial content + error badge | "Retry" button |
| **AI streaming** | Rate limit (429) | Error message | Auto-retry after delay |
| **AI streaming** | Invalid API key | Error message | Prompt to check settings |
| **File import** | Access denied | Toast notification | Re-request permission |
| **File import** | File not found | Toast notification | Remove stale reference |
| **Persistence** | SQLite write fail | Error banner | Auto-retry |

### 9.2 AI Failure Handling

```swift
func handleAIError(_ error: Error, cellId: UUID) {
    // Keep partial content
    // Update cell state to .error
    // Store error message in metadata

    var cell = getCell(cellId)
    cell.state = .error
    cell.metadata.errorMessage = error.localizedDescription
    saveCell(cell)

    // Notify web layer
    bridge.send(.aiError(cellId: cellId, error: error.localizedDescription))
}
```

### 9.3 Partial Response Handling

If AI stream fails mid-generation:
- Keep whatever content was received
- Mark cell as `error` state
- Show "Generation interrupted" message
- Allow user to edit or retry

---

## 10. Reference Resolution

### 10.1 V0.1 Rules

For V0.1, only `@previous` is supported:

- `@previous` = the cell directly above the current cell
- If current cell is first, `@previous` is undefined (show error)
- Command cells skip themselves when resolving `@previous`

### 10.2 Resolution Logic

```typescript
function resolvePrevious(currentCellId: string, cells: Cell[]): Cell | null {
  const currentIndex = cells.findIndex(c => c.id === currentCellId);
  if (currentIndex <= 0) return null;
  return cells[currentIndex - 1];
}
```

### 10.3 V0.2 Preview

Future reference types (not implemented in V0.1):
- `@1`, `@2`, `@3` - Cell by position
- `@"keyword"` - Semantic search
- `@filename.txt` - Imported file

---

## 11. Build Phases

### Week 1: Foundation (Days 1-5)

**Day 1-2: Project Setup**
- [ ] Create new repo with dual structure (Swift + Web)
- [ ] Set up Swift package with GRDB + PDFKit dependencies
- [ ] Set up React + Vite + TipTap + Tailwind
- [ ] Create basic AppDelegate and MainWindow
- [ ] Embed WKWebView loading local HTML

**Day 3-4: Bridge & Models**
- [ ] Implement BridgeService (Swift side)
- [ ] Implement useBridge hook (React side)
- [ ] Test bidirectional communication
- [ ] Define all message types (including source messages)
- [ ] Create Stream, Cell, SourceReference, SourceBinding models

**Day 5: Persistence**
- [ ] Implement PersistenceService with GRDB
- [ ] Create database schema (streams, sources, cells tables)
- [ ] Implement save/load for streams with sources
- [ ] Test persistence round-trip

**Deliverable:** App launches, web view loads, bridge works, data persists.

### Week 2: Cell Editing & Stream List (Days 6-10)

**Day 6-7: Stream List UI**
- [ ] Implement StreamList component (React)
- [ ] Stream cards showing title, source count, cell count
- [ ] "New Stream" and "New from File..." buttons
- [ ] Navigation between list and editor views

**Day 8-9: Cell Editing**
- [ ] Implement Cell component with TipTap
- [ ] Cell creation (Enter at end)
- [ ] Cell deletion (Backspace when empty)
- [ ] Keyboard navigation (↑/↓ between cells)
- [ ] Cell state machine (idle, editing)

**Day 10: Polish**
- [ ] Styling per design spec
- [ ] Hover states
- [ ] Visual differentiation for cell types (text, aiResponse, quote)

**Deliverable:** Can browse streams, create/edit/delete cells. Feels good to type.

**🚨 GATE:** Test with 3 users. Do not proceed if editing feels awkward.

### Week 3: Sources & AI (Days 11-15)

**Day 11-12: SourceService**
- [ ] Implement security-scoped bookmarks
- [ ] PDF text extraction with PDFKit
- [ ] Plain text file reading
- [ ] Source status checking (available, missing, stale)

**Day 13: Source Panel UI**
- [ ] Implement SourcePanel component (collapsible sidebar)
- [ ] Add source via file picker
- [ ] Remove source
- [ ] Click source to open in system viewer
- [ ] Source status indicators

**Day 14-15: AIService**
- [ ] Implement OpenAI streaming in Swift
- [ ] API key storage (Keychain)
- [ ] Stream chunks to web via bridge
- [ ] Source-aware context assembly
- [ ] Slash command extension (TipTap)
- [ ] Execute action → create AI response cell

**Deliverable:** Can attach sources to streams, see them in sidebar, use AI with source context.

### Week 4: Source Binding & Export (Days 16-20)

**Day 16-17: Quote Cells**
- [ ] Create quote cell type (from source)
- [ ] SourceBadge component showing file + location
- [ ] Click badge to open file
- [ ] Source binding data flow

**Day 18-19: Error Handling**
- [ ] AI error states (network, rate limit, partial)
- [ ] Source error states (missing, stale, access denied)
- [ ] Error UI (badges, messages, retry)
- [ ] Graceful degradation

**Day 20: Export**
- [ ] ExportService (Markdown generation with citations)
- [ ] Include source references in export
- [ ] Export button and NSSavePanel
- [ ] Test export output

**Deliverable:** Can create source-bound cells, handle errors, export with citations.

### Week 5: Polish (Days 21-25)

**Day 21-22: Refinement**
- [ ] Window resizing based on content
- [ ] Empty states (no streams, no sources, no cells)
- [ ] Loading states throughout
- [ ] Source panel collapse/expand persistence

**Day 23-24: Visual Polish**
- [ ] Light/dark mode
- [ ] Typography refinement
- [ ] Animation and transitions
- [ ] Source panel styling

**Day 25: Testing**
- [ ] Bug fixes
- [ ] Performance check (50+ cells, multiple sources)
- [ ] Final user testing

**Deliverable:** Demo-ready MVP.

### Week 6: Buffer (Days 26-30)

Reserved for:
- [ ] Bug fixes from testing
- [ ] Performance optimization
- [ ] Edge cases discovered during polish
- [ ] Documentation

**Deliverable:** Ship-ready V0.1.

---

## 12. Success Criteria

### 12.1 Functional Requirements

- [ ] Create, edit, delete streams
- [ ] Attach multiple sources (PDF, text) to streams
- [ ] Create, edit, delete cells (text, aiResponse, quote)
- [ ] AI actions: summarize, expand, rewrite, ask, extract
- [ ] `@previous` reference works
- [ ] Slash command invocation
- [ ] Streaming AI responses with source context
- [ ] Source binding (cell → source location)
- [ ] Export to Markdown with citations
- [ ] Data persists across restarts

### 12.2 Quality Requirements

- [ ] Cell editing feels instant (<50ms response)
- [ ] AI streaming starts within 1 second
- [ ] Source attachment takes <2 seconds (including extraction)
- [ ] No data loss on crash
- [ ] Works on macOS 13+
- [ ] Light and dark mode

### 12.3 Demo Requirements

- [ ] Can show: open PDF → ask questions about it → get AI answers with context
- [ ] Can show: create quote cell from source → expand with AI → export
- [ ] Can show: multi-source stream → synthesize insights across documents
- [ ] Can show: export produces clean Markdown with source citations

### 12.4 Validation Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Streams per user | 3+ | Analytics |
| Sources per stream | 1+ (average) | Analytics |
| Cells per session | 5+ | Analytics |
| Exports per week | 1+ | Analytics |
| "Feels like thinking with documents" | 3/3 testers | User feedback |

---

## 13. V0.1 Scope Summary

### What's IN V0.1

| Feature | Status |
|---------|--------|
| Multiple streams | ✅ Included |
| Stream list/browser | ✅ Included |
| Multiple sources per stream | ✅ Included |
| PDF sources with text extraction | ✅ Included |
| Plain text sources (.txt, .md) | ✅ Included |
| Image sources (display only, no OCR) | ✅ Included |
| Source panel (collapsible sidebar) | ✅ Included |
| Page-level source binding | ✅ Included |
| Quote cells with source badge | ✅ Included |
| Open source in system viewer | ✅ Included |
| AI with source context | ✅ Included |
| Export with citations | ✅ Included |

### What's NOT in V0.1 (V0.2+)

| Feature | Reason |
|---------|--------|
| Quick Panel (Cmd+L capture) | Complexity; focus on source-attached flow first |
| Fine-grained location binding (text ranges) | Complexity; page-level is sufficient |
| In-app source preview | Complexity; system viewer is fine |
| Jump-to-source (scroll to page) | Requires AppleScript/app integration |
| Source change detection | Complexity; manual re-attachment is acceptable |
| Cross-stream source reuse | DB complexity; copy bookmark instead |
| OCR for images | Requires Vision framework integration |
| `@1`, `@2` numbered references | Complexity; `@previous` is sufficient |
| Cell reordering | TipTap complexity |
| Rich text formatting | Scope creep |
| Semantic search | Requires embedding infrastructure |
| Collaboration | Completely different architecture |
| JSON export | Low priority |

---

## 14. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Cell editing feels clunky | Medium | Critical | Gate at Week 2; don't proceed if UX is wrong |
| PDF text extraction quality | Medium | High | Test with varied PDFs; provide "source unavailable" fallback |
| Security-scoped bookmarks expire | Low | Medium | Handle stale bookmarks gracefully; re-request access |
| Source panel clutters UI | Medium | Medium | Collapse by default; test with users |
| Bridge communication bugs | Medium | High | Extensive logging, clear message contracts |
| TipTap learning curve | Low | Medium | TipTap has good docs; use starter kit |
| AI latency | Medium | Medium | Streaming; clear loading states |
| Large PDF extraction slow | Medium | Medium | Background extraction; progress indicator |
| WKWebView quirks | Low | Medium | Test on multiple macOS versions |
| Scope creep | High | High | This document is the contract |

---

## 15. Open Decisions

### 15.1 Resolved

| Decision | Resolution |
|----------|------------|
| Architecture | Hybrid: Swift shell + WKWebView + React |
| Editor library | TipTap (ProseMirror-based) |
| File handling | Reference via bookmarks, not copy (source-attached model) |
| File ownership | Files stay external; Ticker is a lens, not a silo |
| Reference syntax | `@previous` only for V0.1 |
| Location binding | Page-level for V0.1; fine-grained deferred |
| Database | SQLite via GRDB |
| Persistence strategy | Write immediately |
| Stream model | Multiple streams from day one |
| Source model | Multiple sources per stream |

### 15.2 To Decide During Build

| Decision | Options | When to Decide |
|----------|---------|----------------|
| API key storage | Keychain vs. UserDefaults | Week 3, Day 14 |
| Window chrome | Title bar vs. frameless | Week 5, Day 21 |
| Default AI model | gpt-4o vs. gpt-4o-mini | Week 3, based on speed testing |
| Source panel default state | Collapsed vs. expanded | Week 5, after user testing |
| PDF extraction timeout | 5s vs. 10s vs. unlimited | Week 3, based on testing |

---

## Appendix A: Dependencies

### Swift

| Dependency | Purpose | Version |
|------------|---------|---------|
| GRDB | SQLite wrapper | Latest |
| (System) WebKit | WKWebView | Built-in |
| (System) PDFKit | PDF text extraction | Built-in |
| (System) UniformTypeIdentifiers | File type detection | Built-in |

### Web

| Dependency | Purpose | Version |
|------------|---------|---------|
| React | UI framework | 18.x |
| TipTap | Editor | 2.x |
| Tailwind CSS | Styling | 3.x |
| Vite | Build tool | 5.x |
| TypeScript | Type safety | 5.x |
| Lucide React | Icons | Latest |

---

## Appendix B: File Reference Implementation

### Security-Scoped Bookmarks

macOS requires explicit permission to access files outside the app sandbox. We use security-scoped bookmarks to maintain access across app restarts.

```swift
// Store bookmark when user grants access
func createBookmark(for url: URL) throws -> Data {
    return try url.bookmarkData(
        options: .withSecurityScope,
        includingResourceValuesForKeys: nil,
        relativeTo: nil
    )
}

// Restore access from stored bookmark
func accessFile(from bookmarkData: Data) throws -> URL {
    var isStale = false
    let url = try URL(
        resolvingBookmarkData: bookmarkData,
        options: .withSecurityScope,
        relativeTo: nil,
        bookmarkDataIsStale: &isStale
    )

    if isStale {
        // Bookmark needs refresh - request new access
        throw FileError.staleBookmark
    }

    guard url.startAccessingSecurityScopedResource() else {
        throw FileError.accessDenied
    }

    return url
    // Caller must call url.stopAccessingSecurityScopedResource() when done
}
```

---

## Appendix C: Context Window Calculation

### Token Estimation

GPT-4 uses ~4 characters per token for English text. Our rough estimation:

```swift
func estimateTokens(_ text: String) -> Int {
    return text.count / 4
}
```

### Budget Allocation (with sources)

| Scenario | System | Source | Cells | Response | Total |
|----------|--------|--------|-------|----------|-------|
| No sources | ~200 | 0 | ~7,800 | ~2,000 | ~10,000 |
| With source | ~200 | ~6,000 | ~1,800 | ~2,000 | ~10,000 |

GPT-4o has 128k context, so we're using <10% of capacity. This gives us room to grow in V0.2 (multi-source context, larger documents).

---

*This implementation plan is a living document. Update as decisions are made and scope evolves.*

*Version 3.0 - Source-Attached Model - December 2024*

**Revision History:**
- V1.0: Initial plan (pure Swift architecture)
- V2.0: Hybrid architecture (Swift + WKWebView + React)
- V3.0: Source-attached model (files as live references, not imports)
