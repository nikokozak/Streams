import WebKit
import AppKit
import UniformTypeIdentifiers

/// Manages the WKWebView and Swift ↔ JS bridge
final class WebViewManager: NSObject {
    let webView: DroppableWebView
    private let bridgeService: BridgeService
    private let persistence: PersistenceService?
    private let sourceService: SourceService?
    private let aiService: AIService
    private let perplexityService: PerplexityService
    private let orchestrator: AIOrchestrator
    private let dependencyService: DependencyService
    private var processingService: ProcessingService?
    private var mlxClassifier: MLXClassifier?
    private var classifierSkipped = false  // True if classifier loading was intentionally skipped

    // RAG services
    private let embeddingService: EmbeddingService
    private let chunkingService: ChunkingService
    private var retrievalService: RetrievalService?

    override init() {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        self.bridgeService = BridgeService()
        config.userContentController.add(bridgeService, name: "bridge")

        self.webView = DroppableWebView(frame: .zero, configuration: config)

        // Initialize services
        self.aiService = AIService()
        self.perplexityService = PerplexityService()

        // Initialize RAG services
        self.embeddingService = EmbeddingService()
        self.chunkingService = ChunkingService()

        // Initialize orchestrator and register providers
        self.orchestrator = AIOrchestrator()
        orchestrator.register(aiService)
        orchestrator.register(perplexityService)

        // Initialize dependency service
        self.dependencyService = DependencyService()

        do {
            let p = try PersistenceService()
            self.persistence = p

            // Create SourceService with RAG components
            self.sourceService = SourceService(
                persistence: p,
                chunkingService: chunkingService,
                embeddingService: embeddingService
            )

            // Create RetrievalService and wire to orchestrator
            self.retrievalService = RetrievalService(
                persistence: p,
                embeddingService: embeddingService
            )
            orchestrator.setRetrievalService(retrievalService!)

            self.processingService = ProcessingService(
                orchestrator: orchestrator,
                dependencyService: dependencyService,
                persistence: p
            )
        } catch {
            print("Failed to initialize persistence: \(error)")
            self.persistence = nil
            self.sourceService = nil
            self.retrievalService = nil
            self.processingService = nil
        }

        super.init()

        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        bridgeService.webView = webView
        bridgeService.onMessage = { [weak self] message in
            self?.handleMessage(message)
        }

        // Handle file drops from native drag-and-drop
        webView.onFilesDropped = { [weak self] urls in
            self?.handleDroppedFiles(urls)
        }
    }

    /// Handle files dropped via native macOS drag-and-drop
    private func handleDroppedFiles(_ urls: [URL]) {
        // Get current stream ID from frontend
        bridgeService.send(BridgeMessage(
            type: "requestCurrentStreamId",
            payload: nil
        ))

        // Store URLs temporarily and wait for stream ID response
        pendingDroppedFiles = urls
    }

    private var pendingDroppedFiles: [URL] = []

    /// Called by frontend with the current stream ID
    private func processDroppedFiles(streamId: UUID) {
        guard let sourceService else {
            print("Source service unavailable")
            pendingDroppedFiles = []
            return
        }

        for url in pendingDroppedFiles {
            do {
                let source = try sourceService.addSource(from: url, to: streamId)
                let sourcePayload = encodeSource(source)
                bridgeService.send(BridgeMessage(type: "sourceAdded", payload: ["source": AnyCodable(sourcePayload)]))
            } catch {
                print("Failed to add dropped file \(url.lastPathComponent): \(error)")
                bridgeService.send(BridgeMessage(type: "sourceError", payload: ["error": AnyCodable(error.localizedDescription)]))
            }
        }

        pendingDroppedFiles = []
    }

    func load() {
        loadWebContent()
        loadMLXClassifier()
        migrateExistingSourcesToRAG()
    }

