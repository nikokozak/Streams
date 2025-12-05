import Foundation

/// A unit of content within a stream
struct Cell: Identifiable, Codable {
    let id: UUID
    let streamId: UUID
    var content: String
    /// Display title/heading form of content (for text cells that were sent to AI)
    var restatement: String?
    var type: CellType
    var sourceBinding: SourceBinding?
    var order: Int
    let createdAt: Date
    var updatedAt: Date

    init(
        id: UUID = UUID(),
        streamId: UUID,
        content: String,
        restatement: String? = nil,
        type: CellType = .text,
        sourceBinding: SourceBinding? = nil,
        order: Int = 0,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.streamId = streamId
        self.content = content
        self.restatement = restatement
        self.type = type
        self.sourceBinding = sourceBinding
        self.order = order
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// The type of cell content
enum CellType: String, Codable {
    case text        // User-written content
    case aiResponse  // AI-generated response
    case quote       // Excerpt from a source
}
