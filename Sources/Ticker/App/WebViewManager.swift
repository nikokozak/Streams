import WebKit
import AppKit
import UniformTypeIdentifiers

/// Manages the WKWebView and Swift ↔ JS bridge
final class WebViewManager: NSObject {
    let webView: WKWebView
    private let bridgeService: BridgeService
    private let persistence: PersistenceService?
    private let sourceService: SourceService?
    private let aiService: AIService
    private let perplexityService: PerplexityService
    private let dispatcherService: DispatcherService
    private var mlxClassifier: MLXClassifier?

    override init() {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        self.bridgeService = BridgeService()
        config.userContentController.add(bridgeService, name: "bridge")

        self.webView = WKWebView(frame: .zero, configuration: config)

        // Initialize services
        self.aiService = AIService()
        self.perplexityService = PerplexityService()
        self.dispatcherService = DispatcherService(
            classifier: nil,  // Will be set after MLX loads
            aiService: AIService(),
            perplexityService: PerplexityService()
        )

        do {
            let p = try PersistenceService()
            self.persistence = p
            self.sourceService = SourceService(persistence: p)
        } catch {
            print("Failed to initialize persistence: \(error)")
            self.persistence = nil
            self.sourceService = nil
        }

        super.init()

        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        bridgeService.webView = webView
        bridgeService.onMessage = { [weak self] message in
            self?.handleMessage(message)
        }
    }

    func load() {
        loadWebContent()
        loadMLXClassifier()
    }

    /// Load the MLX classifier in the background
    private func loadMLXClassifier() {
        Task {
            do {
                let classifier = MLXClassifier()
                try await classifier.prepare()
                self.mlxClassifier = classifier
                dispatcherService.setClassifier(classifier)
                print("MLX classifier loaded and ready")
            } catch {
                print("Failed to load MLX classifier: \(error)")
                // App continues to work, just uses direct GPT calls
            }
        }
    }

