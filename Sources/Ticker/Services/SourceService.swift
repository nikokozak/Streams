import Foundation
import PDFKit

/// Manages file sources: bookmarks, access, text extraction, and RAG processing
final class SourceService {
    private let persistence: PersistenceService
    private let chunkingService: ChunkingService
    private let embeddingService: EmbeddingService

    init(
        persistence: PersistenceService,
        chunkingService: ChunkingService = ChunkingService(),
        embeddingService: EmbeddingService = EmbeddingService()
    ) {
        self.persistence = persistence
        self.chunkingService = chunkingService
        self.embeddingService = embeddingService
    }

    // MARK: - Bookmark Creation

    /// Create a source from a file URL, generating a security-scoped bookmark
    func createSource(from url: URL, for streamId: UUID) throws -> SourceReference {
        guard let fileType = SourceFileType(from: url) else {
            throw SourceError.unsupportedFileType(url.pathExtension)
        }

        // Create security-scoped bookmark
        let bookmarkData = try url.bookmarkData(
            options: [.withSecurityScope],
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )

        let source = SourceReference(
            streamId: streamId,
            displayName: url.lastPathComponent,
            fileType: fileType,
            bookmarkData: bookmarkData,
            status: .pending
        )

        // Save to database
        try persistence.saveSource(source)

        return source
    }

    // MARK: - File Access

    /// Resolve bookmark and access the file. Returns the accessible URL.
    /// Caller is responsible for calling `stopAccessingSecurityScopedResource()`.
    func accessFile(_ source: SourceReference) throws -> URL {
        var isStale = false
        let url = try URL(
            resolvingBookmarkData: source.bookmarkData,
            options: [.withSecurityScope],
            relativeTo: nil,
            bookmarkDataIsStale: &isStale
        )

        if isStale {
            // Bookmark is stale - mark source and try to refresh
            var updated = source
            updated.status = .stale
            try? persistence.saveSource(updated)
        }

        guard url.startAccessingSecurityScopedResource() else {
            throw SourceError.accessDenied(source.displayName)
        }

        return url
    }

    /// Check if a source is still accessible
    func checkStatus(_ source: SourceReference) -> SourceStatus {
        do {
            var isStale = false
            let url = try URL(
                resolvingBookmarkData: source.bookmarkData,
                options: [.withSecurityScope],
                relativeTo: nil,
                bookmarkDataIsStale: &isStale
            )

            if isStale {
                return .stale
            }

            // Try to access
            if url.startAccessingSecurityScopedResource() {
                url.stopAccessingSecurityScopedResource()
                return source.extractedText != nil ? .ready : .pending
            } else {
                return .stale
            }
        } catch {
            return .error
        }
    }

    // MARK: - Text Extraction

    /// Extract text from a source file
    func extractText(from source: SourceReference) throws -> (text: String, pageCount: Int?) {
        let url = try accessFile(source)
        defer { url.stopAccessingSecurityScopedResource() }

        switch source.fileType {
        case .pdf:
            return try extractPDFText(from: url)
        case .text, .markdown:
            let text = try String(contentsOf: url, encoding: .utf8)
            return (text, nil)
        case .image:
            // Images don't have extractable text (could add OCR later)
            return ("", nil)
        }
    }

    private func extractPDFText(from url: URL) throws -> (text: String, pageCount: Int?) {
        guard let document = PDFDocument(url: url) else {
            throw SourceError.extractionFailed("Could not open PDF")
        }

        let pageCount = document.pageCount
        var text = ""

        for i in 0..<pageCount {
            if let page = document.page(at: i),
               let pageText = page.string {
                if !text.isEmpty {
                    text += "\n\n--- Page \(i + 1) ---\n\n"
                }
                text += pageText
            }
        }

        return (text, pageCount)
    }

    // MARK: - Full Processing

