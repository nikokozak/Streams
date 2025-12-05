import Foundation

/// Handles AI interactions with OpenAI API
final class AIService {
    private let apiKey: String?
    private let baseURL = "https://api.openai.com/v1/chat/completions"
    private let model = "gpt-4o-mini"

    init() {
        // Try to get API key from environment or UserDefaults
        self.apiKey = ProcessInfo.processInfo.environment["OPENAI_API_KEY"]
            ?? UserDefaults.standard.string(forKey: "openai_api_key")
    }

    var isConfigured: Bool {
        apiKey != nil && !apiKey!.isEmpty
    }

    // MARK: - Actions

    enum Action: String, CaseIterable {
        case summarize = "summarize"
        case expand = "expand"
        case rewrite = "rewrite"
        case ask = "ask"
        case extract = "extract"

        var displayName: String {
            switch self {
            case .summarize: return "Summarize"
            case .expand: return "Expand"
            case .rewrite: return "Rewrite"
            case .ask: return "Ask"
            case .extract: return "Extract key points"
            }
        }

        var systemPrompt: String {
            switch self {
            case .summarize:
                return "You are a helpful assistant. Summarize the provided content concisely while preserving key information."
            case .expand:
                return "You are a helpful assistant. Expand on the provided content with more detail, examples, or explanation."
            case .rewrite:
                return "You are a helpful assistant. Rewrite the provided content to be clearer and more polished while preserving the meaning."
            case .ask:
                return "You are a helpful assistant. Answer questions based on the provided context."
            case .extract:
                return "You are a helpful assistant. Extract and list the key points, facts, or insights from the provided content."
            }
        }
    }

    // MARK: - Streaming Execution

    /// Execute an AI action with streaming response
    func execute(
        action: Action,
        userContent: String,
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
            ["role": "system", "content": action.systemPrompt]
        ]

        // Add source context if available
        if let context = sourceContext, !context.isEmpty {
            messages.append([
                "role": "system",
                "content": "Here is the reference material:\n\n\(context)"
            ])
        }

        messages.append(["role": "user", "content": userContent])

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

        // Stream response
        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                DispatchQueue.main.async { onError(error) }
                return
            }

            guard let data,
                  let httpResponse = response as? HTTPURLResponse else {
                DispatchQueue.main.async { onError(AIError.invalidResponse) }
                return
            }

            if httpResponse.statusCode != 200 {
                let errorMessage = String(data: data, encoding: .utf8) ?? "Unknown error"
                DispatchQueue.main.async { onError(AIError.apiError(httpResponse.statusCode, errorMessage)) }
                return
            }

            // Parse SSE stream
            self.parseSSEStream(data: data, onChunk: onChunk, onComplete: onComplete)
        }
        task.resume()
    }

    private func parseSSEStream(
        data: Data,
        onChunk: @escaping (String) -> Void,
        onComplete: @escaping () -> Void
    ) {
        guard let text = String(data: data, encoding: .utf8) else {
            DispatchQueue.main.async { onComplete() }
            return
        }

        let lines = text.components(separatedBy: "\n")
        for line in lines {
            if line.hasPrefix("data: ") {
                let jsonString = String(line.dropFirst(6))
                if jsonString == "[DONE]" {
                    DispatchQueue.main.async { onComplete() }
                    return
                }

                if let jsonData = jsonString.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
                   let choices = json["choices"] as? [[String: Any]],
                   let delta = choices.first?["delta"] as? [String: Any],
                   let content = delta["content"] as? String {
                    DispatchQueue.main.async { onChunk(content) }
                }
            }
        }

        DispatchQueue.main.async { onComplete() }
    }

    // MARK: - Real Streaming with URLSession delegate

    func executeStreaming(
        action: Action,
        userContent: String,
        sourceContext: String?,
        onChunk: @escaping (String) -> Void,
        onComplete: @escaping () -> Void,
        onError: @escaping (Error) -> Void
    ) {
        guard let apiKey else {
            onError(AIError.notConfigured)
            return
        }

        var messages: [[String: String]] = [
            ["role": "system", "content": action.systemPrompt]
        ]

        if let context = sourceContext, !context.isEmpty {
            messages.append([
                "role": "system",
                "content": "Here is the reference material:\n\n\(context)"
            ])
        }

        messages.append(["role": "user", "content": userContent])

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

        // Process complete lines
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
            return "OpenAI API key not configured. Set OPENAI_API_KEY environment variable."
        case .invalidRequest:
            return "Failed to build API request"
        case .invalidResponse:
            return "Invalid response from API"
        case .apiError(let code, let message):
            return "API error (\(code)): \(message)"
        }
    }
}
