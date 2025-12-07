import Foundation

/// Protocol for AI service providers
/// Abstracts different LLM backends (OpenAI, Perplexity, etc.) behind a common interface
protocol LLMProvider {
    /// Unique identifier for this provider
    var id: String { get }

    /// Human-readable name for display
    var name: String { get }

    /// Whether the provider is properly configured (API key set, etc.)
    var isConfigured: Bool { get }

    /// Stream a completion request
    /// - Parameters:
    ///   - request: The LLM request parameters
    ///   - onChunk: Called for each streamed chunk of content
    ///   - onComplete: Called when streaming finishes
    ///   - onError: Called if an error occurs
    func stream(
        request: LLMRequest,
        onChunk: @escaping (String) -> Void,
        onComplete: @escaping () -> Void,
        onError: @escaping (Error) -> Void
    ) async
}

/// A standardized request to an LLM provider
struct LLMRequest {
    /// System prompt for the model
    var systemPrompt: String

    /// Conversation messages (role: "user" or "assistant", content: message)
    var messages: [(role: String, content: String)]

    /// Temperature for response randomness (0.0 - 1.0)
    var temperature: Double

    /// Maximum tokens to generate (nil for provider default)
    var maxTokens: Int?

    init(
        systemPrompt: String,
        messages: [(role: String, content: String)],
        temperature: Double = 0.7,
        maxTokens: Int? = nil
    ) {
        self.systemPrompt = systemPrompt
        self.messages = messages
        self.temperature = temperature
        self.maxTokens = maxTokens
    }
}

/// Errors that can occur in LLM providers
enum LLMProviderError: LocalizedError {
    case notConfigured(String)
    case invalidRequest
    case invalidResponse
    case apiError(Int, String)

    var errorDescription: String? {
        switch self {
        case .notConfigured(let provider):
            return "\(provider) API key not configured. Go to Settings to add your key."
        case .invalidRequest:
            return "Failed to build API request"
        case .invalidResponse:
            return "Invalid response from API"
        case .apiError(let code, let message):
            return "API error (\(code)): \(message)"
        }
    }
}
