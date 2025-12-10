import AppKit
import SwiftUI

/// Manages the Quick Panel lifecycle, positioning, and state
/// Coordinates between services (cursor, selection) and the panel window
@MainActor
final class QuickPanelManager: ObservableObject {

    // MARK: - Published State

    @Published private(set) var isVisible: Bool = false
    @Published private(set) var context: QuickPanelContext?
    @Published var inputText: String = ""
    @Published var isLoading: Bool = false
    @Published var error: String?
    @Published var statusMessage: String?  // Temporary feedback (success/info messages)

    // MARK: - Services

    private let cursorService: CursorPositionService
    private let selectionService: SelectionReaderService
    private weak var persistence: PersistenceService?
    private weak var bridgeService: BridgeService?
    private var assetService: AssetService?

    // MARK: - Height Management

    private var targetHeight: CGFloat = QuickPanelWindow.minHeight
    private var heightDebounceTimer: Timer?
    private var isAnimatingHeight: Bool = false

    // MARK: - Window

    private var panel: QuickPanelWindow?
    private var hostingView: NSHostingView<QuickPanelView>?

    // MARK: - Initialization

    init(
        persistence: PersistenceService? = nil,
        bridgeService: BridgeService? = nil
    ) {
        let cursor = CursorPositionService()
        self.cursorService = cursor
        self.selectionService = SelectionReaderService(cursorService: cursor)
        self.persistence = persistence
        self.bridgeService = bridgeService
    }

    /// Configure services after initialization (for dependency injection)
    func configure(persistence: PersistenceService, bridgeService: BridgeService, assetService: AssetService? = nil) {
        self.persistence = persistence
        self.bridgeService = bridgeService
        self.assetService = assetService ?? AssetService()
    }

    // MARK: - Public API

    /// Toggle the quick panel
    func toggle() {
        // Capture context BEFORE we steal focus
        let capturedContext = selectionService.buildContext()

        if isVisible {
            // Check if there's a new selection
            let hasNewSelection = capturedContext.hasSelection &&
                capturedContext.selectedText != context?.selectedText

            if hasNewSelection {
                // Update context in place, don't move the panel
                self.context = capturedContext
                resetState()
            } else {
                // Same selection or no selection - toggle off
                hide()
            }
            return
        }

        // Panel is hidden - show it
        show(with: capturedContext)
    }

    /// Show after screenshot capture with status feedback
    func showAfterScreenshot() {
        if isVisible {
            hide()
        }
        var capturedContext = selectionService.buildContext()

        // Verify clipboard has image and update context
        if let imageData = ClipboardService.getImageData() {
            capturedContext = QuickPanelContext(
                selectedText: capturedContext.selectedText,
                activeApp: capturedContext.activeApp,
                windowTitle: capturedContext.windowTitle,
                panelPosition: capturedContext.panelPosition,
                clipboardImage: imageData
            )
            statusMessage = "Screenshot attached"
            // Auto-clear status after 2 seconds
            Task {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                if self.statusMessage == "Screenshot attached" {
                    self.statusMessage = nil
                }
            }
        }

        show(with: capturedContext)
    }

