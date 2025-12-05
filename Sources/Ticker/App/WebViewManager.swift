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

    override init() {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        self.bridgeService = BridgeService()
        config.userContentController.add(bridgeService, name: "bridge")

        self.webView = WKWebView(frame: .zero, configuration: config)

        // Initialize services
        self.aiService = AIService()
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

            // Get the source cell ID (the user's question cell)
            let sourceCellId = payload["sourceCellId"]?.value as? String
            print("Think request - sourceCellId: \(sourceCellId ?? "nil"), currentCell: \(currentCell.prefix(50))")

            // Generate restatement for the user's question (in parallel with thinking)
            if let sourceCellId {
                aiService.generateRestatement(for: currentCell) { [weak self] restatement in
                    print("Restatement result: \(restatement ?? "nil")")
                    if let restatement {
                        self?.bridgeService.send(BridgeMessage(
                            type: "cellRestatement",
                            payload: ["cellId": AnyCodable(sourceCellId), "restatement": AnyCodable(restatement)]
                        ))
                    }
                }
            }

            // Think with streaming
            aiService.think(
                currentCell: currentCell,
                priorCells: priorCells,
                sourceContext: sourceContext,
                onChunk: { [weak self] chunk in
                    self?.bridgeService.send(BridgeMessage(
                        type: "aiChunk",
                        payload: ["cellId": AnyCodable(cellId), "chunk": AnyCodable(chunk)]
                    ))
                },
                onComplete: { [weak self] in
                    self?.bridgeService.send(BridgeMessage(
                        type: "aiComplete",
                        payload: ["cellId": AnyCodable(cellId)]
                    ))
                },
                onError: { [weak self] error in
                    self?.bridgeService.send(BridgeMessage(
                        type: "aiError",
                        payload: ["cellId": AnyCodable(cellId), "error": AnyCodable(error.localizedDescription)]
                    ))
                }
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

        return Cell(
            id: id,
            streamId: streamId,
            content: content,
            restatement: restatement,
            type: type,
            order: order
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
