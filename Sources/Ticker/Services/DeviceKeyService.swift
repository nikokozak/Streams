import Foundation

// MARK: - Auth State

/// Proxy authentication state machine
enum ProxyAuthState: String, Codable {
    case unregistered           // No key entered
    case validating             // Currently validating key with server
    case active                 // Key validated successfully
    case blockedInvalid         // Key invalid or expired
    case blockedRevoked         // Key revoked by admin
    case blockedBoundElsewhere  // Key bound to different device
    case degradedOffline        // Network unavailable, cached key present

    var isUsable: Bool {
        switch self {
        case .active, .degradedOffline:
            return true
        default:
            return false
        }
    }

    var requiresGate: Bool {
        switch self {
        case .active, .degradedOffline:
            return false
        default:
            return true
        }
    }
}

// MARK: - Response Types

/// Response from proxy `/v1/auth/validate` endpoint
struct ProxyAuthValidationResponse: Codable {
    let supportId: String
    let boundDeviceId: String?
    let limits: Limits?
    let usage: Usage?

    struct Limits: Codable {
        let reqsPerMin: Int?
        let tokensPerDay: Int?
        let tokensPerMonth: Int?

        enum CodingKeys: String, CodingKey {
            case reqsPerMin = "reqs_per_min"
            case tokensPerDay = "tokens_per_day"
            case tokensPerMonth = "tokens_per_month"
        }
    }

    struct Usage: Codable {
        let reqsThisMinute: Int?
        let tokensToday: Int?
        let tokensThisMonth: Int?
        let dayResetAt: String?
        let monthResetAt: String?

        enum CodingKeys: String, CodingKey {
            case reqsThisMinute = "reqs_this_minute"
            case tokensToday = "tokens_today"
            case tokensThisMonth = "tokens_this_month"
            case dayResetAt = "day_reset_at"
            case monthResetAt = "month_reset_at"
        }
    }

    enum CodingKeys: String, CodingKey {
        case supportId = "support_id"
        case boundDeviceId = "bound_device_id"
        case limits, usage
    }
}

/// Proxy error response structure
struct ProxyErrorResponse: Codable {
    let error: ErrorDetail

    struct ErrorDetail: Codable {
        let code: String
        let message: String
    }
}

// MARK: - Stored Data

/// Stored device data (non-sensitive fields can be cached to disk)
struct DeviceKeyData: Codable {
    var deviceId: String
    var deviceKey: String?
    var supportId: String?
    var validatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case deviceId = "device_id"
        case deviceKey = "device_key"
        case supportId = "support_id"
        case validatedAt = "validated_at"
    }
}

// MARK: - Errors

/// Proxy error codes (from proxy API)
enum ProxyErrorCode: String {
    case invalidKey = "invalid_key"
    case keyRevoked = "key_revoked"
    case keyBoundElsewhere = "key_bound_elsewhere"
    case rateLimited = "rate_limited"
    case unknown

    init(rawValue: String) {
        switch rawValue {
        case "invalid_key": self = .invalidKey
        case "key_revoked": self = .keyRevoked
        case "key_bound_elsewhere": self = .keyBoundElsewhere
        case "rate_limited": self = .rateLimited
        default: self = .unknown
        }
    }
}

/// Errors from device key operations
enum DeviceKeyError: LocalizedError {
    case invalidURL
    case invalidResponse
    case invalidKey
    case keyRevoked
    case boundToOtherDevice
    case rateLimited
    case serverError(Int)
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid proxy URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .invalidKey:
            return "Invalid or expired device key"
        case .keyRevoked:
            return "This device key has been revoked. Contact support for assistance."
        case .boundToOtherDevice:
            return "This key is bound to a different device. Contact support for assistance."
        case .rateLimited:
            return "Too many requests. Please try again in a minute."
        case .serverError(let code):
            return "Server error (\(code)). Please try again later."
        case .networkError:
            return "Unable to reach server. Check your internet connection."
        }
    }

    /// Maps error to auth state, or nil for non-auth-fatal errors (like rate limiting)
    var authState: ProxyAuthState? {
        switch self {
        case .invalidKey: return .blockedInvalid
        case .keyRevoked: return .blockedRevoked
        case .boundToOtherDevice: return .blockedBoundElsewhere
        case .networkError: return .degradedOffline
        case .rateLimited, .serverError, .invalidURL, .invalidResponse:
            // These are transient/non-auth errors - don't change auth state
            return nil
        }
    }
}

// MARK: - Service

