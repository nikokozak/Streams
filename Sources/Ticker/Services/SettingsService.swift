import Foundation

/// UserDefaults-backed settings storage
final class SettingsService {
    static let shared = SettingsService()

    private let defaults: UserDefaults

    private enum Keys {
        static let openaiAPIKey = "openai_api_key"
        static let perplexityAPIKey = "perplexity_api_key"
        static let smartRoutingEnabled = "smart_routing_enabled"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    // MARK: - API Keys

    var openaiAPIKey: String? {
        get { defaults.string(forKey: Keys.openaiAPIKey) }
        set { defaults.set(newValue, forKey: Keys.openaiAPIKey) }
    }

    var perplexityAPIKey: String? {
        get { defaults.string(forKey: Keys.perplexityAPIKey) }
        set { defaults.set(newValue, forKey: Keys.perplexityAPIKey) }
    }

    /// Check if the OpenAI API key is configured
    var isAPIKeyConfigured: Bool {
        guard let key = openaiAPIKey else { return false }
        return !key.isEmpty
    }

    /// Check if the Perplexity API key is configured
    var isPerplexityConfigured: Bool {
        guard let key = perplexityAPIKey else { return false }
        return !key.isEmpty
    }

    // MARK: - Routing Settings

    var smartRoutingEnabled: Bool {
        get { defaults.bool(forKey: Keys.smartRoutingEnabled) }
        set { defaults.set(newValue, forKey: Keys.smartRoutingEnabled) }
    }

    // MARK: - Settings Dictionary (for bridge)

    /// Get all settings as a dictionary for sending to React
    func allSettings() -> [String: Any] {
        var settings: [String: Any] = [
            "hasOpenAIKey": isAPIKeyConfigured,
            "hasPerplexityKey": isPerplexityConfigured,
            "smartRoutingEnabled": smartRoutingEnabled
        ]

        // Include masked key preview if set
        if let key = openaiAPIKey, !key.isEmpty {
            settings["openaiKeyPreview"] = maskAPIKey(key)
        }
        if let key = perplexityAPIKey, !key.isEmpty {
            settings["perplexityKeyPreview"] = maskAPIKey(key)
        }

        return settings
    }

    /// Mask an API key for display (show first 7 and last 4 chars)
    private func maskAPIKey(_ key: String) -> String {
        guard key.count > 12 else { return "••••••••" }
        let prefix = String(key.prefix(7))
        let suffix = String(key.suffix(4))
        return "\(prefix)••••••••\(suffix)"
    }
}
