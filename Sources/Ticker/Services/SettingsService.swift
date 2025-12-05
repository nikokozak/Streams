import Foundation

/// UserDefaults-backed settings storage
final class SettingsService {
    static let shared = SettingsService()

    private let defaults: UserDefaults

    private enum Keys {
        static let openaiAPIKey = "openai_api_key"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    // MARK: - API Keys

    var openaiAPIKey: String? {
        get { defaults.string(forKey: Keys.openaiAPIKey) }
        set { defaults.set(newValue, forKey: Keys.openaiAPIKey) }
    }

    /// Check if the API key is configured
    var isAPIKeyConfigured: Bool {
        guard let key = openaiAPIKey else { return false }
        return !key.isEmpty
    }

    // MARK: - Settings Dictionary (for bridge)

    /// Get all settings as a dictionary for sending to React
    func allSettings() -> [String: Any] {
        var settings: [String: Any] = [
            "hasOpenAIKey": isAPIKeyConfigured
        ]

        // Include masked key preview if set
        if let key = openaiAPIKey, !key.isEmpty {
            settings["openaiKeyPreview"] = maskAPIKey(key)
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
