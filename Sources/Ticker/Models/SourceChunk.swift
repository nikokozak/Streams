import Foundation

/// A chunk of text from a source document for RAG retrieval
struct SourceChunk: Identifiable, Codable {
    let id: UUID
    let sourceId: UUID
    var chunkIndex: Int
    var content: String
    var tokenCount: Int
    var pageStart: Int?
    var pageEnd: Int?
    var embeddingStatus: EmbeddingStatus
    let createdAt: Date

    init(
        id: UUID = UUID(),
        sourceId: UUID,
        chunkIndex: Int,
        content: String,
        tokenCount: Int,
        pageStart: Int? = nil,
        pageEnd: Int? = nil,
        embeddingStatus: EmbeddingStatus = .pending,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.sourceId = sourceId
        self.chunkIndex = chunkIndex
        self.content = content
        self.tokenCount = tokenCount
        self.pageStart = pageStart
        self.pageEnd = pageEnd
        self.embeddingStatus = embeddingStatus
        self.createdAt = createdAt
    }
}

/// Status of embedding generation for a chunk
enum EmbeddingStatus: String, Codable {
    case pending
    case processing
    case complete
    case failed
}

/// A retrieved chunk with relevance score for RAG queries
struct RetrievedChunk {
    let chunk: SourceChunk
    let sourceName: String
    let similarity: Float
}
