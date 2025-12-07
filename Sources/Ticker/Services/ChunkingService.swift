import Foundation
import PDFKit

/// Splits documents into semantic chunks for embedding
final class ChunkingService {

    // MARK: - Configuration

    struct Config {
        var targetTokens: Int = 500       // Target chunk size
        var maxTokens: Int = 1000         // Hard maximum
        var overlapTokens: Int = 50       // Overlap between chunks
        var charsPerToken: Double = 4.0   // Token estimation (same as LLMRequest)
    }

    private let config: Config

    init(config: Config = Config()) {
        self.config = config
    }

    // MARK: - Public Interface

    /// Chunk PDF with page tracking
    func chunkPDF(document: PDFDocument, sourceId: UUID) -> [SourceChunk] {
        // Extract text with page boundaries
        var pageTexts: [(text: String, page: Int)] = []

        for i in 0..<document.pageCount {
            if let page = document.page(at: i),
               let pageText = page.string,
               !pageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                pageTexts.append((pageText, i + 1))  // 1-indexed pages
            }
        }

        return chunkWithPageTracking(pageTexts: pageTexts, sourceId: sourceId)
    }

    /// Chunk plain text (no page tracking)
    func chunkText(text: String, sourceId: UUID) -> [SourceChunk] {
        let paragraphs = splitIntoParagraphs(text)
        let merged = mergeIntoChunks(paragraphs: paragraphs)

        return merged.enumerated().map { index, item in
            SourceChunk(
                sourceId: sourceId,
                chunkIndex: index,
                content: item.content,
                tokenCount: item.tokenCount,
                pageStart: nil,
                pageEnd: nil
            )
        }
    }

    // MARK: - Private

    private func estimateTokens(_ text: String) -> Int {
        Int(ceil(Double(text.count) / config.charsPerToken))
    }

    /// Split text into paragraphs (respecting markdown structure)
    private func splitIntoParagraphs(_ text: String) -> [String] {
        // Split on double newlines, preserving structure
        let rawParagraphs = text.components(separatedBy: "\n\n")

        var paragraphs: [String] = []
        var currentHeader: String? = nil

        for paragraph in rawParagraphs {
            let trimmed = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }

            // Check if this is a markdown header
            if trimmed.hasPrefix("#") {
                // If we have content after a header, append it
                if let header = currentHeader {
                    paragraphs.append(header)
                }
                currentHeader = trimmed
            } else if let header = currentHeader {
                // Combine header with following content
                paragraphs.append("\(header)\n\n\(trimmed)")
                currentHeader = nil
            } else {
                paragraphs.append(trimmed)
            }
        }

        // Don't forget trailing header
        if let header = currentHeader {
            paragraphs.append(header)
        }

        return paragraphs
    }

    /// Merge paragraphs into chunks of target size with overlap
    private func mergeIntoChunks(paragraphs: [String]) -> [(content: String, tokenCount: Int)] {
        guard !paragraphs.isEmpty else { return [] }

        var chunks: [(content: String, tokenCount: Int)] = []
        var currentContent = ""
        var currentTokens = 0
        var lastOverlap = ""  // Content to prepend to next chunk

        for paragraph in paragraphs {
            let paragraphTokens = estimateTokens(paragraph)

            // If single paragraph exceeds max, split it
            if paragraphTokens > config.maxTokens {
                // Flush current chunk if any
                if !currentContent.isEmpty {
                    chunks.append((currentContent, currentTokens))
                    lastOverlap = extractOverlap(from: currentContent)
                    currentContent = ""
                    currentTokens = 0
                }

                // Split long paragraph by sentences
                let sentences = splitIntoSentences(paragraph)
                for sentenceChunk in mergeSentences(sentences) {
                    if !lastOverlap.isEmpty {
                        let combined = lastOverlap + "\n\n" + sentenceChunk.content
                        chunks.append((combined, estimateTokens(combined)))
                    } else {
                        chunks.append(sentenceChunk)
                    }
                    lastOverlap = extractOverlap(from: sentenceChunk.content)
                }
                continue
            }

            // Check if adding this paragraph would exceed target
            let separator = currentContent.isEmpty ? "" : "\n\n"
            let newTokens = currentTokens + (currentContent.isEmpty ? 0 : 2) + paragraphTokens

            if newTokens > config.targetTokens && !currentContent.isEmpty {
                // Start new chunk
                chunks.append((currentContent, currentTokens))
                lastOverlap = extractOverlap(from: currentContent)

                // Start new chunk with overlap + new paragraph
                if !lastOverlap.isEmpty {
                    currentContent = lastOverlap + "\n\n" + paragraph
                    currentTokens = estimateTokens(currentContent)
                } else {
                    currentContent = paragraph
                    currentTokens = paragraphTokens
                }
            } else {
                // Add to current chunk
                if currentContent.isEmpty && !lastOverlap.isEmpty {
                    currentContent = lastOverlap + "\n\n" + paragraph
                    currentTokens = estimateTokens(currentContent)
                    lastOverlap = ""
                } else {
                    currentContent += separator + paragraph
                    currentTokens = newTokens
                }
            }
        }

        // Don't forget last chunk
        if !currentContent.isEmpty {
            chunks.append((currentContent, currentTokens))
        }

        return chunks
    }

    /// Extract overlap content (last ~50 tokens) from a chunk
    private func extractOverlap(from content: String) -> String {
        let targetChars = Int(Double(config.overlapTokens) * config.charsPerToken)
        guard content.count > targetChars else { return content }

        // Find a good break point (sentence or paragraph boundary)
        let suffix = String(content.suffix(targetChars * 2))  // Take more, then trim to boundary

        // Try to break at sentence boundary
        if let lastPeriod = suffix.lastIndex(of: ".") {
            let afterPeriod = suffix.index(after: lastPeriod)
            if afterPeriod < suffix.endIndex {
                return String(suffix[afterPeriod...]).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }

        // Fall back to simple suffix
        return String(content.suffix(targetChars)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Split paragraph into sentences
    private func splitIntoSentences(_ text: String) -> [String] {
        var sentences: [String] = []
        text.enumerateSubstrings(in: text.startIndex..., options: .bySentences) { substring, _, _, _ in
            if let sentence = substring?.trimmingCharacters(in: .whitespacesAndNewlines),
               !sentence.isEmpty {
                sentences.append(sentence)
            }
        }
        return sentences.isEmpty ? [text] : sentences
    }

    /// Merge sentences into chunks (for long paragraphs)
    private func mergeSentences(_ sentences: [String]) -> [(content: String, tokenCount: Int)] {
        var chunks: [(content: String, tokenCount: Int)] = []
        var current = ""
        var currentTokens = 0

        for sentence in sentences {
            let sentenceTokens = estimateTokens(sentence)
            let newTokens = currentTokens + (current.isEmpty ? 0 : 1) + sentenceTokens

            if newTokens > config.maxTokens && !current.isEmpty {
                chunks.append((current, currentTokens))
                current = sentence
                currentTokens = sentenceTokens
            } else {
                current += (current.isEmpty ? "" : " ") + sentence
                currentTokens = newTokens
            }
        }

        if !current.isEmpty {
            chunks.append((current, currentTokens))
        }

        return chunks
    }

    /// Chunk with page boundary tracking
    private func chunkWithPageTracking(pageTexts: [(text: String, page: Int)], sourceId: UUID) -> [SourceChunk] {
        guard !pageTexts.isEmpty else { return [] }

        var chunks: [SourceChunk] = []
        var currentContent = ""
        var currentTokens = 0
        var currentStartPage: Int? = nil
        var currentEndPage: Int? = nil
        var chunkIndex = 0
        var lastOverlap = ""

        for (pageText, pageNum) in pageTexts {
            let paragraphs = splitIntoParagraphs(pageText)

            for paragraph in paragraphs {
                let paragraphTokens = estimateTokens(paragraph)

                // Handle very long paragraphs
                if paragraphTokens > config.maxTokens {
                    // Flush current
                    if !currentContent.isEmpty {
                        chunks.append(SourceChunk(
                            sourceId: sourceId,
                            chunkIndex: chunkIndex,
                            content: currentContent,
                            tokenCount: currentTokens,
                            pageStart: currentStartPage,
                            pageEnd: currentEndPage
                        ))
                        chunkIndex += 1
                        lastOverlap = extractOverlap(from: currentContent)
                        currentContent = ""
                        currentTokens = 0
                        currentStartPage = nil
                        currentEndPage = nil
                    }

                    // Split and add
                    let sentences = splitIntoSentences(paragraph)
                    for sentenceChunk in mergeSentences(sentences) {
                        var content = sentenceChunk.content
                        if !lastOverlap.isEmpty {
                            content = lastOverlap + "\n\n" + content
                        }
                        chunks.append(SourceChunk(
                            sourceId: sourceId,
                            chunkIndex: chunkIndex,
                            content: content,
                            tokenCount: estimateTokens(content),
                            pageStart: pageNum,
                            pageEnd: pageNum
                        ))
                        chunkIndex += 1
                        lastOverlap = extractOverlap(from: content)
                    }
                    continue
                }

                let separator = currentContent.isEmpty ? "" : "\n\n"
                let newTokens = currentTokens + (currentContent.isEmpty ? 0 : 2) + paragraphTokens

                if newTokens > config.targetTokens && !currentContent.isEmpty {
                    // Save current chunk
                    chunks.append(SourceChunk(
                        sourceId: sourceId,
                        chunkIndex: chunkIndex,
                        content: currentContent,
                        tokenCount: currentTokens,
                        pageStart: currentStartPage,
                        pageEnd: currentEndPage
                    ))
                    chunkIndex += 1
                    lastOverlap = extractOverlap(from: currentContent)

                    // Start new chunk
                    if !lastOverlap.isEmpty {
                        currentContent = lastOverlap + "\n\n" + paragraph
                        currentTokens = estimateTokens(currentContent)
                    } else {
                        currentContent = paragraph
                        currentTokens = paragraphTokens
                    }
                    currentStartPage = pageNum
                    currentEndPage = pageNum
                } else {
                    // Add to current chunk
                    if currentContent.isEmpty {
                        if !lastOverlap.isEmpty {
                            currentContent = lastOverlap + "\n\n" + paragraph
                            currentTokens = estimateTokens(currentContent)
                            lastOverlap = ""
                        } else {
                            currentContent = paragraph
                            currentTokens = paragraphTokens
                        }
                        currentStartPage = pageNum
                    } else {
                        currentContent += separator + paragraph
                        currentTokens = newTokens
                    }
                    currentEndPage = pageNum
                }
            }
        }

        // Don't forget last chunk
        if !currentContent.isEmpty {
            chunks.append(SourceChunk(
                sourceId: sourceId,
                chunkIndex: chunkIndex,
                content: currentContent,
                tokenCount: currentTokens,
                pageStart: currentStartPage,
                pageEnd: currentEndPage
            ))
        }

        return chunks
    }
}
