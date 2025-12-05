import Foundation

/// Intent types that the dispatcher can classify queries into
enum QueryIntent: String, CaseIterable {
    /// Needs current/real-time information (web search via Perplexity)
    case search
    /// General knowledge question (GPT)
    case knowledge
    /// Expand on existing content
    case expand
    /// Summarize content
    case summarize
    /// Rewrite/rephrase content
    case rewrite
    /// Extract key points
    case extract
    /// Unclear or needs more context
    case ambiguous

    var description: String {
        switch self {
        case .search: return "Real-time search query"
        case .knowledge: return "Knowledge-based question"
        case .expand: return "Expand on content"
        case .summarize: return "Summarize content"
        case .rewrite: return "Rewrite content"
        case .extract: return "Extract key points"
        case .ambiguous: return "Unclear intent"
        }
    }
}

/// Result of query classification
struct ClassificationResult {
    let intent: QueryIntent
    let confidence: Float
    let reasoning: String?
}

/// Protocol for query classification backends
protocol QueryClassifier {
    /// Classify a user query into an intent
    func classify(query: String) async throws -> ClassificationResult

    /// Whether the classifier is ready to use
    var isReady: Bool { get }

    /// Load/initialize the classifier if needed
    func prepare() async throws
}

/// Dispatcher service that routes queries to appropriate AI backends
final class DispatcherService {
    private var classifier: QueryClassifier?
    private let aiService: AIService
    private let perplexityService: PerplexityService?

    init(
        classifier: QueryClassifier? = nil,
        aiService: AIService = AIService(),
        perplexityService: PerplexityService? = nil
    ) {
        self.classifier = classifier
        self.aiService = aiService
        self.perplexityService = perplexityService
    }

    /// Set the classifier (can be done lazily after model loads)
    func setClassifier(_ classifier: QueryClassifier) {
        self.classifier = classifier
    }

    /// Dispatch a query to the appropriate backend
    func dispatch(
        query: String,
        priorCells: [[String: String]],
        sourceContext: String?,
        onChunk: @escaping (String) -> Void,
        onComplete: @escaping () -> Void,
        onError: @escaping (Error) -> Void
    ) async {
        // If no classifier, default to knowledge (GPT)
        guard let classifier else {
            dispatchToKnowledge(
                query: query,
                priorCells: priorCells,
                sourceContext: sourceContext,
                onChunk: onChunk,
                onComplete: onComplete,
                onError: onError
            )
            return
        }

        do {
            // Classify the query
            let result = try await classifier.classify(query: query)
            print("Dispatcher: classified as \(result.intent) (confidence: \(result.confidence))")

            // Route based on intent
            switch result.intent {
            case .search:
                if let perplexity = perplexityService, perplexity.isConfigured {
                    await dispatchToSearch(
                        query: query,
                        onChunk: onChunk,
                        onComplete: onComplete,
                        onError: onError
                    )
                } else {
                    // Fall back to GPT with note about search
                    dispatchToKnowledge(
                        query: query,
                        priorCells: priorCells,
                        sourceContext: sourceContext,
                        onChunk: onChunk,
                        onComplete: onComplete,
                        onError: onError
                    )
                }

            case .knowledge, .expand, .summarize, .rewrite, .extract, .ambiguous:
                dispatchToKnowledge(
                    query: query,
                    priorCells: priorCells,
                    sourceContext: sourceContext,
                    onChunk: onChunk,
                    onComplete: onComplete,
                    onError: onError
                )
            }
        } catch {
            print("Dispatcher: classification failed, defaulting to knowledge - \(error)")
            dispatchToKnowledge(
                query: query,
                priorCells: priorCells,
                sourceContext: sourceContext,
                onChunk: onChunk,
                onComplete: onComplete,
                onError: onError
            )
        }
    }

    private func dispatchToKnowledge(
        query: String,
        priorCells: [[String: String]],
        sourceContext: String?,
        onChunk: @escaping (String) -> Void,
        onComplete: @escaping () -> Void,
        onError: @escaping (Error) -> Void
    ) {
        aiService.think(
            currentCell: query,
            priorCells: priorCells,
            sourceContext: sourceContext,
            onChunk: onChunk,
            onComplete: onComplete,
            onError: onError
        )
    }

    private func dispatchToSearch(
        query: String,
        onChunk: @escaping (String) -> Void,
        onComplete: @escaping () -> Void,
        onError: @escaping (Error) -> Void
    ) async {
        guard let perplexity = perplexityService else {
            onError(DispatcherError.serviceUnavailable("Perplexity"))
            return
        }

        await perplexity.search(
            query: query,
            onChunk: onChunk,
            onComplete: onComplete,
            onError: onError
        )
    }
}

enum DispatcherError: LocalizedError {
    case classificationFailed(String)
    case serviceUnavailable(String)

    var errorDescription: String? {
        switch self {
        case .classificationFailed(let reason):
            return "Classification failed: \(reason)"
        case .serviceUnavailable(let service):
            return "\(service) service is not available"
        }
    }
}