    /// Show the quick panel with specific context
    private func show(with capturedContext: QuickPanelContext) {
        self.context = capturedContext
        resetState()

        // Show accessibility warning if permission not granted and no context captured
        if !cursorService.hasAccessibilityPermission {
            if !capturedContext.hasContent {
                statusMessage = "Grant Accessibility permission to capture text selections"
            }
            cursorService.requestAccessibilityPermission()
        }

        // Create panel if needed
        if panel == nil {
            createPanel()
        }

        guard let panel = panel else { return }

        // Position at captured location
        panel.position(at: capturedContext.panelPosition)

        // Show panel without bringing main window forward
        panel.orderFrontRegardless()
        panel.makeKey()

        isVisible = true

        // Post notification for input focus
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            NotificationCenter.default.post(name: .quickPanelDidShow, object: nil)
        }
    }

    /// Hide the quick panel
    func hide() {
        panel?.orderOut(nil)
        isVisible = false
        resetState()
        statusMessage = nil
    }

    /// Reset state for new session
    private func resetState() {
        inputText = ""
        isLoading = false
        error = nil
    }

    // MARK: - Input Handling

    /// Handle Enter key - add content to stream
    func handleEnter() async {
        await addToStream(triggerAI: false)
    }

    /// Handle Cmd+Enter - add content and trigger AI
    func handleCmdEnter() async {
        await addToStream(triggerAI: true)
    }

    /// Handle Escape key
    func handleEscape() {
        if !inputText.isEmpty || context?.hasContent == true {
            // Clear input but stay open
            inputText = ""
            context = nil
        } else {
            hide()
        }
    }

    /// Clear attached context
    func clearContext() {
        context = nil
    }

    // MARK: - Cell Creation

    /// Add captured content and/or input to the active stream
    private func addToStream(triggerAI: Bool) async {
        guard let persistence = persistence else {
            error = "Persistence not configured"
            return
        }

        let hasContext = context?.hasContent == true
        let hasInput = !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty

        // Must have something to add
        guard hasContext || hasInput else {
            hide()
            return
        }

        isLoading = true
        error = nil

        do {
            // Get target stream (may create new one)
            let (streamId, isNewStream) = try getTargetStreamId()

            // Get insertion order - inserts before trailing empty cell if one exists
            // This bumps the empty cell's order, so we only call it once
            var nextOrder = try persistence.getInsertionOrderForQuickPanel(streamId: streamId)

            var cellsToAdd: [Cell] = []
            var contextCellId: UUID?

            // 1. If we have context (selection or image), create a quote cell
            if let ctx = context, ctx.hasContent {
                let contextCell = createContextCell(from: ctx, streamId: streamId, order: nextOrder)
                cellsToAdd.append(contextCell)
                contextCellId = contextCell.id
                try persistence.saveCell(contextCell)
                nextOrder += 1
            }

            // 2. If we have input text
            if hasInput {
                let trimmedInput = inputText.trimmingCharacters(in: .whitespacesAndNewlines)

                if triggerAI {
                    // Create AI response cell that references context
                    let aiCell = Cell(
                        streamId: streamId,
                        content: "",  // Will be filled by AI
                        originalPrompt: trimmedInput,
                        type: .aiResponse,
                        order: nextOrder,
                        references: contextCellId.map { [$0] }
                    )
                    cellsToAdd.append(aiCell)
                    try persistence.saveCell(aiCell)

                    // Notify frontend to trigger AI on this cell
                    notifyFrontend(streamId: streamId, cells: cellsToAdd, triggerAI: aiCell.id, isNewStream: isNewStream)
                } else {
                    // Create plain text cell
                    let textCell = Cell(
                        streamId: streamId,
                        content: "<p>\(escapeHtml(trimmedInput))</p>",
                        type: .text,
                        order: nextOrder
                    )
                    cellsToAdd.append(textCell)
                    try persistence.saveCell(textCell)

                    notifyFrontend(streamId: streamId, cells: cellsToAdd, triggerAI: nil, isNewStream: isNewStream)
                }
            } else {
                // Context only - just notify
                notifyFrontend(streamId: streamId, cells: cellsToAdd, triggerAI: nil, isNewStream: isNewStream)
            }

            // Success - hide panel
            hide()

        } catch {
            self.error = error.localizedDescription
            print("[QuickPanel] Error adding to stream: \(error)")
        }

        isLoading = false
    }

    /// Get the target stream ID (most recently modified, or create new)
    /// Returns (streamId, isNewStream) tuple
    private func getTargetStreamId() throws -> (UUID, Bool) {
        guard let persistence = persistence else {
            throw QuickPanelError.persistenceNotConfigured
        }

        // Get most recently modified stream
        if let recentStreamId = try persistence.getRecentlyModifiedStreamId() {
            return (recentStreamId, false)
        }

        // No streams exist - create a new one
        let newStream = Stream(title: "Untitled")
        try persistence.saveStream(newStream)

        return (newStream.id, true)
    }

    /// Create a quote cell from captured context
    private func createContextCell(from ctx: QuickPanelContext, streamId: UUID, order: Int) -> Cell {
        var content = ""

        if let text = ctx.selectedText {
            // Format as italicized quote with source info
            let escapedText = escapeHtml(text)
            content = "<p><em>\(escapedText)</em></p>"

            if let app = ctx.activeApp {
                content += "<p class=\"source-info\">— \(escapeHtml(app))</p>"
            }
        } else if let imageData = ctx.clipboardImage, let assetService = assetService {
            // Save image via AssetService and embed as img tag
            do {
                let relativePath = try assetService.saveImage(data: imageData, streamId: streamId)
                // Use relative path for portability - AssetSchemeHandler resolves at render time
                let assetUrl = "ticker-asset://\(relativePath)"
                content = "<p><img src=\"\(assetUrl)\" alt=\"Screenshot\" style=\"max-width: 100%;\"></p>"

                if let app = ctx.activeApp {
                    content += "<p class=\"source-info\">— Screenshot from \(escapeHtml(app))</p>"
                }
            } catch {
                print("[QuickPanel] Failed to save screenshot: \(error)")
                content = "<p>[Screenshot failed to save]</p>"
            }
        }

        return Cell(
            streamId: streamId,
            content: content,
            type: .quote,
            order: order,
            sourceApp: ctx.activeApp
        )
    }

    /// Notify the React frontend about new cells
    /// When isNewStream is true, includes stream metadata so frontend can add it without creating a blank cell
    private func notifyFrontend(streamId: UUID, cells: [Cell], triggerAI: UUID?, isNewStream: Bool = false) {
        guard let bridgeService = bridgeService else { return }

        var payload: [String: AnyCodable] = [
            "streamId": AnyCodable(streamId.uuidString),
            "cells": AnyCodable(cells.map { cellToDict($0) }),
            "isNewStream": AnyCodable(isNewStream)
        ]

        if let aiCellId = triggerAI {
            payload["triggerAI"] = AnyCodable(aiCellId.uuidString)
        }

        bridgeService.send(BridgeMessage(type: "quickPanelCellsAdded", payload: payload))
    }

    /// Convert Cell to dictionary for bridge
    private func cellToDict(_ cell: Cell) -> [String: Any] {
        var dict: [String: Any] = [
            "id": cell.id.uuidString,
            "streamId": cell.streamId.uuidString,
            "content": cell.content,
            "type": cell.type.rawValue,
            "order": cell.order,
            "createdAt": ISO8601DateFormatter().string(from: cell.createdAt),
            "updatedAt": ISO8601DateFormatter().string(from: cell.updatedAt)
        ]
        if let sourceApp = cell.sourceApp {
            dict["sourceApp"] = sourceApp
        }
        if let originalPrompt = cell.originalPrompt {
            dict["originalPrompt"] = originalPrompt
        }
        if let references = cell.references {
            dict["references"] = references.map { $0.uuidString }
        }
        return dict
    }

    /// Simple HTML escaping
    private func escapeHtml(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    // MARK: - Panel Creation

    private func createPanel() {
        let newPanel = QuickPanelWindow()

        newPanel.onDismiss = { [weak self] in
            self?.hide()
        }

        let view = QuickPanelView(manager: self)
        let hosting = NSHostingView(rootView: view)

        newPanel.setContentSize(NSSize(
            width: QuickPanelWindow.defaultWidth,
            height: QuickPanelWindow.minHeight
        ))

        hosting.frame = newPanel.contentView?.bounds ?? .zero
        hosting.autoresizingMask = [.width, .height]

        newPanel.contentView?.addSubview(hosting)

        self.panel = newPanel
        self.hostingView = hosting
    }

    // MARK: - Height Management

    /// Called by SwiftUI when content height changes
    func contentHeightChanged(_ height: CGFloat) {
        let clampedHeight = max(QuickPanelWindow.minHeight, min(height, QuickPanelWindow.maxHeight))
        targetHeight = clampedHeight

        heightDebounceTimer?.invalidate()
        heightDebounceTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.applyHeightUpdate()
            }
        }
    }

    private func applyHeightUpdate() {
        guard let panel = panel else { return }
        guard !isAnimatingHeight else { return }

        let currentHeight = panel.frame.height
        guard abs(currentHeight - targetHeight) > 1 else { return }

        isAnimatingHeight = true
        panel.resize(toHeight: targetHeight, animated: true) { [weak self] in
            self?.isAnimatingHeight = false
        }
    }
}

// MARK: - Errors

enum QuickPanelError: Error, LocalizedError {
    case persistenceNotConfigured
    case noActiveStream

    var errorDescription: String? {
        switch self {
        case .persistenceNotConfigured:
            return "Database not configured"
        case .noActiveStream:
            return "No active stream"
        }
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let quickPanelDidShow = Notification.Name("QuickPanelDidShow")
    static let quickPanelDidHide = Notification.Name("QuickPanelDidHide")
}
