import Foundation

/// Service for Perplexity API calls (real-time search)
final class PerplexityService {
    private let settings: SettingsService
    private let baseURL = "https://api.perplexity.ai/chat/completions"
    private let model = "sonar"  // Fast, good for search queries

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

    /// System prompt for search queries
    private let searchSystemPrompt = """
    You are providing factual, current information for a research document.

    Style:
    - Lead with the most relevant facts
    - Include specific data, dates, and numbers when available
    - Cite sources naturally within the text
    - Be concise but comprehensive
    - No pleasantries or hedging
    """

    /// Search with streaming response using async/await
    func search(
        query: String,
        onChunk: @escaping (String) -> Void,
        onComplete: @escaping () -> Void,
        onError: @escaping (Error) -> Void
    ) async {
        guard let apiKey else {
            onError(PerplexityError.notConfigured)
            return
        }

        let messages: [[String: String]] = [
            ["role": "system", "content": searchSystemPrompt],
            ["role": "user", "content": query]
        ]

        let requestBody: [String: Any] = [
            "model": model,
            "messages": messages,
            "stream": true,
            "temperature": 0.2,
            "max_tokens": 1024
        ]

        guard let url = URL(string: baseURL),
              let bodyData = try? JSONSerialization.data(withJSONObject: requestBody) else {
            onError(PerplexityError.invalidRequest)
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = bodyData

        do {
            let (bytes, response) = try await URLSession.shared.bytes(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                onError(PerplexityError.invalidRequest)
                return
            }

            if httpResponse.statusCode != 200 {
                onError(PerplexityError.apiError(httpResponse.statusCode, "API request failed"))
                return
            }

            var buffer = ""

            for try await line in bytes.lines {
                buffer = line

                if buffer.hasPrefix("data: ") {
                    let jsonString = String(buffer.dropFirst(6))

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
}

// MARK: - Errors

enum PerplexityError: LocalizedError {
    case notConfigured
    case invalidRequest
    case apiError(Int, String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Perplexity API key not configured. Go to Settings to add your key."
        case .invalidRequest:
            return "Failed to build API request"
        case .apiError(let code, let message):
            return "API error (\(code)): \(message)"
        }
    }
}
