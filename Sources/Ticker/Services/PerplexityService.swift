import Foundation

/// Service for Perplexity API calls (real-time search)
final class PerplexityService: LLMProvider {
    private let settings: SettingsService
    private let baseURL = "https://api.perplexity.ai/chat/completions"
    private let model = "sonar"  // Fast, good for search queries

    // MARK: - LLMProvider

    let id = "perplexity"
    let name = "Perplexity"
    var modelId: String { model }

    init(settings: SettingsService = .shared) {
        self.settings = settings
    }

    /// Get API key from settings or environment
    private var apiKey: String? {
        settings.perplexityAPIKey ?? ProcessInfo.processInfo.environment["PERPLEXITY_API_KEY"]
    }

    var isConfigured: Bool {
        guard let key = apiKey else { return false }
        return !key.isEmpty
    }

    /// LLMProvider streaming implementation
    func stream(
        request: LLMRequest,
        onChunk: @escaping (String) -> Void,
        onComplete: @escaping () -> Void,
        onError: @escaping (Error) -> Void
    ) async {
        guard let apiKey else {
            onError(LLMProviderError.notConfigured(name))
            return
        }

        var messages: [[String: String]] = [
            ["role": "system", "content": request.systemPrompt]
        ]

        // Perplexity requires alternating user/assistant messages
        // Merge consecutive messages of the same role
        // Note: Perplexity doesn't support images, so we only use text content
        for msg in request.messages {
            if let last = messages.last,
               last["role"] == msg.role,
               msg.role != "system" {
                // Merge with previous message of same role
                let merged = (last["content"] ?? "") + "\n\n" + msg.content
                messages[messages.count - 1]["content"] = merged
            } else {
                messages.append(["role": msg.role, "content": msg.content])
            }
        }

        var requestBody: [String: Any] = [
            "model": model,
            "messages": messages,
            "stream": true,
            "temperature": request.temperature
        ]
        if let maxTokens = request.maxTokens {
            requestBody["max_tokens"] = maxTokens
        }

        guard let url = URL(string: baseURL),
              let bodyData = try? JSONSerialization.data(withJSONObject: requestBody) else {
            onError(LLMProviderError.invalidRequest)
            return
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = bodyData

        do {
            let (bytes, response) = try await URLSession.shared.bytes(for: urlRequest)

            guard let httpResponse = response as? HTTPURLResponse else {
                onError(LLMProviderError.invalidRequest)
                return
            }

            if httpResponse.statusCode != 200 {
                // Collect error body for better error messages
                var errorBody = ""
                for try await line in bytes.lines {
                    errorBody += line
                }

                var errorMessage = "API request failed"
                if let data = errorBody.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let error = json["error"] as? [String: Any],
                   let message = error["message"] as? String {
                    errorMessage = message
                } else if !errorBody.isEmpty {
                    errorMessage = errorBody
                }
                onError(LLMProviderError.apiError(httpResponse.statusCode, errorMessage))
                return
            }

            for try await line in bytes.lines {
                if line.hasPrefix("data: ") {
                    let jsonString = String(line.dropFirst(6))

                    if jsonString == "[DONE]" {
                        await MainActor.run { onComplete() }
                        return
                    }

                    if let jsonData = jsonString.data(using: .utf8),
                       let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
                       let choices = json["choices"] as? [[String: Any]],
                       let delta = choices.first?["delta"] as? [String: Any],
                       let content = delta["content"] as? String {
                        await MainActor.run { onChunk(content) }
                    }
                }
            }

            await MainActor.run { onComplete() }

        } catch {
            await MainActor.run { onError(error) }
        }
    }


    /// Search with streaming response (convenience wrapper around stream)
    func search(
        query: String,
        onChunk: @escaping (String) -> Void,
        onComplete: @escaping () -> Void,
        onError: @escaping (Error) -> Void
    ) async {
        let request = LLMRequest(
            systemPrompt: Prompts.search,
            textMessages: [(role: "user", content: query)],
            temperature: 0.2,
            maxTokens: 1024
        )
        await stream(request: request, onChunk: onChunk, onComplete: onComplete, onError: onError)
    }
}
