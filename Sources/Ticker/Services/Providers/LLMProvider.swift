import Foundation

/// Protocol for AI service providers
/// Abstracts different LLM backends (OpenAI, Perplexity, etc.) behind a common interface
protocol LLMProvider {
    /// Unique identifier for this provider
    var id: String { get }

    /// Human-readable name for display
    var name: String { get }

    /// The specific model ID used by this provider (e.g., "gpt-4o", "sonar")
    var modelId: String { get }

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

/// Content part for multimodal messages
enum LLMContentPart {
    case text(String)
    case imageURL(String)  // URL to image (can be data URL or http URL)
}

/// A message in an LLM conversation
struct LLMMessage {
    var role: String
    var content: String
    var imageURLs: [String]  // Optional image URLs for vision models

    init(role: String, content: String, imageURLs: [String] = []) {
        self.role = role
        self.content = content
        self.imageURLs = imageURLs
    }

    /// Whether this message contains images
    var hasImages: Bool { !imageURLs.isEmpty }
}

/// A standardized request to an LLM provider
struct LLMRequest {
    /// System prompt for the model
    var systemPrompt: String

    /// Conversation messages with optional image support
    var messages: [LLMMessage]

    /// Temperature for response randomness (0.0 - 1.0)
    var temperature: Double

    /// Maximum tokens to generate (nil for provider default)
    var maxTokens: Int?

    init(
        systemPrompt: String,
        messages: [LLMMessage],
        temperature: Double = 0.7,
        maxTokens: Int? = nil
    ) {
        self.systemPrompt = systemPrompt
        self.messages = messages
        self.temperature = temperature
        self.maxTokens = maxTokens
    }

    /// Convenience initializer for text-only messages
    init(
        systemPrompt: String,
        textMessages: [(role: String, content: String)],
        temperature: Double = 0.7,
        maxTokens: Int? = nil
    ) {
        self.systemPrompt = systemPrompt
        self.messages = textMessages.map { LLMMessage(role: $0.role, content: $0.content) }
        self.temperature = temperature
        self.maxTokens = maxTokens
    }

    /// Whether any message in the request contains images
    var hasImages: Bool {
        messages.contains { $0.hasImages }
    }

    // MARK: - Token Budgeting

    /// Approximate number of tokens (~4 chars per token for English)
    private static let charsPerToken: Double = 4.0

    /// Approximate tokens per image (OpenAI vision uses ~85 tokens for low-detail, up to 1105 for high-detail)
    private static let tokensPerImage: Int = 500  // Conservative estimate

    /// Estimate token count for a string
    static func estimateTokens(_ text: String) -> Int {
        Int(ceil(Double(text.count) / charsPerToken))
    }

    /// Estimate token count for a message (including images)
    static func estimateTokens(_ message: LLMMessage) -> Int {
        var tokens = estimateTokens(message.content)
        tokens += message.imageURLs.count * tokensPerImage
        tokens += 4  // Message overhead
        return tokens
    }

    /// Total estimated tokens in this request
    var estimatedTokenCount: Int {
        var total = LLMRequest.estimateTokens(systemPrompt)
        for message in messages {
            total += LLMRequest.estimateTokens(message)
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
        let lastTokens = LLMRequest.estimateTokens(lastMessage)
        availableBudget -= lastTokens

        // Build messages from most recent to oldest, stopping when we run out of budget
        var keptMessages: [LLMMessage] = []
        for message in messages.dropLast().reversed() {
            let messageTokens = LLMRequest.estimateTokens(message)
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
