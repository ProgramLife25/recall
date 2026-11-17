import Foundation
@preconcurrency import NaturalLanguage

enum SemanticSearch {
    private static let embedding = NLEmbedding.sentenceEmbedding(for: .english)
    private static let vectorCache = NSCache<NSString, NSArray>()
    private static let documentCache = NSCache<NSString, SearchDocument>()

    private final class SearchDocument: NSObject {
        let filename: String
        let haystack: String
        let tokens: Set<String>
        init(filename: String, haystack: String, tokens: Set<String>) {
            self.filename = filename
            self.haystack = haystack
            self.tokens = tokens
        }
    }

    static func vector(for text: String) -> [Double] {
        let key = String(text.prefix(8_000))
        if let cached = vectorCache.object(forKey: key as NSString) {
            return cached.compactMap { ($0 as? NSNumber)?.doubleValue }
        }
        guard let vector = embedding?.vector(for: key) else { return [] }
        vectorCache.countLimit = 128
        vectorCache.setObject(vector.map(NSNumber.init(value:)) as NSArray, forKey: key as NSString)
        return vector
    }

    static func search(_ query: String, in files: [IndexedFile], favorites: Set<String> = [], customTags: [String: [String]] = [:], itemNotes: [String: String] = [:], includeVisual: Bool = true) -> [SearchResult] {
        guard !Task.isCancelled else { return [] }
        let parsed = ParsedQuery(query)
        let candidates = files.filter { file in
            if parsed.likedOnly && !favorites.contains(file.path) { return false }
            if let type = parsed.type, !matches(type: type, file: file) { return false }
            if let after = parsed.after, file.modifiedAt < after { return false }
            if let before = parsed.before, file.modifiedAt >= before { return false }
            return true
        }

        guard !parsed.text.isEmpty else {
            return candidates.sorted { $0.modifiedAt > $1.modifiedAt }.prefix(40).map { SearchResult(file: $0, score: 0) }
        }

        let queryVector = vector(for: parsed.text)
        guard !Task.isCancelled else { return [] }
        let visualQueryVector = includeVisual ? (MobileCLIPService.shared.textEmbedding(for: parsed.text) ?? []) : []
        guard !Task.isCancelled else { return [] }
        let queryTokens = meaningfulTokens(parsed.text)
        let now = Date()

        return candidates.compactMap { file -> SearchResult? in
            guard !Task.isCancelled else { return nil }
            let document = cachedDocument(for: file)
            let filename = document.filename
            let tags = customTags[file.path]?.joined(separator: " ") ?? ""
            let note = itemNotes[file.path] ?? ""
            let additions = (tags + " " + note).lowercased()
            let haystack = additions.isEmpty ? document.haystack : document.haystack + " " + additions
            var fileTokens = document.tokens
            if !additions.isEmpty { fileTokens.formUnion(tokenize(additions)) }
            let matched = queryTokens.filter { token in
                fileTokens.contains(token) || fileTokens.contains(where: { stem($0) == stem(token) })
            }
            let coverage = queryTokens.isEmpty ? 0 : Double(matched.count) / Double(queryTokens.count)

            var score = max(0, cosine(queryVector, file.embedding)) * 0.62
            if let visualEmbedding = file.visualEmbedding, !visualQueryVector.isEmpty {
                // MobileCLIP is the strongest signal for natural-language visual queries.
                score += max(0, cosine(visualQueryVector, visualEmbedding)) * 0.92
            }
            if haystack.contains(parsed.text) { score += 0.48 }
            if filename.contains(parsed.text) { score += 0.62 }
            if tags.contains(parsed.text) { score += 0.72 }
            if note.lowercased().contains(parsed.text) { score += 0.60 }
            score += coverage * 0.44
            if matched.count == queryTokens.count && !queryTokens.isEmpty { score += 0.16 }
            if favorites.contains(file.path) { score += 0.07 }

            let ageDays = max(0, now.timeIntervalSince(file.modifiedAt) / 86_400)
            score += 0.06 / (1 + ageDays / 30)
            return SearchResult(file: file, score: score)
        }
        .filter { $0.score > 0.08 }
        .sorted {
            if abs($0.score - $1.score) < 0.001 { return $0.file.modifiedAt > $1.file.modifiedAt }
            return $0.score > $1.score
        }
        .prefix(60)
        .map { $0 }
    }