    private func loadWebContent() {
        // In development, load from Vite dev server
        // In production, load from bundled resources
        #if DEBUG
        if let url = URL(string: "http://localhost:5173") {
            webView.load(URLRequest(url: url))
        }
        #else
        if let resourceURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Resources") {
            webView.loadFileURL(resourceURL, allowingReadAccessTo: resourceURL.deletingLastPathComponent())
        }
        #endif
    }

    private func handleMessage(_ message: BridgeMessage) {
        Task {
            await processMessage(message)
        }
    }

    private func processMessage(_ message: BridgeMessage) async {
        guard let persistence else {
            print("Persistence not available")
            return
        }

        switch message.type {
        case "loadStreams":
            do {
                let summaries = try persistence.loadStreamSummaries()
                let formatter = ISO8601DateFormatter()
                let payload: [String: AnyCodable] = [
                    "streams": AnyCodable(summaries.map { summary -> [String: Any] in
                        var dict: [String: Any] = [
                            "id": summary.id.uuidString,
                            "title": summary.title,
                            "sourceCount": summary.sourceCount,
                            "cellCount": summary.cellCount,
                            "updatedAt": formatter.string(from: summary.updatedAt)
                        ]
                        if let previewText = summary.previewText {
                            dict["previewText"] = previewText
                        }
                        return dict
                    })
                ]
                bridgeService.send(BridgeMessage(type: "streamsLoaded", payload: payload))
            } catch {
                print("Failed to load streams: \(error)")
            }

        case "loadStream":
            guard let payload = message.payload,
                  let idValue = payload["id"]?.value as? String,
                  let id = UUID(uuidString: idValue) else {
                print("Invalid loadStream payload")
                return
            }
            do {
                if let stream = try persistence.loadStream(id: id) {
                    // Debug: log cell info
                    for cell in stream.cells {
                        if cell.type == .aiResponse {
                            print("[Stream Load] AI Cell \(cell.id): originalPrompt=\(cell.originalPrompt ?? "nil"), versions=\(cell.versions?.count ?? 0), modifiers=\(cell.modifiers?.count ?? 0)")
                        }
                    }
                    let streamPayload = encodeStream(stream)
                    bridgeService.send(BridgeMessage(type: "streamLoaded", payload: ["stream": AnyCodable(streamPayload)]))
                }
            } catch {
                print("Failed to load stream: \(error)")
            }

        case "createStream":
            let title = (message.payload?["title"]?.value as? String) ?? "Untitled"
            do {
                let stream = try persistence.createStream(title: title)
                let streamPayload = encodeStream(stream)
                bridgeService.send(BridgeMessage(type: "streamLoaded", payload: ["stream": AnyCodable(streamPayload)]))
            } catch {
                print("Failed to create stream: \(error)")
            }

        case "updateStreamTitle":
            guard let payload = message.payload,
                  let idValue = payload["id"]?.value as? String,
                  let id = UUID(uuidString: idValue),
                  let title = payload["title"]?.value as? String else {
                print("Invalid updateStreamTitle payload")
                return
            }
            do {
                if var stream = try persistence.loadStream(id: id) {
                    stream.title = title
                    try persistence.updateStream(stream)
                    bridgeService.send(BridgeMessage(type: "streamTitleUpdated", payload: ["id": AnyCodable(id.uuidString), "title": AnyCodable(title)]))
                }
            } catch {
                print("Failed to update stream title: \(error)")
            }

        case "deleteStream":
            guard let payload = message.payload,
                  let idValue = payload["id"]?.value as? String,
                  let id = UUID(uuidString: idValue) else {
                print("Invalid deleteStream payload")
                return
            }
            do {
                try persistence.deleteStream(id: id)
                // Reload streams list
                let summaries = try persistence.loadStreamSummaries()
                let formatter = ISO8601DateFormatter()
                let summariesPayload: [String: AnyCodable] = [
                    "streams": AnyCodable(summaries.map { summary -> [String: Any] in
                        var dict: [String: Any] = [
                            "id": summary.id.uuidString,
                            "title": summary.title,
                            "sourceCount": summary.sourceCount,
                            "cellCount": summary.cellCount,
                            "updatedAt": formatter.string(from: summary.updatedAt)
                        ]
                        if let previewText = summary.previewText {
                            dict["previewText"] = previewText
                        }
                        return dict
                    })
                ]
                bridgeService.send(BridgeMessage(type: "streamsLoaded", payload: summariesPayload))
            } catch {
                print("Failed to delete stream: \(error)")
            }

        case "saveCell":
            guard let payload = message.payload else {
                print("Invalid saveCell payload")
                return
            }
            do {
                let cell = try decodeCell(from: payload)
                // Debug logging
                if let versions = cell.versions, !versions.isEmpty {
                    print("[SaveCell] Cell \(cell.id) saving with \(versions.count) versions")
                }
                if let modifiers = cell.modifiers, !modifiers.isEmpty {
                    print("[SaveCell] Cell \(cell.id) saving with \(modifiers.count) modifiers")
                }
                try persistence.saveCell(cell)
                bridgeService.send(BridgeMessage(type: "cellSaved", payload: ["id": AnyCodable(cell.id.uuidString)]))
            } catch {
                print("Failed to save cell: \(error)")
            }

        case "deleteCell":
            guard let payload = message.payload,
                  let idValue = payload["id"]?.value as? String,
                  let id = UUID(uuidString: idValue) else {
                print("Invalid deleteCell payload")
                return
            }
            do {
                try persistence.deleteCell(id: id)
                bridgeService.send(BridgeMessage(type: "cellDeleted", payload: ["id": AnyCodable(id.uuidString)]))
            } catch {
                print("Failed to delete cell: \(error)")
            }

        case "addSource":
            guard let payload = message.payload,
                  let streamIdValue = payload["streamId"]?.value as? String,
                  let streamId = UUID(uuidString: streamIdValue),
                  let sourceService else {
                print("Invalid addSource payload or service unavailable")
                return
            }

            // Must run on main thread for NSOpenPanel
            await MainActor.run {
                let panel = NSOpenPanel()
                panel.canChooseFiles = true
                panel.canChooseDirectories = false
                panel.allowsMultipleSelection = false
                panel.allowedContentTypes = [.pdf, .plainText, .text]
                panel.message = "Select a file to attach"

                if panel.runModal() == .OK, let url = panel.url {
                    do {
                        let source = try sourceService.addSource(from: url, to: streamId)
                        let sourcePayload = encodeSource(source)
                        bridgeService.send(BridgeMessage(type: "sourceAdded", payload: ["source": AnyCodable(sourcePayload)]))
                    } catch {
                        print("Failed to add source: \(error)")
                        bridgeService.send(BridgeMessage(type: "sourceError", payload: ["error": AnyCodable(error.localizedDescription)]))
                    }
                }
            }

        case "removeSource":
            guard let payload = message.payload,
                  let idValue = payload["id"]?.value as? String,
                  let id = UUID(uuidString: idValue),
                  let sourceService else {
                print("Invalid removeSource payload")
                return
            }
            do {
                try sourceService.removeSource(id: id)
                bridgeService.send(BridgeMessage(type: "sourceRemoved", payload: ["id": AnyCodable(id.uuidString)]))
            } catch {
                print("Failed to remove source: \(error)")
            }

        case "think":
            guard let payload = message.payload,
                  let cellId = payload["cellId"]?.value as? String,
                  let currentCell = payload["currentCell"]?.value as? String else {
                print("Invalid think payload")
                return
            }

            // Parse prior cells
            var priorCells: [[String: String]] = []
            if let priorCellsRaw = payload["priorCells"]?.value as? [[String: Any]] {
                for cell in priorCellsRaw {
                    var cellDict: [String: String] = [:]
                    if let content = cell["content"] as? String {
                        cellDict["content"] = content
                    }
                    if let type = cell["type"] as? String {
                        cellDict["type"] = type
                    }
                    priorCells.append(cellDict)
                }
            }

            // Get source context if stream has sources
            var sourceContext: String? = nil
            if let streamIdValue = payload["streamId"]?.value as? String,
               let streamId = UUID(uuidString: streamIdValue),
               let stream = try? persistence.loadStream(id: streamId) {
                let combinedText = stream.sources
                    .compactMap { $0.extractedText }
                    .joined(separator: "\n\n---\n\n")
                if !combinedText.isEmpty {
                    sourceContext = combinedText
                }
            }

            // Check if configured
            guard aiService.isConfigured else {
                bridgeService.send(BridgeMessage(
                    type: "aiError",
                    payload: ["cellId": AnyCodable(cellId), "error": AnyCodable("OpenAI API key not configured. Go to Settings to add your key.")]
                ))
                return
            }

            // Define callbacks for streaming
            let onChunk: (String) -> Void = { [weak self] chunk in
                self?.bridgeService.send(BridgeMessage(
                    type: "aiChunk",
                    payload: ["cellId": AnyCodable(cellId), "chunk": AnyCodable(chunk)]
                ))
            }
            let onComplete: () -> Void = { [weak self] in
                self?.bridgeService.send(BridgeMessage(
                    type: "aiComplete",
                    payload: ["cellId": AnyCodable(cellId)]
                ))
            }
            let onError: (Error) -> Void = { [weak self] error in
                self?.bridgeService.send(BridgeMessage(
                    type: "aiError",
                    payload: ["cellId": AnyCodable(cellId), "error": AnyCodable(error.localizedDescription)]
                ))
            }

            // Use dispatcher if smart routing is enabled, otherwise direct to AI
            if SettingsService.shared.smartRoutingEnabled && SettingsService.shared.isPerplexityConfigured {
                Task {
                    await dispatcherService.dispatch(
                        query: currentCell,
                        priorCells: priorCells,
                        sourceContext: sourceContext,
                        onChunk: onChunk,
                        onComplete: onComplete,
                        onError: onError
                    )
                }
            } else {
                // Direct to OpenAI
                aiService.think(
                    currentCell: currentCell,
                    priorCells: priorCells,
                    sourceContext: sourceContext,
                    onChunk: onChunk,
                    onComplete: onComplete,
                    onError: onError
                )
            }

        case "applyModifier":
            guard let payload = message.payload,
                  let cellId = payload["cellId"]?.value as? String,
                  let modifierPrompt = payload["modifierPrompt"]?.value as? String,
                  let currentContent = payload["currentContent"]?.value as? String else {
                print("[Modifier] Invalid applyModifier payload")
                return
            }

            print("[Modifier] Received request - cellId: \(cellId), prompt: \(modifierPrompt.prefix(50))")

            // Check if configured
            guard aiService.isConfigured else {
                print("[Modifier] Error: API not configured")
                bridgeService.send(BridgeMessage(
                    type: "modifierError",
                    payload: ["cellId": AnyCodable(cellId), "error": AnyCodable("OpenAI API key not configured.")]
                ))
                return
            }

            // First, generate a short label for the modifier
            var modifierLabel = ""
            do {
                modifierLabel = try await generateModifierLabel(prompt: modifierPrompt)
                print("[Modifier] Generated label: \(modifierLabel)")
            } catch {
                print("[Modifier] Label generation failed: \(error), using truncated prompt")
                modifierLabel = String(modifierPrompt.prefix(20))
            }

            // Create the modifier
            let modifierId = UUID()
            let modifier: [String: Any] = [
                "id": modifierId.uuidString,
                "prompt": modifierPrompt,
                "label": modifierLabel,
                "createdAt": ISO8601DateFormatter().string(from: Date())
            ]

            // Send modifier created event
            print("[Modifier] Sending modifierCreated event")
            bridgeService.send(BridgeMessage(
                type: "modifierCreated",
                payload: ["cellId": AnyCodable(cellId), "modifier": AnyCodable(modifier)]
            ))

            // Track chunks for debugging
            var chunkCount = 0
            var totalContent = ""

            // Define callbacks for streaming
            let onChunk: (String) -> Void = { [weak self] chunk in
                chunkCount += 1
                totalContent += chunk
                if chunkCount <= 3 || chunkCount % 10 == 0 {
                    print("[Modifier] Chunk #\(chunkCount), total length: \(totalContent.count)")
                }
                self?.bridgeService.send(BridgeMessage(
                    type: "modifierChunk",
                    payload: ["cellId": AnyCodable(cellId), "modifierId": AnyCodable(modifierId.uuidString), "chunk": AnyCodable(chunk)]
                ))
            }
            let onComplete: () -> Void = { [weak self] in
                print("[Modifier] Complete - received \(chunkCount) chunks, total content length: \(totalContent.count)")
                self?.bridgeService.send(BridgeMessage(
                    type: "modifierComplete",
                    payload: ["cellId": AnyCodable(cellId), "modifierId": AnyCodable(modifierId.uuidString)]
                ))
            }
            let onError: (Error) -> Void = { [weak self] error in
                print("[Modifier] Error: \(error.localizedDescription)")
                self?.bridgeService.send(BridgeMessage(
                    type: "modifierError",
                    payload: ["cellId": AnyCodable(cellId), "error": AnyCodable(error.localizedDescription)]
                ))
            }

            // Apply the modifier using AI
            print("[Modifier] Starting AI request")
            aiService.applyModifier(
                currentContent: currentContent,
                modifierPrompt: modifierPrompt,
                onChunk: onChunk,
                onComplete: onComplete,
                onError: onError
            )

        case "exportMarkdown":
            // TODO: Export stream
            break

        case "loadSettings":
            let settings = SettingsService.shared.allSettings()
            bridgeService.send(BridgeMessage(
                type: "settingsLoaded",
                payload: ["settings": AnyCodable(settings)]
            ))

        case "saveSettings":
            guard let payload = message.payload else {
                print("Invalid saveSettings payload")
                return
            }

            // Save OpenAI API key if provided
            if let openaiKey = payload["openaiAPIKey"]?.value as? String {
                SettingsService.shared.openaiAPIKey = openaiKey.isEmpty ? nil : openaiKey
            }

            // Save Perplexity API key if provided
            if let perplexityKey = payload["perplexityAPIKey"]?.value as? String {
                SettingsService.shared.perplexityAPIKey = perplexityKey.isEmpty ? nil : perplexityKey
            }

            // Save smart routing setting if provided
            if let smartRouting = payload["smartRoutingEnabled"]?.value as? Bool {
                SettingsService.shared.smartRoutingEnabled = smartRouting
            }

            // Send back updated settings
            let settings = SettingsService.shared.allSettings()
            bridgeService.send(BridgeMessage(
                type: "settingsLoaded",
                payload: ["settings": AnyCodable(settings)]
            ))

        default:
            print("Unknown message type: \(message.type)")
        }
    }

    // MARK: - Encoding/Decoding Helpers

    private func encodeStream(_ stream: Stream) -> [String: Any] {
        let formatter = ISO8601DateFormatter()
        return [
            "id": stream.id.uuidString,
            "title": stream.title,
            "sources": stream.sources.map { source -> [String: Any] in
                var dict: [String: Any] = [
                    "id": source.id.uuidString,
                    "streamId": source.streamId.uuidString,
                    "displayName": source.displayName,
                    "fileType": source.fileType.rawValue,
                    "status": source.status.rawValue,
                    "addedAt": formatter.string(from: source.addedAt)
                ]
                if let pageCount = source.pageCount {
                    dict["pageCount"] = pageCount
                }
                return dict
            },
            "cells": stream.cells.map { cell -> [String: Any] in
                var dict: [String: Any] = [
                    "id": cell.id.uuidString,
                    "streamId": cell.streamId.uuidString,
                    "content": cell.content,
                    "type": cell.type.rawValue,
                    "order": cell.order,
                    "createdAt": formatter.string(from: cell.createdAt),
                    "updatedAt": formatter.string(from: cell.updatedAt)
                ]
                if let restatement = cell.restatement {
                    dict["restatement"] = restatement
                }
                if let originalPrompt = cell.originalPrompt {
                    dict["originalPrompt"] = originalPrompt
                }
                // Modifier stack fields
                if let modifiers = cell.modifiers, !modifiers.isEmpty {
                    dict["modifiers"] = modifiers.map { modifier -> [String: Any] in
                        [
                            "id": modifier.id.uuidString,
                            "prompt": modifier.prompt,
                            "label": modifier.label,
                            "createdAt": formatter.string(from: modifier.createdAt)
                        ]
                    }
                }
                if let versions = cell.versions, !versions.isEmpty {
                    dict["versions"] = versions.map { version -> [String: Any] in
                        [
                            "id": version.id.uuidString,
                            "content": version.content,
                            "modifierIds": version.modifierIds.map { $0.uuidString },
                            "createdAt": formatter.string(from: version.createdAt)
                        ]
                    }
                }
                if let activeVersionId = cell.activeVersionId {
                    dict["activeVersionId"] = activeVersionId.uuidString
                }
                return dict
            },
            "createdAt": formatter.string(from: stream.createdAt),
            "updatedAt": formatter.string(from: stream.updatedAt)
        ]
    }

    private func encodeSource(_ source: SourceReference) -> [String: Any] {
        let formatter = ISO8601DateFormatter()
        var dict: [String: Any] = [
            "id": source.id.uuidString,
            "streamId": source.streamId.uuidString,
            "displayName": source.displayName,
            "fileType": source.fileType.rawValue,
            "status": source.status.rawValue,
            "addedAt": formatter.string(from: source.addedAt)
        ]
        if let pageCount = source.pageCount {
            dict["pageCount"] = pageCount
        }
        if source.extractedText != nil {
            dict["hasExtractedText"] = true
        }
        return dict
    }

    /// Generate a short label for a modifier prompt using AI
    private func generateModifierLabel(prompt: String) async throws -> String {
        return try await aiService.generateLabel(for: prompt)
    }

    private func decodeCell(from payload: [String: AnyCodable]) throws -> Cell {
        guard let idValue = payload["id"]?.value as? String,
              let id = UUID(uuidString: idValue),
              let streamIdValue = payload["streamId"]?.value as? String,
              let streamId = UUID(uuidString: streamIdValue),
              let content = payload["content"]?.value as? String else {
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Invalid cell payload"))
        }

        let typeRaw = payload["type"]?.value as? String ?? "text"
        let type = CellType(rawValue: typeRaw) ?? .text
        let order = payload["order"]?.value as? Int ?? 0
        let restatement = payload["restatement"]?.value as? String
        let originalPrompt = payload["originalPrompt"]?.value as? String

        // Decode modifier stack fields
        var modifiers: [Modifier]? = nil
        if let modifiersRaw = payload["modifiers"]?.value as? [[String: Any]] {
            modifiers = modifiersRaw.compactMap { dict -> Modifier? in
                guard let idStr = dict["id"] as? String,
                      let modId = UUID(uuidString: idStr),
                      let prompt = dict["prompt"] as? String,
                      let label = dict["label"] as? String else { return nil }
                return Modifier(id: modId, prompt: prompt, label: label)
            }
        }

        var versions: [CellVersion]? = nil
        if let versionsRaw = payload["versions"]?.value as? [[String: Any]] {
            versions = versionsRaw.compactMap { dict -> CellVersion? in
                guard let idStr = dict["id"] as? String,
                      let verId = UUID(uuidString: idStr),
                      let verContent = dict["content"] as? String,
                      let modifierIdsRaw = dict["modifierIds"] as? [String] else { return nil }
                let modifierIds = modifierIdsRaw.compactMap { UUID(uuidString: $0) }
                return CellVersion(id: verId, content: verContent, modifierIds: modifierIds)
            }
        }

        var activeVersionId: UUID? = nil
        if let activeVersionIdStr = payload["activeVersionId"]?.value as? String {
            activeVersionId = UUID(uuidString: activeVersionIdStr)
        }

        return Cell(
            id: id,
            streamId: streamId,
            content: content,
            restatement: restatement,
            originalPrompt: originalPrompt,
            type: type,
            order: order,
            modifiers: modifiers,
            versions: versions,
            activeVersionId: activeVersionId
        )
    }
}

extension WebViewManager: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        print("WebView: Started loading")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        print("WebView: Finished loading")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("WebView: Failed with error: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("WebView: Failed provisional navigation: \(error.localizedDescription)")
    }
}
