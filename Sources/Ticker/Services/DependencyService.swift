import Foundation

/// Manages block dependency graph for cascade updates
/// When a block changes, dependents can be automatically refreshed
final class DependencyService {
    /// Maps blockId -> Set of blocks that depend on it
    private var dependents: [UUID: Set<UUID>] = [:]

    /// Maps blockId -> Set of blocks it references
    private var references: [UUID: Set<UUID>] = [:]

    /// Maximum depth for cascade updates (prevents infinite loops)
    private let maxCascadeDepth = 3

    // MARK: - Graph Building

    /// Build dependency graph from cells
    func buildGraph(from cells: [Cell]) {
        dependents.removeAll()
        references.removeAll()

        for cell in cells {
            guard let refs = cell.references, !refs.isEmpty else { continue }

            // Store what this cell references
            references[cell.id] = Set(refs)

            // For each referenced cell, record this cell as a dependent
            for refId in refs {
                dependents[refId, default: []].insert(cell.id)
            }
        }
    }

    /// Add a single cell to the graph
    func addCell(_ cell: Cell) {
        guard let refs = cell.references, !refs.isEmpty else { return }

        references[cell.id] = Set(refs)
        for refId in refs {
            dependents[refId, default: []].insert(cell.id)
        }
    }

    /// Update a cell's references
    func updateCell(_ cell: Cell) {
        // Remove old references
        if let oldRefs = references[cell.id] {
            for refId in oldRefs {
                dependents[refId]?.remove(cell.id)
            }
        }

        // Add new references
        if let newRefs = cell.references, !newRefs.isEmpty {
            references[cell.id] = Set(newRefs)
            for refId in newRefs {
                dependents[refId, default: []].insert(cell.id)
            }
        } else {
            references.removeValue(forKey: cell.id)
        }
    }

    /// Remove a cell from the graph
    func removeCell(id: UUID) {
        // Remove from dependents lists
        if let refs = references[id] {
            for refId in refs {
                dependents[refId]?.remove(id)
            }
        }

        // Remove its own data
        references.removeValue(forKey: id)
        dependents.removeValue(forKey: id)
    }

    // MARK: - Queries

    /// Get all blocks that directly depend on the given block
    func getDirectDependents(of blockId: UUID) -> Set<UUID> {
        dependents[blockId] ?? []
    }

    /// Get all blocks that need update when source changes (BFS, respects maxCascadeDepth)
    func getCascadeDependents(of blockId: UUID) -> [UUID] {
        var result: [UUID] = []
        var visited: Set<UUID> = [blockId]
        var queue: [UUID] = Array(dependents[blockId] ?? [])
        var depth = 0

        while !queue.isEmpty && depth < maxCascadeDepth {
            var nextLevel: [UUID] = []

            for id in queue {
                guard !visited.contains(id) else { continue }
                visited.insert(id)
                result.append(id)

                // Add this block's dependents to next level
                if let deps = dependents[id] {
                    nextLevel.append(contentsOf: deps)
                }
            }

            queue = nextLevel
            depth += 1
        }

        return result
    }

    /// Get what a block references
    func getReferences(of blockId: UUID) -> Set<UUID> {
        references[blockId] ?? []
    }

    /// Check if updating blockA would create a cycle through blockB
    func wouldCreateCycle(from blockA: UUID, to blockB: UUID) -> Bool {
        // If B already depends on A (directly or transitively), adding A->B creates cycle
        var visited: Set<UUID> = []
        var queue = [blockB]

        while !queue.isEmpty {
            let current = queue.removeFirst()
            guard !visited.contains(current) else { continue }
            visited.insert(current)

            if current == blockA {
                return true
            }

            if let refs = references[current] {
                queue.append(contentsOf: refs)
            }
        }

        return false
    }
}

// MARK: - Reference Parsing

extension DependencyService {
    /// Pattern for block references: @block-{shortId} or @block-{name}
    /// Examples: @block-abc1, @block-nasdaq
    static let referencePattern = try! NSRegularExpression(
        pattern: #"@block-([a-zA-Z0-9]{3,})"#,
        options: []
    )

    /// Extract reference identifiers from content
    /// Returns short IDs or names (not full UUIDs)
    static func extractReferenceIdentifiers(from content: String) -> [String] {
        let text = stripHTML(content)
        let range = NSRange(text.startIndex..., in: text)

        return referencePattern.matches(in: text, range: range).compactMap { match in
            guard let range = Range(match.range(at: 1), in: text) else { return nil }
            return String(text[range]).lowercased()
        }
    }

    /// Resolve reference identifiers to UUIDs
    /// - Parameters:
    ///   - identifiers: Short IDs or block names
    ///   - cells: All cells in the stream
    /// - Returns: Resolved UUIDs
    static func resolveIdentifiers(_ identifiers: [String], in cells: [Cell]) -> [UUID] {
        identifiers.compactMap { identifier in
            // First try to match by blockName
            if let cell = cells.first(where: { $0.blockName?.lowercased() == identifier }) {
                return cell.id
            }

            // Then try to match by UUID prefix
            if let cell = cells.first(where: { $0.id.uuidString.lowercased().hasPrefix(identifier) }) {
                return cell.id
            }

            return nil
        }
    }

    /// Strip HTML tags from content for text parsing
    private static func stripHTML(_ html: String) -> String {
        guard let data = html.data(using: .utf8) else { return html }

        let options: [NSAttributedString.DocumentReadingOptionKey: Any] = [
            .documentType: NSAttributedString.DocumentType.html,
            .characterEncoding: String.Encoding.utf8.rawValue
        ]

        if let attributed = try? NSAttributedString(data: data, options: options, documentAttributes: nil) {
            return attributed.string
        }

        // Fallback: simple regex strip
        return html.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
    }

    /// Resolve references in content by replacing @block-xxx with actual cell content
    /// - Parameters:
    ///   - content: Content containing @block-xxx references
    ///   - cells: All cells in the stream
    /// - Returns: Content with references replaced by cell content
    static func resolveReferencesInContent(_ content: String, cells: [Cell]) -> String {
        let text = stripHTML(content)
        var result = text

        // Find all references
        let range = NSRange(text.startIndex..., in: text)
        let matches = referencePattern.matches(in: text, range: range)

        // Process in reverse order to maintain correct indices
        for match in matches.reversed() {
            guard let fullRange = Range(match.range, in: result),
                  let idRange = Range(match.range(at: 1), in: result) else { continue }

            let identifier = String(result[idRange]).lowercased()

            // Find the referenced cell
            var referencedCell: Cell?

            // First try to match by blockName
            if let cell = cells.first(where: { $0.blockName?.lowercased() == identifier }) {
                referencedCell = cell
            }
            // Then try to match by UUID prefix
            else if let cell = cells.first(where: { $0.id.uuidString.lowercased().hasPrefix(identifier) }) {
                referencedCell = cell
            }

            if let cell = referencedCell {
                // Replace with the cell's content (stripped of HTML)
                let cellContent = stripHTML(cell.content)
                let replacement = "[\(cell.blockName ?? "block"):\n\(cellContent)\n]"
                result.replaceSubrange(fullRange, with: replacement)
            }
        }

        return result
    }
}
