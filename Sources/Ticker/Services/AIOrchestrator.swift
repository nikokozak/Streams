import Foundation

/// Central orchestrator for AI services
/// Manages LLM providers and routes requests based on intent classification
final class AIOrchestrator {
    private var providers: [String: LLMProvider] = [:]
    private var classifier: QueryClassifier?
    private let settings: SettingsService

    init(settings: SettingsService = .shared) {
        self.settings = settings
    }

    // MARK: - Provider Management

    /// Register a provider
    func register(_ provider: LLMProvider) {
        providers[provider.id] = provider
    }

    /// Get a provider by ID
    func provider(id: String) -> LLMProvider? {
        providers[id]
    }

    /// Get all configured providers
    var configuredProviders: [LLMProvider] {
        providers.values.filter { $0.isConfigured }
    }

    /// Set the query classifier for intent-based routing
    func setClassifier(_ classifier: QueryClassifier) {
        self.classifier = classifier
    }

    // MARK: - Routing

    /// Route a request to the appropriate provider based on intent
    func route(
        query: String,
        priorCells: [[String: String]],
        sourceContext: String?,
        onChunk: @escaping (String) -> Void,
        onComplete: @escaping () -> Void,
        onError: @escaping (Error) -> Void
    ) async {
        // Classify if we have a classifier and smart routing is enabled
        var intent: QueryIntent = .knowledge
        if settings.smartRoutingEnabled, let classifier {
            do {
                let result = try await classifier.classify(query: query)
                intent = result.intent
                print("AIOrchestrator: classified as \(intent) (confidence: \(result.confidence))")
            } catch {
                print("AIOrchestrator: classification failed, defaulting to knowledge - \(error)")
            }
        }

        // Select provider based on intent
        let selectedProvider = selectProvider(for: intent)

        guard let provider = selectedProvider else {
            onError(OrchestratorError.noProviderAvailable)
            return
        }

        // Build request and truncate to token budget
        let request = buildRequest(
            for: intent,
            query: query,
            priorCells: priorCells,
            sourceContext: sourceContext
        ).truncated()

        // Stream the response
        await provider.stream(
            request: request,
            onChunk: onChunk,
            onComplete: onComplete,
            onError: onError
        )
    }

    /// Route using the provider protocol directly
    func stream(
        providerId: String,
        request: LLMRequest,
        onChunk: @escaping (String) -> Void,
        onComplete: @escaping () -> Void,
        onError: @escaping (Error) -> Void
    ) async {
        guard let provider = providers[providerId] else {
            onError(OrchestratorError.providerNotFound(providerId))
            return
        }

        guard provider.isConfigured else {
            onError(LLMProviderError.notConfigured(provider.name))
            return
        }

        await provider.stream(
            request: request,
            onChunk: onChunk,
            onComplete: onComplete,
            onError: onError
        )
    }

    // MARK: - Private

    private func selectProvider(for intent: QueryIntent) -> LLMProvider? {
        switch intent {
        case .search:
            // Prefer Perplexity for search, fall back to OpenAI
            if let perplexity = providers["perplexity"], perplexity.isConfigured {
                return perplexity
            }
            // Fall through to check OpenAI
            fallthrough

        case .knowledge, .expand, .summarize, .rewrite, .extract, .ambiguous:
            // Use OpenAI for knowledge-based tasks (if configured)
            if let openai = providers["openai"], openai.isConfigured {
                return openai
            }
            // Last resort: return any configured provider
            return configuredProviders.first
        }
    }

    private func buildRequest(
        for intent: QueryIntent,
        query: String,
        priorCells: [[String: String]],
        sourceContext: String?
    ) -> LLMRequest {
        // Select appropriate system prompt based on intent
        let systemPrompt: String
        switch intent {
        case .search:
            systemPrompt = Prompts.search
        case .summarize:
            systemPrompt = Prompts.applyModifier // Could add specific summarize prompt
        case .expand, .rewrite, .extract:
            systemPrompt = Prompts.applyModifier
        case .knowledge, .ambiguous:
            systemPrompt = Prompts.thinkingPartner
        }

        // Build messages from conversation history
        var messages: [(role: String, content: String)] = []

        // Add source context if available
        if let context = sourceContext, !context.isEmpty {
            messages.append((role: "user", content: "Reference documents:\n\n\(context)"))
            messages.append((role: "assistant", content: "I'll refer to these documents when answering."))
        }

        // Add prior cells as conversation history
        for cell in priorCells.dropLast() {
            let role = cell["type"] == "aiResponse" ? "assistant" : "user"
            if let content = cell["content"], !content.isEmpty {
                messages.append((role: role, content: content))
            }
        }

        // Add current query
        messages.append((role: "user", content: query))

        return LLMRequest(
            systemPrompt: systemPrompt,
            messages: messages,
            temperature: 0.7,
            maxTokens: 2048
        )
    }
}

// MARK: - Errors

enum OrchestratorError: LocalizedError {
    case noProviderAvailable
    case providerNotFound(String)

    var errorDescription: String? {
        switch self {
        case .noProviderAvailable:
            return "No AI provider is configured. Go to Settings to add an API key."
        case .providerNotFound(let id):
            return "Provider '\(id)' not found"
        }
    }
}
