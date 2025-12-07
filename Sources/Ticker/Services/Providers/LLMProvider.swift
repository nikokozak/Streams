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

    // MARK: - Token Budgeting

    /// Approximate number of tokens (~4 chars per token for English)
    private static let charsPerToken: Double = 4.0

    /// Estimate token count for a string
    static func estimateTokens(_ text: String) -> Int {
        Int(ceil(Double(text.count) / charsPerToken))
    }

    /// Total estimated tokens in this request
    var estimatedTokenCount: Int {
        var total = LLMRequest.estimateTokens(systemPrompt)
        for message in messages {
            total += LLMRequest.estimateTokens(message.content)
            total += 4  // Message overhead (role, formatting)
        }
        return total
    }

    /// Truncate request to fit within a token budget by removing oldest messages
    /// Keeps system prompt, first context message (if any), and most recent messages
    /// - Parameter budget: Maximum token count (default 100,000 for GPT-4o-mini safety margin)
    /// - Returns: A new request with truncated messages if needed
    func truncated(toTokenBudget budget: Int = 100_000) -> LLMRequest {
        let systemTokens = LLMRequest.estimateTokens(systemPrompt)
        var availableBudget = budget - systemTokens - (maxTokens ?? 2048)

        guard availableBudget > 0 else {
            // Not enough room even for system prompt, return with no messages
            return LLMRequest(
                systemPrompt: systemPrompt,
                messages: [],
                temperature: temperature,
                maxTokens: maxTokens
            )
        }

        // Always keep the last message (current query)
        guard let lastMessage = messages.last else { return self }
        let lastTokens = LLMRequest.estimateTokens(lastMessage.content) + 4
        availableBudget -= lastTokens

        // Build messages from most recent to oldest, stopping when we run out of budget
        var keptMessages: [(role: String, content: String)] = []
        for message in messages.dropLast().reversed() {
            let messageTokens = LLMRequest.estimateTokens(message.content) + 4
            if availableBudget >= messageTokens {
                keptMessages.insert(message, at: 0)
                availableBudget -= messageTokens
            } else {
                // Out of budget, stop adding older messages
                break
            }
        }

        // Add back the last message
        keptMessages.append(lastMessage)

        return LLMRequest(
            systemPrompt: systemPrompt,
            messages: keptMessages,
            temperature: temperature,
            maxTokens: maxTokens
        )
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