/// Manages device key storage and validation against Ticker-Proxy
actor DeviceKeyService {
    static let shared = DeviceKeyService()

    // MARK: - State

    private var cachedData: DeviceKeyData?
    private(set) var currentState: ProxyAuthState = .unregistered

    /// Cached limits from last validation
    private var cachedLimits: ProxyAuthValidationResponse.Limits?
    /// Cached usage from last validation
    private var cachedUsage: ProxyAuthValidationResponse.Usage?

    /// Callback invoked when auth state changes (called on MainActor)
    /// Note: nonisolated to allow setting from outside actor context
    nonisolated(unsafe) var onStateChange: ((ProxyAuthState) -> Void)?

    // MARK: - Configuration

    /// Proxy base URL - can be overridden via TICKER_PROXY_URL env var or UserDefaults
    private var proxyBaseURL: String {
        // Check environment variable first (for debugging)
        if let envURL = ProcessInfo.processInfo.environment["TICKER_PROXY_URL"], !envURL.isEmpty {
            return envURL
        }
        // Check UserDefaults (for dev builds)
        if let defaultsURL = UserDefaults.standard.string(forKey: "TickerProxyURL"), !defaultsURL.isEmpty {
            return defaultsURL
        }
        // Production default
        return "https://ticker-proxy.fly.dev"
    }

    private var fileURL: URL {
        let fileManager = FileManager.default
        let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support", isDirectory: true)
        let tickerDir = appSupport.appendingPathComponent("Ticker", isDirectory: true)
        return tickerDir.appendingPathComponent("device.json")
    }

    // MARK: - Initialization

    /// Initialize and determine initial state based on stored data
    func initialize() async {
        let data = loadOrCreate()

        if data.deviceKey != nil {
            // Have a cached key - need to validate with server
            await revalidate()
        } else {
            await setState(.unregistered)
        }
    }

    // MARK: - State Management

    private func setState(_ newState: ProxyAuthState) async {
        guard newState != currentState else { return }
        currentState = newState

        // Notify on main actor
        await MainActor.run {
            onStateChange?(newState)
        }
    }

    // MARK: - Public API (canonical bridge names)

    /// Load current proxy auth state - returns state + support_id if available
    func loadProxyAuth() -> (state: ProxyAuthState, supportId: String?, deviceId: String) {
        let data = loadOrCreate()
        return (
            state: currentState,
            supportId: data.supportId,
            deviceId: data.deviceId
        )
    }

    /// Get cached limits and usage from last validation
    func getLimitsAndUsage() -> (limits: ProxyAuthValidationResponse.Limits?, usage: ProxyAuthValidationResponse.Usage?) {
        return (limits: cachedLimits, usage: cachedUsage)
    }

    /// Set and validate a device key
    func setProxyDeviceKey(_ key: String) async throws -> ProxyAuthValidationResponse {
        await setState(.validating)

        do {
            let response = try await validateWithServer(key: key)

            // Store validated key
            var data = loadOrCreate()
            data.deviceKey = key
            data.supportId = response.supportId
            data.validatedAt = Date()
            save(data)

            // Cache limits and usage
            cachedLimits = response.limits
            cachedUsage = response.usage

            await setState(.active)
            return response

        } catch let error as DeviceKeyError {
            // For first-time key entry:
            // - Network errors: stay unregistered (no cached key to fall back on)
            // - Rate limit/transient errors: stay unregistered, let user retry
            // - Auth errors (invalid/revoked/bound): transition to blocked state
            if let newState = error.authState {
                // Only network errors can go to degradedOffline, but not during first entry
                if case .networkError = error {
                    await setState(.unregistered)
                } else {
                    await setState(newState)
                }
            } else {
                // Transient error (rate limit, server error) - stay unregistered
                await setState(.unregistered)
            }
            throw error
        } catch {
            await setState(.blockedInvalid)
            throw error
        }
    }

    /// Clear stored key
    func clearProxyDeviceKey() async {
        var data = loadOrCreate()
        data.deviceKey = nil
        data.supportId = nil
        data.validatedAt = nil
        save(data)
        await setState(.unregistered)
    }

    /// Re-validate cached key with server (called on startup or when needed)
    func revalidate() async {
        let data = loadOrCreate()
        guard let key = data.deviceKey else {
            await setState(.unregistered)
            return
        }

        await setState(.validating)

        do {
            let response = try await validateWithServer(key: key)

            // Update cached data
            var updatedData = data
            updatedData.supportId = response.supportId
            updatedData.validatedAt = Date()
            save(updatedData)

            // Cache limits and usage
            cachedLimits = response.limits
            cachedUsage = response.usage

            await setState(.active)

        } catch let error as DeviceKeyError {
            // Handle based on error type:
            // - Network error: degraded offline (cached key still usable)
            // - Auth errors (invalid/revoked/bound): clear key, transition to blocked
            // - Transient errors (rate limit, server error): stay active if already active
            if let newState = error.authState {
                if case .degradedOffline = newState {
                    // Network error - allow degraded mode
                    await setState(.degradedOffline)
                } else {
                    // Auth error - key is invalid/revoked/bound elsewhere, clear it
                    await clearProxyDeviceKey()
                    await setState(newState)
                }
            } else {
                // Transient error (rate limit, server error) - keep current state
                // If we were validating from active, go back to active
                // If we were validating from unregistered, stay unregistered
                // For simplicity, just go back to active since we have a cached key
                await setState(.active)
            }
        } catch {
            await setState(.blockedInvalid)
        }
    }

    /// Get credentials for proxy requests (used by other services)
    func getCredentials() -> (deviceId: String, deviceKey: String)? {
        guard currentState.isUsable else { return nil }
        let data = loadOrCreate()
        guard let key = data.deviceKey else { return nil }
        return (data.deviceId, key)
    }

    /// Get required headers for proxy requests
    func getProxyHeaders() -> [String: String]? {
        guard let credentials = getCredentials() else { return nil }
        return [
            "Authorization": "Bearer \(credentials.deviceKey)",
            "X-Ticker-Device-Id": credentials.deviceId,
            "X-Ticker-App-Version": appVersion(),
            "X-Ticker-Platform": "macOS",
            "X-Ticker-OS-Version": osVersion()
        ]
    }

    // MARK: - Private Implementation

    /// Load existing data or create new with fresh device_id
    private func loadOrCreate() -> DeviceKeyData {
        if let cached = cachedData {
            return cached
        }

        let fileManager = FileManager.default

        // Ensure directory exists
        let dir = fileURL.deletingLastPathComponent()
        try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)

        // Try to load existing
        if let data = try? Data(contentsOf: fileURL) {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            if let decoded = try? decoder.decode(DeviceKeyData.self, from: data) {
                cachedData = decoded
                return decoded
            }
        }

        // Create new with fresh device_id
        let newData = DeviceKeyData(
            deviceId: UUID().uuidString,
            deviceKey: nil,
            supportId: nil,
            validatedAt: nil
        )
        save(newData)
        return newData
    }

    /// Save device data to disk atomically
    private func save(_ data: DeviceKeyData) {
        cachedData = data
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = .prettyPrinted

        guard let encoded = try? encoder.encode(data) else { return }

        // Write atomically to avoid corruption on crash
        let tempURL = fileURL.appendingPathExtension("tmp")
        do {
            try encoded.write(to: tempURL, options: .atomic)
            try FileManager.default.moveItem(at: tempURL, to: fileURL)
        } catch {
            // Fallback: try direct write
            try? encoded.write(to: fileURL, options: .atomic)
        }
    }

    /// Validate key with server
    private func validateWithServer(key: String) async throws -> ProxyAuthValidationResponse {
        let data = loadOrCreate()

        guard let url = URL(string: "\(proxyBaseURL)/v1/auth/validate") else {
            throw DeviceKeyError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue(data.deviceId, forHTTPHeaderField: "X-Ticker-Device-Id")
        request.setValue(appVersion(), forHTTPHeaderField: "X-Ticker-App-Version")
        request.setValue("macOS", forHTTPHeaderField: "X-Ticker-Platform")
        request.setValue(osVersion(), forHTTPHeaderField: "X-Ticker-OS-Version")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Ticker-Request-Id")

        let responseData: Data
        let response: URLResponse
        do {
            (responseData, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw DeviceKeyError.networkError(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw DeviceKeyError.invalidResponse
        }

        switch httpResponse.statusCode {
        case 200:
            let decoder = JSONDecoder()
            let validation = try decoder.decode(ProxyAuthValidationResponse.self, from: responseData)

            // Check if bound to different device
            if let boundDeviceId = validation.boundDeviceId, boundDeviceId != data.deviceId {
                throw DeviceKeyError.boundToOtherDevice
            }

            return validation

        case 401:
            // Parse structured error code
            if let errorResponse = try? JSONDecoder().decode(ProxyErrorResponse.self, from: responseData) {
                switch ProxyErrorCode(rawValue: errorResponse.error.code) {
                case .keyRevoked:
                    throw DeviceKeyError.keyRevoked
                case .keyBoundElsewhere:
                    throw DeviceKeyError.boundToOtherDevice
                default:
                    throw DeviceKeyError.invalidKey
                }
            }
            throw DeviceKeyError.invalidKey

        case 429:
            throw DeviceKeyError.rateLimited

        default:
            throw DeviceKeyError.serverError(httpResponse.statusCode)
        }
    }

    // MARK: - Helpers

    private func appVersion() -> String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
    }

    private func osVersion() -> String {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        return "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
    }
}
