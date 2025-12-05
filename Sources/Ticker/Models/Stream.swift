import Foundation

/// A thinking session containing cells and source references
struct Stream: Identifiable, Codable {
    let id: UUID
    var title: String
    var sources: [SourceReference]
    var cells: [Cell]
    let createdAt: Date
    var updatedAt: Date

    init(
        id: UUID = UUID(),
        title: String = "Untitled",
        sources: [SourceReference] = [],
        cells: [Cell] = [],
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.title = title
        self.sources = sources
        self.cells = cells
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// Lightweight summary for list views (no cells loaded)
struct StreamSummary: Identifiable, Codable {
    let id: UUID
    let title: String
    let sourceCount: Int
    let cellCount: Int
    let updatedAt: Date
    let previewText: String?
}