    /// Migrate existing sources to RAG pipeline in background
    private func migrateExistingSourcesToRAG() {
        guard let persistence, let sourceService else { return }

        Task {
            // Wait 5 seconds after app launch to avoid blocking startup
            try? await Task.sleep(nanoseconds: 5_000_000_000)

            let migrationService = RAGMigrationService(
                persistence: persistence,
                sourceService: sourceService
            )
            await migrationService.migrateExistingSources()
        }
    }

    /// Load the MLX classifier in the background (only if smart routing enabled and Perplexity configured)
    private func loadMLXClassifier() {
        // Only load classifier if smart routing is enabled and Perplexity is configured
        guard SettingsService.shared.smartRoutingEnabled else {
            print("MLX classifier skipped: smart routing disabled")
            classifierSkipped = true
            return
        }
        guard let perplexityKey = SettingsService.shared.perplexityAPIKey,
              !perplexityKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            print("MLX classifier skipped: Perplexity API key not configured")
            classifierSkipped = true
            return
        }

        classifierSkipped = false
        Task {
            let classifier = MLXClassifier()
            self.mlxClassifier = classifier  // Store immediately so loading state is visible

            do {
                try await classifier.prepare()
                orchestrator.setClassifier(classifier)
                print("MLX classifier loaded and ready")
            } catch {
                print("Failed to load MLX classifier: \(error)")
                // App continues to work, just uses direct GPT calls
            }

            // Notify frontend of classifier state change
            let settings = settingsWithClassifierState()
            bridgeService.send(BridgeMessage(
                type: "settingsLoaded",
                payload: ["settings": AnyCodable(settings)]
            ))
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
                    // Build dependency graph for this stream
                    dependencyService.buildGraph(from: stream.cells)

                    let streamPayload = encodeStream(stream)
                    bridgeService.send(BridgeMessage(type: "streamLoaded", payload: ["stream": AnyCodable(streamPayload)]))

                    // Process live blocks (async, after stream is loaded)
                    if let processingService {
                        Task {
                            await processingService.processStreamOpen(
                                stream,
                                onBlockRefreshStart: { [weak self] blockId in
                                    self?.bridgeService.send(BridgeMessage(
                                        type: "blockRefreshStart",
                                        payload: ["cellId": AnyCodable(blockId.uuidString)]
                                    ))
                                },
                                onBlockChunk: { [weak self] blockId, chunk in
                                    self?.bridgeService.send(BridgeMessage(
                                        type: "blockRefreshChunk",
                                        payload: ["cellId": AnyCodable(blockId.uuidString), "chunk": AnyCodable(chunk)]
                                    ))
                                },
                                onBlockRefreshComplete: { [weak self] blockId, content in
                                    self?.bridgeService.send(BridgeMessage(
                                        type: "blockRefreshComplete",
                                        payload: ["cellId": AnyCodable(blockId.uuidString), "content": AnyCodable(content)]
                                    ))
                                },
                                onBlockRefreshError: { [weak self] blockId, error in
                                    self?.bridgeService.send(BridgeMessage(
                                        type: "blockRefreshError",
                                        payload: ["cellId": AnyCodable(blockId.uuidString), "error": AnyCodable(error.localizedDescription)]
                                    ))
                                }
                            )
                        }
                    }
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
                var cell = try decodeCell(from: payload)

                // Parse references from content and resolve to UUIDs
                let identifiers = DependencyService.extractReferenceIdentifiers(from: cell.content)
                if !identifiers.isEmpty, let stream = try persistence.loadStream(id: cell.streamId) {
                    let resolvedRefs = DependencyService.resolveIdentifiers(identifiers, in: stream.cells)
                    cell = Cell(
                        id: cell.id,
                        streamId: cell.streamId,
                        content: cell.content,
                        restatement: cell.restatement,
                        originalPrompt: cell.originalPrompt,
                        type: cell.type,
                        order: cell.order,
                        modifiers: cell.modifiers,
                        versions: cell.versions,
                        activeVersionId: cell.activeVersionId,
                        processingConfig: cell.processingConfig,
                        references: resolvedRefs.isEmpty ? nil : resolvedRefs,
                        blockName: cell.blockName
                    )
                }

                // Update dependency graph
                dependencyService.updateCell(cell)

                try persistence.saveCell(cell)

                // Find dependents that need cascade updates
                let dependents = dependencyService.getCascadeDependents(of: cell.id)
                let dependentIds = dependents.map { $0.uuidString }

                bridgeService.send(BridgeMessage(type: "cellSaved", payload: [
                    "id": AnyCodable(cell.id.uuidString),
                    "dependents": AnyCodable(dependentIds)
                ]))

                // Trigger cascade updates for dependent blocks
                if !dependents.isEmpty, let processingService, let stream = try persistence.loadStream(id: cell.streamId) {
                    Task {
                        await processingService.processCascadeUpdate(
                            changedBlockId: cell.id,
                            in: stream,
                            onBlockRefreshStart: { [weak self] blockId in
                                self?.bridgeService.send(BridgeMessage(
                                    type: "blockRefreshStart",
                                    payload: ["cellId": AnyCodable(blockId.uuidString)]
                                ))
                            },
                            onBlockChunk: { [weak self] blockId, chunk in
                                self?.bridgeService.send(BridgeMessage(
                                    type: "blockRefreshChunk",
                                    payload: ["cellId": AnyCodable(blockId.uuidString), "chunk": AnyCodable(chunk)]
                                ))
                            },
                            onBlockRefreshComplete: { [weak self] blockId, content in
                                self?.bridgeService.send(BridgeMessage(
                                    type: "blockRefreshComplete",
                                    payload: ["cellId": AnyCodable(blockId.uuidString), "content": AnyCodable(content)]
                                ))
                            },
                            onBlockRefreshError: { [weak self] blockId, error in
                                self?.bridgeService.send(BridgeMessage(
                                    type: "blockRefreshError",
                                    payload: ["cellId": AnyCodable(blockId.uuidString), "error": AnyCodable(error.localizedDescription)]
                                ))
                            }
                        )
                    }
                }
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
                // Remove from dependency graph
                dependencyService.removeCell(id: id)

                try persistence.deleteCell(id: id)
                bridgeService.send(BridgeMessage(type: "cellDeleted", payload: ["id": AnyCodable(id.uuidString)]))
            } catch {
                print("Failed to delete cell: \(error)")
            }