    /// Create and process a source: create bookmark, extract text, save, and trigger RAG processing
    func addSource(from url: URL, to streamId: UUID) throws -> SourceReference {
        // Create the source with bookmark
        var source = try createSource(from: url, for: streamId)

        // Extract text
        do {
            let (text, pageCount) = try extractText(from: source)
            source.extractedText = text.isEmpty ? nil : text
            source.pageCount = pageCount
            source.status = .ready
        } catch {
            source.status = .error
            print("Text extraction failed: \(error)")
        }

        // Update in database
        try persistence.saveSource(source)

        // Trigger RAG processing asynchronously if text was extracted
        if source.status == .ready, source.extractedText != nil {
            Task {
                await processSourceForRAG(source: source)
            }
        }

        return source
    }

    // MARK: - RAG Processing

    /// Process a source for RAG: chunk, embed, and store
    func processSourceForRAG(source: SourceReference) async {
        guard let text = source.extractedText, !text.isEmpty else {
            print("RAG: No text to process for \(source.displayName)")
            return
        }

        guard embeddingService.isConfigured else {
            print("RAG: Embedding service not configured, skipping \(source.displayName)")
            return
        }

        do {
            // Mark as processing
            try persistence.updateSourceEmbeddingStatus(source.id, status: "processing")
            print("RAG: Processing \(source.displayName)...")

            // Chunk the document
            let chunks: [SourceChunk]
            if source.fileType == .pdf {
                // Re-access file for page-aware chunking
                do {
                    let url = try accessFile(source)
                    defer { url.stopAccessingSecurityScopedResource() }

                    if let document = PDFDocument(url: url) {
                        chunks = chunkingService.chunkPDF(document: document, sourceId: source.id)
                    } else {
                        chunks = chunkingService.chunkText(text: text, sourceId: source.id)
                    }
                } catch {
                    // Fall back to text-based chunking if file access fails
                    print("RAG: File access failed, using text-based chunking: \(error)")
                    chunks = chunkingService.chunkText(text: text, sourceId: source.id)
                }
            } else {
                chunks = chunkingService.chunkText(text: text, sourceId: source.id)
            }

            guard !chunks.isEmpty else {
                print("RAG: No chunks generated for \(source.displayName)")
                try persistence.updateSourceEmbeddingStatus(source.id, status: "failed")
                return
            }

            print("RAG: Generated \(chunks.count) chunks for \(source.displayName)")

            // Save chunks
            try persistence.saveChunks(chunks)

            // Generate embeddings in batch
            let texts = chunks.map { $0.content }
            let embeddings = try await embeddingService.embedBatch(texts: texts)

            guard embeddings.count == chunks.count else {
                print("RAG: Embedding count mismatch for \(source.displayName)")
                try persistence.updateSourceEmbeddingStatus(source.id, status: "failed")
                return
            }

            // Save embeddings
            for (chunk, embedding) in zip(chunks, embeddings) {
                try persistence.saveEmbedding(
                    chunkId: chunk.id,
                    embedding: embedding,
                    model: "text-embedding-3-small"
                )
            }

            // Mark complete
            try persistence.updateSourceEmbeddingStatus(source.id, status: "complete")
            print("RAG: Completed processing \(source.displayName): \(chunks.count) chunks embedded")

        } catch {
            print("RAG: Processing failed for \(source.displayName): \(error)")
            try? persistence.updateSourceEmbeddingStatus(source.id, status: "failed")
        }
    }

    /// Remove a source
    func removeSource(id: UUID) throws {
        try persistence.deleteSource(id: id)
    }
}

// MARK: - Errors

enum SourceError: LocalizedError {
    case unsupportedFileType(String)
    case accessDenied(String)
    case extractionFailed(String)
    case bookmarkStale(String)

    var errorDescription: String? {
        switch self {
        case .unsupportedFileType(let ext):
            return "Unsupported file type: \(ext)"
        case .accessDenied(let name):
            return "Cannot access file: \(name)"
        case .extractionFailed(let reason):
            return "Text extraction failed: \(reason)"
        case .bookmarkStale(let name):
            return "File has moved or been deleted: \(name)"
        }
    }
}
