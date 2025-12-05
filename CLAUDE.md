# Ticker V2

An AI-augmented research space for macOS. Think *through* documents, not just *about* them.

---

## Philosophy

**Lens, not Silo.** Ticker attaches to your files as a thinking companion. Files stay where they are. Ticker adds a layer of cells, AI, and export on top.

---

## Architecture

```
Swift Shell (AppDelegate, Window, Services)
    ↓ Bridge (WKScriptMessageHandler)
WKWebView (React + TipTap)
```

- **Swift**: App lifecycle, window management, file access, AI calls, persistence
- **React**: Cell editing, UI state, slash commands
- **Bridge**: JSON messages between Swift and JavaScript

---

## Code Standards

### Non-Negotiables

1. **No hacks.** If it feels wrong, stop and think. Delete over patch.
2. **No dead code.** Remove unused imports, functions, files immediately.
3. **No magic numbers.** Constants go in one place with clear names.
4. **No force unwraps** in production code. Handle optionals properly.
5. **No technical debt.** Either do it right now or don't do it.

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

### File Organization

```
Sources/Ticker/
├── App/           # Lifecycle, windows (stable, rarely changes)
├── Services/      # Business logic (one file per service)
├── Models/        # Data structures (pure, no logic)
└── Resources/     # Static assets

Web/src/
├── components/    # React components (one per file)
├── hooks/         # Custom hooks
├── types/         # TypeScript interfaces
└── styles/        # CSS
```

### Naming

- **Files**: Match the primary export (`SourceService.swift`, `Cell.tsx`)
- **Types**: PascalCase (`SourceReference`, `CellState`)
- **Functions**: camelCase, verb-first (`loadStream`, `handleClick`)
- **Constants**: SCREAMING_SNAKE for true constants, camelCase otherwise
- **Booleans**: Use `is`, `has`, `should` prefixes (`isLoading`, `hasSource`)

---

## Development Workflow

### Before Writing Code

1. Read the relevant section of `IMPLEMENTATION_PLAN.md`
2. Understand the data flow
3. Check if similar code exists—reuse or refactor, don't duplicate

### While Writing Code

1. Write the simplest thing that works
2. Add error handling immediately, not later
3. Run `swift build` / `npm run build` frequently
4. Keep commits small and focused

### After Writing Code

1. Remove any dead code you introduced
2. Check for TODOs you can resolve now
3. Verify the build still passes

### Commands

```bash
# Swift
swift build                    # Build
swift run                      # Run (do this yourself)
swift test                     # Test

# Web
cd Web && npm install          # Install dependencies
cd Web && npm run dev          # Development server
cd Web && npm run build        # Production build
cd Web && npm run typecheck    # Type checking
```

### Git

- **Never** commit without building first
- **Never** push broken code
- Commit messages: `type: description` (e.g., `feat: add source panel`)
- Types: `feat`, `fix`, `refactor`, `docs`, `chore`

---

## Key Abstractions

### Stream
A thinking session. Has a title, sources, and cells.

### SourceReference
A pointer to an external file (PDF, text, image). Uses security-scoped bookmarks. File stays on disk; Ticker just references it.

### Cell
A unit of content. Types: `text` (user), `aiResponse` (AI), `quote` (from source). May have a `sourceBinding` linking to a specific location in a source.

### SourceBinding
Links a cell to a location in a source file. For V0.1: page-level only (`page(3)`, `pageRange(1, 5)`, or `whole`).

### Bridge Message
JSON messages between Swift and React. Always has `type` and `payload`. See `IMPLEMENTATION_PLAN.md` Section 2.3 for full list.

---

## Common Patterns

### Error Handling (Swift)

```swift
enum SourceError: LocalizedError {
    case notFound(UUID)
    case accessDenied(UUID)
    case extractionFailed(String)

    var errorDescription: String? {
        switch self {
        case .notFound(let id): return "Source not found: \(id)"
        case .accessDenied(let id): return "Access denied to source: \(id)"
        case .extractionFailed(let reason): return "Extraction failed: \(reason)"
        }
    }
}
```

### State Management (React)

```typescript
type CellState =
  | { status: 'idle' }
  | { status: 'editing' }
  | { status: 'loading' }
  | { status: 'error'; message: string };
```

### Bridge Communication

```swift
// Swift → JS
bridge.send(BridgeMessage(type: "streamLoaded", payload: stream))

// JS → Swift
window.webkit.messageHandlers.bridge.postMessage({
  type: 'saveCell',
  payload: cell
});
```

---

## What NOT to Do

- Don't add features not in `IMPLEMENTATION_PLAN.md`
- Don't optimize prematurely
- Don't add dependencies without good reason
- Don't write comments explaining *what*; write code that's self-evident
- Don't leave `print` statements in committed code
- Don't catch and ignore errors silently

---

## Reference Files

- `IMPLEMENTATION_PLAN.md` - Full specification (the contract)
- `Package.swift` - Swift dependencies
- `Web/package.json` - JS dependencies

---

## Questions?

If something is unclear:
1. Check `IMPLEMENTATION_PLAN.md` first
2. If still unclear, ask before implementing
3. Document the decision once made
