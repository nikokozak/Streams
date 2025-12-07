import Foundation

/// Intent types that the classifier can identify
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

    /// Whether the classifier is currently loading
    var isLoading: Bool { get }

    /// Any error that occurred during loading
    var loadError: Error? { get }

    /// Load/initialize the classifier if needed
    func prepare() async throws
}