    private static func cachedDocument(for file: IndexedFile) -> SearchDocument {
        let key = "\(file.path)|\(file.modifiedAt.timeIntervalSince1970)|\(file.searchableText.hashValue)" as NSString
        if let cached = documentCache.object(forKey: key) { return cached }
        let filename = file.url.deletingPathExtension().lastPathComponent.lowercased()
        let haystack = (filename + " " + file.searchableText).lowercased()
        let document = SearchDocument(filename: filename, haystack: haystack, tokens: Set(tokenize(haystack)))
        documentCache.countLimit = 12_000
        documentCache.setObject(document, forKey: key)
        return document
    }

    private static func matches(type: String, file: IndexedFile) -> Bool {
        let ext = file.url.pathExtension.lowercased()
        switch type {
        case "image", "photo": return ContentExtractor.imageExtensions.contains(ext)
        case "note", "text": return ["md", "txt", "rtf"].contains(ext)
        case "document", "doc": return ContentExtractor.documentExtensions.contains(ext) || ContentExtractor.textExtensions.contains(ext)
        case "pdf": return ext == "pdf"
        case "video", "movie": return ContentExtractor.videoExtensions.contains(ext) || file.contentType == "Video"
        case "article": return file.contentType == "Article"
        case "quote": return file.contentType == "Quote"
        case "audio", "music": return file.contentType == "Audio"
        case "spreadsheet", "excel": return ["xls", "xlsx", "numbers", "csv"].contains(ext)
        case "presentation", "slides": return ["ppt", "pptx", "key"].contains(ext)
        default: return ext == type
        }
    }

    private static func tokenize(_ text: String) -> [String] {
        text.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
    }

    private static func meaningfulTokens(_ text: String) -> [String] {
        let stopWords = Set(["a", "an", "and", "the", "of", "in", "on", "with", "that", "this", "my", "find", "show", "me"])
        return tokenize(text).filter { $0.count > 1 && !stopWords.contains($0) }
    }

    private static func stem(_ word: String) -> String {
        for suffix in ["ing", "ies", "es", "s"] where word.count > suffix.count + 2 && word.hasSuffix(suffix) {
            return String(word.dropLast(suffix.count))
        }
        return word
    }

    private static func cosine(_ lhs: [Double], _ rhs: [Double]) -> Double {
        guard !lhs.isEmpty, lhs.count == rhs.count else { return 0 }
        var dot = 0.0, left = 0.0, right = 0.0
        for index in lhs.indices {
            dot += lhs[index] * rhs[index]
            left += lhs[index] * lhs[index]
            right += rhs[index] * rhs[index]
        }
        let denominator = sqrt(left) * sqrt(right)
        return denominator == 0 ? 0 : dot / denominator
    }
}

private struct ParsedQuery {
    var text: String
    var type: String?
    var likedOnly = false
    var after: Date?
    var before: Date?

    init(_ raw: String) {
        var working = raw.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        let calendar = Calendar.current
        let now = Date()

        if let match = working.range(of: #"type:\s*([a-z0-9]+)"#, options: .regularExpression) {
            type = working[match].split(separator: ":").last.map { $0.trimmingCharacters(in: .whitespaces) }
            working.removeSubrange(match)
        }
        if working.contains("liked:true") || working.contains("is:liked") || working.contains("my favorites") {
            likedOnly = true
            working = working.replacingOccurrences(of: "liked:true", with: "")
                .replacingOccurrences(of: "is:liked", with: "")
                .replacingOccurrences(of: "my favorites", with: "")
        }
        if working.contains("today") {
            after = calendar.startOfDay(for: now)
            working = working.replacingOccurrences(of: "today", with: "")
        } else if working.contains("yesterday") {
            let today = calendar.startOfDay(for: now)
            after = calendar.date(byAdding: .day, value: -1, to: today)
            before = today
            working = working.replacingOccurrences(of: "yesterday", with: "")
        } else if working.contains("last week") {
            after = calendar.date(byAdding: .day, value: -7, to: now)
            working = working.replacingOccurrences(of: "last week", with: "")
        } else if working.contains("last month") {
            after = calendar.date(byAdding: .month, value: -1, to: now)
            working = working.replacingOccurrences(of: "last month", with: "")
        }
        text = working.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
