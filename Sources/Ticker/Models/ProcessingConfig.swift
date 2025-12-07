import Foundation

/// Configuration for automatic block processing behavior
struct ProcessingConfig: Codable, Equatable {
    /// When this block should refresh its content
    var refreshTrigger: RefreshTrigger?
    /// Schema for validating AI responses
    var schema: BlockSchema?
    /// Rule for automatic content transformation
    var autoTransform: AutoTransformRule?
}

/// Triggers for automatic block refresh
enum RefreshTrigger: String, Codable {
    /// Refresh when the stream is opened (@live blocks)
    case onStreamOpen
    /// Refresh when a referenced block changes
    case onDependencyChange
    /// Only refresh on explicit user action
    case manual
}

/// Schema for validating and constraining AI responses
struct BlockSchema: Codable, Equatable {
    /// JSON Schema string for validation
    var jsonSchema: String
    /// When the block was last validated against the schema
    var lastValidatedAt: Date?
    /// Whether the current content has drifted from the schema
    var driftDetected: Bool

    init(jsonSchema: String, lastValidatedAt: Date? = nil, driftDetected: Bool = false) {
        self.jsonSchema = jsonSchema
        self.lastValidatedAt = lastValidatedAt
        self.driftDetected = driftDetected
    }
}

/// Rule for automatic content transformation
struct AutoTransformRule: Codable, Equatable {
    /// Condition that triggers the transformation (e.g., "contentLength > 500")
    var condition: String
    /// The transformation to apply (e.g., "summarize")
    var transformation: String

    init(condition: String, transformation: String) {
        self.condition = condition
        self.transformation = transformation
    }
}
