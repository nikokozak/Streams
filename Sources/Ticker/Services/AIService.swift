import Foundation

/// Handles AI interactions with OpenAI API
final class AIService {
    private let settings: SettingsService
    private let baseURL = "https://api.openai.com/v1/chat/completions"
    private let model = "gpt-4o-mini"

    init(settings: SettingsService = .shared) {
        self.settings = settings
    }

    /// Get API key from settings or environment
    private var apiKey: String? {
        settings.openaiAPIKey ?? ProcessInfo.processInfo.environment["OPENAI_API_KEY"]
    }

    var isConfigured: Bool {
        guard let key = apiKey else { return false }
        return !key.isEmpty
    }

    // MARK: - System Prompts

    private let thinkingPartnerPrompt = """
    You are a thoughtful thinking partner helping someone work through ideas and documents.

    Your role:
    - Engage with their thinking, not just answer questions
    - Build on what they've written, connecting ideas
    - When they have source documents, ground your responses in that material
    - Be concise but substantive—this is a working session, not an essay
    - If they ask a question, answer it directly first, then expand if helpful
    - If they share a thought, engage with it—agree, push back, extend, or question

    You have access to:
    1. Their current thought (what they just wrote)
    2. Prior cells in this session (their thinking so far)
    3. Source documents they've attached (if any)

    Respond naturally, as a knowledgeable colleague would.
    """

    private let restatementPrompt = """
    Convert the user's input into a brief heading or title form, suitable for a reference document.

    Rules:
    - Transform questions into declarative topic headings (e.g., "What is the GDP of Chile?" → "GDP of Chile")
    - Keep the original words and sentiment as much as possible
    - Remove question words (what, how, why, etc.) and rephrase minimally
    - If the input is already a statement, topic, or command that works as a heading, return it unchanged or with minimal cleanup
    - If no restatement is needed (already a good heading), return exactly: NONE
    - Return ONLY the heading text, nothing else—no quotes, no explanation
    - Keep it concise: ideally under 8 words

    Examples:
    - "What's the GDP of Chile?" → "GDP of Chile"
    - "How does photosynthesis work?" → "How photosynthesis works"
    - "Tell me about the French Revolution" → "The French Revolution"
    - "Summarize the key points" → "Key points summary"
    - "React hooks" → "NONE"
    - "The problem with current approach" → "NONE"
    """

    // MARK: - Restatement

    /// Generate a heading/title form of the user's input (non-streaming)
    func generateRestatement(
        for input: String,
        completion: @escaping (String?) -> Void
    ) {
        guard let apiKey else {
            completion(nil)
            return
        }

        let messages: [[String: String]] = [
            ["role": "system", "content": restatementPrompt],
            ["role": "user", "content": input]
        ]

        let requestBody: [String: Any] = [
            "model": model,
            "messages": messages,
            "max_tokens": 50,
            "temperature": 0.3
        ]

        guard let url = URL(string: baseURL),
              let bodyData = try? JSONSerialization.data(withJSONObject: requestBody) else {
            completion(nil)
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = bodyData

        URLSession.shared.dataTask(with: request) { data, response, error in
            guard let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let choices = json["choices"] as? [[String: Any]],
                  let message = choices.first?["message"] as? [String: Any],
                  let content = message["content"] as? String else {
                DispatchQueue.main.async { completion(nil) }
                return
            }

            let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
            let result = (trimmed == "NONE" || trimmed.isEmpty) ? nil : trimmed

            DispatchQueue.main.async { completion(result) }
        }.resume()
    }

    // MARK: - Think

    /// Think with AI using full session context
    func think(
        currentCell: String,
        priorCells: [[String: String]],
        sourceContext: String?,
        onChunk: @escaping (String) -> Void,
        onComplete: @escaping () -> Void,
        onError: @escaping (Error) -> Void
    ) {
        guard let apiKey else {
            onError(AIError.notConfigured)
            return
        }

        // Build messages
        var messages: [[String: String]] = [
            ["role": "system", "content": thinkingPartnerPrompt]
        ]

        // Add source context if available
        if let context = sourceContext, !context.isEmpty {
            messages.append([
                "role": "system",
                "content": "Reference documents:\n\n\(context)"
            ])
        }

        // Add prior cells as conversation history
        for cell in priorCells.dropLast() {
            let role = cell["type"] == "aiResponse" ? "assistant" : "user"
            if let content = cell["content"], !content.isEmpty {
                messages.append(["role": role, "content": content])
            }
        }

        // Add current cell as the latest user message
        messages.append(["role": "user", "content": currentCell])

        // Build request
        let requestBody: [String: Any] = [
            "model": model,
            "messages": messages,
            "stream": true,
            "max_tokens": 2048
        ]

        guard let url = URL(string: baseURL),
              let bodyData = try? JSONSerialization.data(withJSONObject: requestBody) else {
            onError(AIError.invalidRequest)
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = bodyData

        let delegate = StreamingDelegate(onChunk: onChunk, onComplete: onComplete, onError: onError)
        let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: .main)
        let task = session.dataTask(with: request)
        task.resume()
    }
}

// MARK: - Streaming Delegate

private class StreamingDelegate: NSObject, URLSessionDataDelegate {
    private let onChunk: (String) -> Void
    private let onComplete: () -> Void
    private let onError: (Error) -> Void
    private var buffer = ""

    init(
        onChunk: @escaping (String) -> Void,
        onComplete: @escaping () -> Void,
        onError: @escaping (Error) -> Void
    ) {
        self.onChunk = onChunk
        self.onComplete = onComplete
        self.onError = onError
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }

        buffer += text

        while let newlineIndex = buffer.firstIndex(of: "\n") {
            let line = String(buffer[..<newlineIndex])
            buffer = String(buffer[buffer.index(after: newlineIndex)...])

            if line.hasPrefix("data: ") {
                let jsonString = String(line.dropFirst(6))
                if jsonString == "[DONE]" {
                    onComplete()
                    return
                }

                if let jsonData = jsonString.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
                   let choices = json["choices"] as? [[String: Any]],
                   let delta = choices.first?["delta"] as? [String: Any],
                   let content = delta["content"] as? String {
                    onChunk(content)
                }
            }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            onError(error)
        } else {
            onComplete()
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode != 200 {
            onError(AIError.apiError(httpResponse.statusCode, "API request failed"))
            completionHandler(.cancel)
        } else {
            completionHandler(.allow)
        }
    }
}

// MARK: - Errors

enum AIError: LocalizedError {
    case notConfigured
    case invalidRequest
    case invalidResponse
    case apiError(Int, String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "OpenAI API key not configured. Go to Settings to add your key."
        case .invalidRequest:
            return "Failed to build API request"
        case .invalidResponse:
            return "Invalid response from API"
        case .apiError(let code, let message):
            return "API error (\(code)): \(message)"
        }
    }
}
