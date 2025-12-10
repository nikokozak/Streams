import Foundation
import AppKit

/// Manages stream assets (images, files) stored locally
final class AssetService {
    private let fileManager = FileManager.default

    /// Base directory for all stream assets
    private var assetsBaseDirectory: URL {
        let home = fileManager.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".config/ticker/assets", isDirectory: true)
    }

    /// Get the assets directory for a specific stream
    func assetsDirectory(for streamId: UUID) -> URL {
        assetsBaseDirectory.appendingPathComponent(streamId.uuidString, isDirectory: true)
    }

    /// Ensure the assets directory exists for a stream
    func ensureAssetsDirectory(for streamId: UUID) throws {
        let directory = assetsDirectory(for: streamId)
        if !fileManager.fileExists(atPath: directory.path) {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        }
    }

    /// Save image data to the stream's assets folder
    /// Returns the relative path from assets base (for storage in cell content)
    func saveImage(data: Data, streamId: UUID, filename: String? = nil) throws -> String {
        try ensureAssetsDirectory(for: streamId)

        let directory = assetsDirectory(for: streamId)

        // Generate unique filename if not provided
        let finalFilename: String
        if let filename = filename {
            finalFilename = filename
        } else {
            // Detect image type and use appropriate extension
            let ext = imageExtension(from: data) ?? "png"
            finalFilename = "\(UUID().uuidString).\(ext)"
        }

        let fileURL = directory.appendingPathComponent(finalFilename)
        try data.write(to: fileURL)

        // Return relative path: streamId/filename
        return "\(streamId.uuidString)/\(finalFilename)"
    }

    /// Save an image from a file URL (copies to assets folder)
    func saveImage(from sourceURL: URL, streamId: UUID) throws -> String {
        let data = try Data(contentsOf: sourceURL)
        let filename = sourceURL.lastPathComponent
        return try saveImage(data: data, streamId: streamId, filename: filename)
    }

    /// Get the full file URL for an asset path
    func assetURL(for relativePath: String) -> URL {
        assetsBaseDirectory.appendingPathComponent(relativePath)
    }

    /// Delete all assets for a stream
    func deleteAssets(for streamId: UUID) throws {
        let directory = assetsDirectory(for: streamId)
        if fileManager.fileExists(atPath: directory.path) {
            try fileManager.removeItem(at: directory)
        }
    }

    /// Delete a specific asset
    func deleteAsset(relativePath: String) throws {
        let fileURL = assetURL(for: relativePath)
        if fileManager.fileExists(atPath: fileURL.path) {
            try fileManager.removeItem(at: fileURL)
        }
    }

    /// Convert a ticker-asset:// URL to a data URL for API consumption
    /// Returns nil if the file doesn't exist, can't be read, or is outside the assets directory
    func assetToDataURL(_ assetURL: String) -> String? {
        // Parse ticker-asset:// URL to get file path
        guard assetURL.hasPrefix("ticker-asset://") else { return nil }

        let filePath = String(assetURL.dropFirst("ticker-asset://".count))
        let requestedURL = URL(fileURLWithPath: filePath)

        // Security: Canonicalize paths to prevent directory traversal attacks
        let canonicalPath = requestedURL.standardized.resolvingSymlinksInPath().path
        let canonicalBase = assetsBaseDirectory.standardized.resolvingSymlinksInPath().path

        // Verify the requested path is within the assets directory
        guard canonicalPath.hasPrefix(canonicalBase + "/") else {
            print("AssetService: Blocked path outside assets directory: \(filePath)")
            return nil
        }

        let safeURL = URL(fileURLWithPath: canonicalPath)
        guard let data = try? Data(contentsOf: safeURL) else {
            print("AssetService: Could not read file at \(canonicalPath)")
            return nil
        }

        // Detect MIME type
        let mimeType = mimeType(for: safeURL.pathExtension)

        // Convert to data URL
        let base64 = data.base64EncodedString()
        return "data:\(mimeType);base64,\(base64)"
    }

    /// Convert multiple asset URLs to data URLs
    func assetsToDataURLs(_ assetURLs: [String]) -> [String] {
        assetURLs.compactMap { assetToDataURL($0) }
    }

    // MARK: - Private Helpers

    /// Get MIME type for file extension
    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "heic", "heif": return "image/heic"
        default: return "application/octet-stream"
        }
    }

    /// Detect image format from data header bytes
    private func imageExtension(from data: Data) -> String? {
        guard data.count >= 8 else { return nil }

        let bytes = [UInt8](data.prefix(8))

        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47 {
            return "png"
        }

        // JPEG: FF D8 FF
        if bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
            return "jpg"
        }

        // GIF: 47 49 46 38
        if bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x38 {
            return "gif"
        }

        // WebP: 52 49 46 46 ... 57 45 42 50
        if bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x46 {
            return "webp"
        }

        return nil
    }
}
