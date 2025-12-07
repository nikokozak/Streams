import Foundation

/// Handles migration of existing sources to the RAG pipeline
/// Processes sources that don't have embeddings yet
final class RAGMigrationService {
    private let persistence: PersistenceService
    private let sourceService: SourceService

    init(persistence: PersistenceService, sourceService: SourceService) {
        self.persistence = persistence
        self.sourceService = sourceService
    }

    /// Process all sources that don't have embeddings
    /// Should be called on app launch after a delay
    func migrateExistingSources() async {
        do {
            let sources = try persistence.loadSourcesNeedingEmbedding()

            guard !sources.isEmpty else {
                print("RAGMigration: No sources need embedding")
                return
            }

            print("RAGMigration: Found \(sources.count) sources to process")

            for source in sources {
                // Skip sources without extracted text
                guard source.extractedText != nil else {
                    print("RAGMigration: Skipping \(source.displayName) - no extracted text")
                    continue
                }

                print("RAGMigration: Processing \(source.displayName)...")
                await sourceService.processSourceForRAG(source: source)

                // Small delay between sources to avoid overwhelming the API
                try? await Task.sleep(nanoseconds: 500_000_000)  // 0.5 second
            }

            print("RAGMigration: Migration complete")
        } catch {
            print("RAGMigration: Failed to load sources - \(error)")
        }
    }
}
