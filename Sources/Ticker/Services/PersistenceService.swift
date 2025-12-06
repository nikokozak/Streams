import Foundation
import GRDB

/// Manages SQLite persistence for streams, cells, and sources
final class PersistenceService {
    private let dbQueue: DatabaseQueue

    init() throws {
        let path = Self.databasePath()
        let directory = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)

        var config = Configuration()
        config.foreignKeysEnabled = true

        dbQueue = try DatabaseQueue(path: path, configuration: config)
        try migrate()
    }

    private static func databasePath() -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "\(home)/.config/ticker/ticker.db"
    }

    // MARK: - Migrations

    private func migrate() throws {
        var migrator = DatabaseMigrator()

        migrator.registerMigration("v1_initial") { db in
            // Streams table
            try db.create(table: "streams") { t in
                t.column("id", .text).primaryKey()
                t.column("title", .text).notNull()
                t.column("created_at", .double).notNull()
                t.column("updated_at", .double).notNull()
            }

            // Sources table
            try db.create(table: "sources") { t in
                t.column("id", .text).primaryKey()
                t.column("stream_id", .text).notNull()
                    .references("streams", onDelete: .cascade)
                t.column("display_name", .text).notNull()
                t.column("file_type", .text).notNull()
                t.column("bookmark_data", .blob).notNull()
                t.column("status", .text).notNull().defaults(to: "available")
                t.column("extracted_text", .text)
                t.column("page_count", .integer)
                t.column("added_at", .double).notNull()
            }
            try db.create(index: "idx_sources_stream", on: "sources", columns: ["stream_id"])

            // Cells table
            try db.create(table: "cells") { t in
                t.column("id", .text).primaryKey()
                t.column("stream_id", .text).notNull()
                    .references("streams", onDelete: .cascade)
                t.column("type", .text).notNull()
                t.column("content", .text).notNull()
                t.column("state", .text).notNull().defaults(to: "idle")
                t.column("source_binding_json", .text)
                t.column("metadata_json", .text).notNull()
                t.column("created_at", .double).notNull()
                t.column("updated_at", .double).notNull()
                t.column("position", .integer).notNull()
            }
            try db.create(index: "idx_cells_stream", on: "cells", columns: ["stream_id"])
            try db.create(index: "idx_cells_position", on: "cells", columns: ["stream_id", "position"])
        }

        migrator.registerMigration("v2_cell_restatement") { db in
            try db.alter(table: "cells") { t in
                t.add(column: "restatement", .text)
            }
        }

        migrator.registerMigration("v3_cell_original_prompt") { db in
            try db.alter(table: "cells") { t in
                t.add(column: "original_prompt", .text)
            }
        }

        try migrator.migrate(dbQueue)
    }

    // MARK: - Stream Operations

    func loadStreamSummaries() throws -> [StreamSummary] {
        try dbQueue.read { db in
            let sql = """
                SELECT
                    s.id, s.title, s.updated_at,
                    (SELECT COUNT(*) FROM sources WHERE stream_id = s.id) as source_count,
                    (SELECT COUNT(*) FROM cells WHERE stream_id = s.id) as cell_count,
                    (SELECT content FROM cells WHERE stream_id = s.id ORDER BY position LIMIT 1) as preview_text
                FROM streams s
                ORDER BY s.updated_at DESC
            """
            return try Row.fetchAll(db, sql: sql).map { row in
                StreamSummary(
                    id: UUID(uuidString: row["id"])!,
                    title: row["title"],
                    sourceCount: row["source_count"],
                    cellCount: row["cell_count"],
                    updatedAt: Date(timeIntervalSince1970: row["updated_at"]),
                    previewText: row["preview_text"]
                )
            }
        }
    }

    func loadStream(id: UUID) throws -> Stream? {
        try dbQueue.read { db in
            guard let streamRow = try Row.fetchOne(db, sql: "SELECT * FROM streams WHERE id = ?", arguments: [id.uuidString]) else {
                return nil
            }

            let sourceRows = try Row.fetchAll(db, sql: "SELECT * FROM sources WHERE stream_id = ? ORDER BY added_at", arguments: [id.uuidString])
            let cellRows = try Row.fetchAll(db, sql: "SELECT * FROM cells WHERE stream_id = ? ORDER BY position", arguments: [id.uuidString])

            let sources = sourceRows.map { row -> SourceReference in
                SourceReference(
                    id: UUID(uuidString: row["id"])!,
                    streamId: UUID(uuidString: row["stream_id"])!,
                    displayName: row["display_name"],
                    fileType: SourceFileType(rawValue: row["file_type"]) ?? .text,
                    bookmarkData: row["bookmark_data"],
                    status: SourceStatus(rawValue: row["status"]) ?? .pending,
                    extractedText: row["extracted_text"],
                    pageCount: row["page_count"],
                    addedAt: Date(timeIntervalSince1970: row["added_at"])
                )
            }

            let cells = try cellRows.map { row -> Cell in
                var sourceBinding: SourceBinding? = nil
                if let bindingJson: String = row["source_binding_json"] {
                    sourceBinding = try JSONDecoder().decode(SourceBinding.self, from: Data(bindingJson.utf8))
                }

                let restatement: String? = row["restatement"]
                let originalPrompt: String? = row["original_prompt"]

                return Cell(
                    id: UUID(uuidString: row["id"])!,
                    streamId: UUID(uuidString: row["stream_id"])!,
                    content: row["content"],
                    restatement: restatement,
                    originalPrompt: originalPrompt,
                    type: CellType(rawValue: row["type"]) ?? .text,
                    sourceBinding: sourceBinding,
                    order: row["position"],
                    createdAt: Date(timeIntervalSince1970: row["created_at"]),
                    updatedAt: Date(timeIntervalSince1970: row["updated_at"])
                )
            }

            return Stream(
                id: UUID(uuidString: streamRow["id"])!,
                title: streamRow["title"],
                sources: sources,
                cells: cells,
                createdAt: Date(timeIntervalSince1970: streamRow["created_at"]),
                updatedAt: Date(timeIntervalSince1970: streamRow["updated_at"])
            )
        }
    }

    func createStream(title: String) throws -> Stream {
        let stream = Stream(title: title)
        try dbQueue.write { db in
            try db.execute(
                sql: "INSERT INTO streams (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                arguments: [stream.id.uuidString, stream.title, stream.createdAt.timeIntervalSince1970, stream.updatedAt.timeIntervalSince1970]
            )
        }
        return stream
    }

    func updateStream(_ stream: Stream) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: "UPDATE streams SET title = ?, updated_at = ? WHERE id = ?",
                arguments: [stream.title, Date().timeIntervalSince1970, stream.id.uuidString]
            )
        }
    }

    func deleteStream(id: UUID) throws {
        try dbQueue.write { db in
            try db.execute(sql: "DELETE FROM streams WHERE id = ?", arguments: [id.uuidString])
        }
    }

    // MARK: - Cell Operations

    func saveCell(_ cell: Cell) throws {
        try dbQueue.write { db in
            let bindingJson: String?
            if let binding = cell.sourceBinding {
                bindingJson = String(data: try JSONEncoder().encode(binding), encoding: .utf8)
            } else {
                bindingJson = nil
            }

            let metadataJson = "{}"  // Simplified for now

            try db.execute(
                sql: """
                    INSERT INTO cells (id, stream_id, type, content, restatement, original_prompt, state, source_binding_json, metadata_json, created_at, updated_at, position)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        content = excluded.content,
                        restatement = excluded.restatement,
                        original_prompt = excluded.original_prompt,
                        type = excluded.type,
                        state = excluded.state,
                        source_binding_json = excluded.source_binding_json,
                        updated_at = excluded.updated_at,
                        position = excluded.position
                """,
                arguments: [
                    cell.id.uuidString,
                    cell.streamId.uuidString,
                    cell.type.rawValue,
                    cell.content,
                    cell.restatement,
                    cell.originalPrompt,
                    "idle",
                    bindingJson,
                    metadataJson,
                    cell.createdAt.timeIntervalSince1970,
                    cell.updatedAt.timeIntervalSince1970,
                    cell.order
                ]
            )

            // Update stream's updated_at
            try db.execute(
                sql: "UPDATE streams SET updated_at = ? WHERE id = ?",
                arguments: [Date().timeIntervalSince1970, cell.streamId.uuidString]
            )
        }
    }

    func deleteCell(id: UUID) throws {
        try dbQueue.write { db in
            try db.execute(sql: "DELETE FROM cells WHERE id = ?", arguments: [id.uuidString])
        }
    }

    // MARK: - Source Operations

    func saveSource(_ source: SourceReference) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: """
                    INSERT INTO sources (id, stream_id, display_name, file_type, bookmark_data, status, extracted_text, page_count, added_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        display_name = excluded.display_name,
                        status = excluded.status,
                        extracted_text = excluded.extracted_text,
                        page_count = excluded.page_count
                """,
                arguments: [
                    source.id.uuidString,
                    source.streamId.uuidString,
                    source.displayName,
                    source.fileType.rawValue,
                    source.bookmarkData,
                    source.status.rawValue,
                    source.extractedText,
                    source.pageCount,
                    source.addedAt.timeIntervalSince1970
                ]
            )

            // Update stream's updated_at
            try db.execute(
                sql: "UPDATE streams SET updated_at = ? WHERE id = ?",
                arguments: [Date().timeIntervalSince1970, source.streamId.uuidString]
            )
        }
    }

    func deleteSource(id: UUID) throws {
        try dbQueue.write { db in
            try db.execute(sql: "DELETE FROM sources WHERE id = ?", arguments: [id.uuidString])
        }
    }
}
