import Foundation

/// Links a cell to a specific location in a source file
struct SourceBinding: Codable {
    let sourceId: UUID
    let location: SourceLocation
}

/// Location within a source file
enum SourceLocation: Codable {
    case whole                    // Entire document
    case page(Int)               // Single page (1-indexed)
    case pageRange(Int, Int)     // Page range (inclusive, 1-indexed)

    private enum CodingKeys: String, CodingKey {
        case type
        case page
        case startPage
        case endPage
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "whole":
            self = .whole
        case "page":
            let page = try container.decode(Int.self, forKey: .page)
            self = .page(page)
        case "pageRange":
            let start = try container.decode(Int.self, forKey: .startPage)
            let end = try container.decode(Int.self, forKey: .endPage)
            self = .pageRange(start, end)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type,
                in: container,
                debugDescription: "Unknown location type: \(type)"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .whole:
            try container.encode("whole", forKey: .type)
        case .page(let page):
            try container.encode("page", forKey: .type)
            try container.encode(page, forKey: .page)
        case .pageRange(let start, let end):
            try container.encode("pageRange", forKey: .type)
            try container.encode(start, forKey: .startPage)
            try container.encode(end, forKey: .endPage)
        }
    }
}