        case "reorderBlocks":
            guard let payload = message.payload,
                  let streamIdValue = payload["streamId"]?.value as? String,
                  let streamId = UUID(uuidString: streamIdValue),
                  let ordersRaw = payload["orders"]?.value as? [[String: Any]] else {
                print("Invalid reorderBlocks payload")
                return
            }
            do {
                let orders = ordersRaw.compactMap { dict -> (UUID, Int)? in
                    guard let idStr = dict["id"] as? String,
                          let id = UUID(uuidString: idStr),
                          let order = dict["order"] as? Int else { return nil }
                    return (id, order)
                }
                try persistence.updateCellOrders(orders, streamId: streamId)
                bridgeService.send(BridgeMessage(type: "blocksReordered", payload: [:]))
            } catch {
                print("Failed to reorder blocks: \(error)")
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
                // Note: "net.daringfireball.markdown" is the standard UTI for markdown files
                let markdownType = UTType(filenameExtension: "md") ?? UTType.plainText
                panel.allowedContentTypes = [.pdf, .plainText, .text, .sourceCode, markdownType, .png, .jpeg, .heic, .image]
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

        case "addSourceFromPath":
            guard let payload = message.payload,
                  let streamIdValue = payload["streamId"]?.value as? String,
                  let streamId = UUID(uuidString: streamIdValue),
                  let filePath = payload["path"]?.value as? String,
                  let sourceService else {
                print("Invalid addSourceFromPath payload or service unavailable")
                return
            }

            let url = URL(fileURLWithPath: filePath)
            do {
                let source = try sourceService.addSource(from: url, to: streamId)
                let sourcePayload = encodeSource(source)
                bridgeService.send(BridgeMessage(type: "sourceAdded", payload: ["source": AnyCodable(sourcePayload)]))
            } catch {
                print("Failed to add source from path: \(error)")
                bridgeService.send(BridgeMessage(type: "sourceError", payload: ["error": AnyCodable(error.localizedDescription)]))
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
                bridgeService.send(BridgeMessage(type: "sourceRemoveError", payload: [
                    "id": AnyCodable(id.uuidString),
                    "error": AnyCodable(error.localizedDescription)
                ]))
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

            // Parse streamId for RAG retrieval
            var streamIdForRAG: UUID? = nil
            var sourceContext: String? = nil

            if let streamIdValue = payload["streamId"]?.value as? String,
               let streamId = UUID(uuidString: streamIdValue) {
                streamIdForRAG = streamId

                // Build fallback source context (used if RAG unavailable)
                if let stream = try? persistence.loadStream(id: streamId) {
                    let combinedText = stream.sources
                        .compactMap { $0.extractedText }
                        .joined(separator: "\n\n---\n\n")
                    if !combinedText.isEmpty {
                        sourceContext = combinedText
                    }
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

            // Route through orchestrator (handles smart routing and RAG retrieval internally)
            Task {
                await orchestrator.route(
                    query: currentCell,
                    streamId: streamIdForRAG,
                    priorCells: priorCells,
                    sourceContext: sourceContext,
                    onChunk: onChunk,
                    onComplete: onComplete,
                    onError: onError
                )
            }

            // Generate restatement asynchronously (don't block the AI response)
            aiService.generateRestatement(for: currentCell) { [weak self] restatement in
                guard let self, let restatement else { return }

                // Send restatement to frontend
                self.bridgeService.send(BridgeMessage(
                    type: "restatementGenerated",
                    payload: [
                        "cellId": AnyCodable(cellId),
                        "restatement": AnyCodable(restatement)
                    ]
                ))

                // Also persist to database if we have a stream ID and persistence
                if let persistence = self.persistence,
                   let cellUUID = UUID(uuidString: cellId) {
                    do {
                        try persistence.updateCellRestatement(cellId: cellUUID, restatement: restatement)
                    } catch {
                        print("Failed to save restatement: \(error)")
                    }
                }
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
            let settings = settingsWithClassifierState()
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
            let settings = settingsWithClassifierState()
            bridgeService.send(BridgeMessage(
                type: "settingsLoaded",
                payload: ["settings": AnyCodable(settings)]
            ))

        case "currentStreamId":
            // Response from frontend with current stream ID for file drops
            guard let payload = message.payload,
                  let streamIdValue = payload["streamId"]?.value as? String,
                  let streamId = UUID(uuidString: streamIdValue) else {
                print("Invalid currentStreamId payload")
                pendingDroppedFiles = []
                return
            }
            processDroppedFiles(streamId: streamId)

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
                    "embeddingStatus": source.embeddingStatus.rawValue,
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
                // Processing fields
                if let processingConfig = cell.processingConfig {
                    var configDict: [String: Any] = [:]
                    if let refreshTrigger = processingConfig.refreshTrigger {
                        configDict["refreshTrigger"] = refreshTrigger.rawValue
                    }
                    if let schema = processingConfig.schema {
                        var schemaDict: [String: Any] = ["jsonSchema": schema.jsonSchema, "driftDetected": schema.driftDetected]
                        if let lastValidatedAt = schema.lastValidatedAt {
                            schemaDict["lastValidatedAt"] = formatter.string(from: lastValidatedAt)
                        }
                        configDict["schema"] = schemaDict
                    }
                    if let autoTransform = processingConfig.autoTransform {
                        configDict["autoTransform"] = [
                            "condition": autoTransform.condition,
                            "transformation": autoTransform.transformation
                        ]
                    }
                    if !configDict.isEmpty {
                        dict["processingConfig"] = configDict
                    }
                }
                if let references = cell.references, !references.isEmpty {
                    dict["references"] = references.map { $0.uuidString }
                }
                if let blockName = cell.blockName {
                    dict["blockName"] = blockName
                }
                // Source binding
                if let sourceBinding = cell.sourceBinding {
                    var bindingDict: [String: Any] = ["sourceId": sourceBinding.sourceId.uuidString]
                    switch sourceBinding.location {
                    case .whole:
                        bindingDict["location"] = ["type": "whole"]
                    case .page(let page):
                        bindingDict["location"] = ["type": "page", "page": page]
                    case .pageRange(let start, let end):
                        bindingDict["location"] = ["type": "pageRange", "startPage": start, "endPage": end]
                    }
                    dict["sourceBinding"] = bindingDict
                } else {
                    dict["sourceBinding"] = NSNull()
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

    /// Get settings enriched with classifier state
    private func settingsWithClassifierState() -> [String: Any] {
        var settings = SettingsService.shared.allSettings()
        if let classifier = mlxClassifier {
            settings["classifierReady"] = classifier.isReady
            settings["classifierLoading"] = classifier.isLoading
            if let error = classifier.loadError {
                settings["classifierError"] = error.localizedDescription
            }
        } else if classifierSkipped {
            // Classifier was intentionally skipped (smart routing disabled or no API key)
            settings["classifierReady"] = false
            settings["classifierLoading"] = false
        } else {
            // Classifier hasn't been loaded yet
            settings["classifierReady"] = false
            settings["classifierLoading"] = true
        }
        return settings
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

        // Decode processing fields
        var processingConfig: ProcessingConfig? = nil
        if let configRaw = payload["processingConfig"]?.value as? [String: Any] {
            var config = ProcessingConfig()
            if let refreshTriggerRaw = configRaw["refreshTrigger"] as? String {
                config.refreshTrigger = RefreshTrigger(rawValue: refreshTriggerRaw)
            }
            if let schemaRaw = configRaw["schema"] as? [String: Any],
               let jsonSchema = schemaRaw["jsonSchema"] as? String {
                config.schema = BlockSchema(
                    jsonSchema: jsonSchema,
                    driftDetected: schemaRaw["driftDetected"] as? Bool ?? false
                )
            }
            if let autoTransformRaw = configRaw["autoTransform"] as? [String: Any],
               let condition = autoTransformRaw["condition"] as? String,
               let transformation = autoTransformRaw["transformation"] as? String {
                config.autoTransform = AutoTransformRule(condition: condition, transformation: transformation)
            }
            processingConfig = config
        }

        var references: [UUID]? = nil
        if let referencesRaw = payload["references"]?.value as? [String] {
            references = referencesRaw.compactMap { UUID(uuidString: $0) }
        }

        let blockName = payload["blockName"]?.value as? String

        // Decode source binding
        var sourceBinding: SourceBinding? = nil
        if let bindingRaw = payload["sourceBinding"]?.value as? [String: Any],
           let sourceIdStr = bindingRaw["sourceId"] as? String,
           let sourceId = UUID(uuidString: sourceIdStr),
           let locationRaw = bindingRaw["location"] as? [String: Any],
           let locationType = locationRaw["type"] as? String {
            let location: SourceLocation
            switch locationType {
            case "page":
                if let page = locationRaw["page"] as? Int {
                    location = .page(page)
                } else {
                    location = .whole
                }
            case "pageRange":
                if let start = locationRaw["startPage"] as? Int,
                   let end = locationRaw["endPage"] as? Int {
                    location = .pageRange(start, end)
                } else {
                    location = .whole
                }
            default:
                location = .whole
            }
            sourceBinding = SourceBinding(sourceId: sourceId, location: location)
        }

        return Cell(
            id: id,
            streamId: streamId,
            content: content,
            restatement: restatement,
            originalPrompt: originalPrompt,
            type: type,
            sourceBinding: sourceBinding,
            order: order,
            modifiers: modifiers,
            versions: versions,
            activeVersionId: activeVersionId,
            processingConfig: processingConfig,
            references: references,
            blockName: blockName
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
