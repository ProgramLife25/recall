import Foundation

actor IndexStore {
    private let fileManager = FileManager.default
    private let indexURL: URL
    private let legacyIndexURL: URL
    private let capturesURL: URL
    private var cached = StoredIndex()
    private var pendingSave: Task<Void, Never>?

    init() {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Recall", isDirectory: true)
        try? fileManager.createDirectory(at: base, withIntermediateDirectories: true)
        indexURL = base.appendingPathComponent("index.bin")
        legacyIndexURL = base.appendingPathComponent("index.json")
        capturesURL = base.appendingPathComponent("Captures", isDirectory: true)
        try? fileManager.createDirectory(at: capturesURL, withIntermediateDirectories: true)
    }

    func load() -> StoredIndex {
        let stored: StoredIndex?
        if let data = try? Data(contentsOf: indexURL) {
            stored = try? PropertyListDecoder().decode(StoredIndex.self, from: data)
        } else if let data = try? Data(contentsOf: legacyIndexURL) {
            stored = try? JSONDecoder().decode(StoredIndex.self, from: data)
        } else {
            stored = nil
        }
        guard let stored else { return cached }
        cached = stored
        // Migrate older JSON libraries once. Binary property lists decode large
        // embedding arrays much faster and use substantially less disk space.
        if !fileManager.fileExists(atPath: indexURL.path) { save(stored) }
        return stored
    }

    func rebuild(folders: [String], previous: [IndexedFile], progress: @Sendable (Int, Int) async -> Void) async -> [IndexedFile] {
        let old = Dictionary(uniqueKeysWithValues: previous.map { ($0.path, $0) })
        let urls = collectFiles(in: folders.map { URL(fileURLWithPath: $0) } + [capturesURL])
        var indexed: [IndexedFile] = []

        for (offset, url) in urls.enumerated() {
            guard !Task.isCancelled else { break }
            let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
            let modified = values?.contentModificationDate ?? .distantPast
            let size = Int64(values?.fileSize ?? 0)
            let needsRicherImageMetadata = ContentExtractor.imageExtensions.contains(url.pathExtension.lowercased())
                && old[url.path]?.metadataVersion != ContentExtractor.metadataVersion
            let needsContentType = old[url.path]?.contentType == nil
            if let cached = old[url.path], cached.modifiedAt == modified, cached.byteSize == size, !needsRicherImageMetadata, !needsContentType {
                indexed.append(cached)
            } else {
                let extracted = ContentExtractor.extract(from: url)
                let articleText = cached.articleTexts?[url.path]
                let articleHTML = cached.articleHTMLByPath?[url.path]
                let searchable = ([extracted.searchableText, articleText].compactMap { $0 }.joined(separator: " ")).trimmingCharacters(in: .whitespacesAndNewlines)
                let descriptive = "\(url.deletingPathExtension().lastPathComponent) \(url.pathExtension) \(searchable)"
                let visualEmbedding = ContentExtractor.imageExtensions.contains(url.pathExtension.lowercased())
                    ? MobileCLIPService.shared.imageEmbedding(for: url) : nil
                let completedMetadataVersion = ContentExtractor.imageExtensions.contains(url.pathExtension.lowercased()) && visualEmbedding == nil
                    ? ContentExtractor.metadataVersion - 1 : ContentExtractor.metadataVersion
                indexed.append(IndexedFile(
                    path: url.path,
                    name: url.lastPathComponent,
                    kind: url.pathExtension.uppercased(),
                    modifiedAt: modified,
                    byteSize: size,
                    searchableText: String(searchable.prefix(30_000)),
                    embedding: SemanticSearch.vector(for: descriptive),
                    aiMetadata: ContentExtractor.imageExtensions.contains(url.pathExtension.lowercased()) ? searchable : nil,
                    aiCaption: extracted.caption,
                    aiTags: extracted.tags,
                    metadataVersion: completedMetadataVersion,
                    visualEmbedding: visualEmbedding,
                    sourceURL: cached.sourceURLs?[url.path],
                    detectedPrice: cached.detectedPrices?[url.path],
                    sourceTitle: cached.sourceTitles?[url.path],
                    sourceSite: cached.sourceSites?[url.path],
                    contentType: cached.contentTypes?[url.path] ?? contentType(for: url, searchableText: searchable, tags: extracted.tags),
                    articleText: articleText,
                    articleHTML: articleHTML
                ))
            }
            await progress(offset + 1, urls.count)
        }
        cached.folders = folders
        cached.files = indexed
        save(cached)
        return indexed
    }

    func setFavorites(_ paths: [String]) {
        cached.favoritePaths = paths
        scheduleSave()
    }

    func setTags(_ tags: [String], for path: String) {
        var allTags = cached.customTags ?? [:]
        if tags.isEmpty { allTags.removeValue(forKey: path) }
        else { allTags[path] = tags }
        cached.customTags = allTags
        scheduleSave()
    }

    func setNote(_ note: String, for path: String) {
        var notes = cached.itemNotes ?? [:]
        let cleaned = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty { notes.removeValue(forKey: path) }
        else { notes[path] = cleaned }
        cached.itemNotes = notes
        scheduleSave()
    }

    func setSpaces(_ spaces: [String: [String]]) {
        cached.spaces = spaces
        scheduleSave()
    }

    func setWebMetadata(sourceURL: String, price: String?, title: String? = nil, site: String? = nil, contentType: String? = nil, articleText: String? = nil, articleHTML: String? = nil, for path: String) {
        var sources = cached.sourceURLs ?? [:]
        sources[path] = sourceURL
        cached.sourceURLs = sources
        if contentType == "Video" {
            var prices = cached.detectedPrices ?? [:]; prices.removeValue(forKey: path); cached.detectedPrices = prices
        } else if let price, !price.isEmpty {
            var prices = cached.detectedPrices ?? [:]
            prices[path] = price
            cached.detectedPrices = prices
        }
        if let title, !title.isEmpty {
            var values = cached.sourceTitles ?? [:]; values[path] = title; cached.sourceTitles = values
        }
        if let site, !site.isEmpty {
            var values = cached.sourceSites ?? [:]; values[path] = site; cached.sourceSites = values
        }
        if let contentType, !contentType.isEmpty {
            var values = cached.contentTypes ?? [:]; values[path] = contentType; cached.contentTypes = values
        }
        if let articleText, !articleText.isEmpty {
            var values = cached.articleTexts ?? [:]; values[path] = String(articleText.prefix(250_000)); cached.articleTexts = values
        }
        if let articleHTML, !articleHTML.isEmpty {
            var values = cached.articleHTMLByPath ?? [:]; values[path] = String(articleHTML.prefix(2_000_000)); cached.articleHTMLByPath = values
        }
        if let index = cached.files.firstIndex(where: { $0.path == path }) {
            cached.files[index].sourceURL = sourceURL
            if contentType == "Video" { cached.files[index].detectedPrice = nil }
            else if let price { cached.files[index].detectedPrice = price }
            if let title { cached.files[index].sourceTitle = title }
            if let site { cached.files[index].sourceSite = site }
            if let contentType { cached.files[index].contentType = contentType }
            if let articleText { cached.files[index].articleText = String(articleText.prefix(250_000)) }
            if let articleHTML { cached.files[index].articleHTML = String(articleHTML.prefix(2_000_000)) }
        }
        scheduleSave()
    }

    func applyAIMetadata(_ metadata: String, caption: String, tags: [String], to path: String) -> IndexedFile? {
        guard let index = cached.files.firstIndex(where: { $0.path == path }) else { return nil }
        var file = cached.files[index]
        file.aiMetadata = metadata
        let combined = file.searchableText + " " + metadata
        file = IndexedFile(path: file.path, name: file.name, kind: file.kind,
                           modifiedAt: file.modifiedAt, byteSize: file.byteSize,
                           searchableText: combined,
                           embedding: SemanticSearch.vector(for: file.name + " " + combined),
                           aiMetadata: metadata,
                           aiCaption: caption,
                           aiTags: tags,
                           metadataVersion: ContentExtractor.metadataVersion,
                           visualEmbedding: file.visualEmbedding,
                           sourceURL: file.sourceURL,
                           detectedPrice: file.detectedPrice,
                           sourceTitle: file.sourceTitle,
                           sourceSite: file.sourceSite,
                           contentType: file.contentType,
                           articleText: file.articleText,
                           articleHTML: file.articleHTML)
        cached.files[index] = file
        scheduleSave()
        return file
    }

    private func contentType(for url: URL, searchableText: String, tags: [String]) -> String {
        let ext = url.pathExtension.lowercased()
        let text = ([url.lastPathComponent, searchableText] + tags).joined(separator: " ").lowercased()
        if ext == "pdf" { return "Document" }
        if ["doc", "docx", "odt", "pages"].contains(ext) { return "Document" }
        if ["xls", "xlsx", "ods", "numbers", "csv"].contains(ext) { return "Spreadsheet" }
        if ["ppt", "pptx", "odp", "key"].contains(ext) { return "Presentation" }
        if ["epub", "mobi", "azw", "azw3"].contains(ext) { return "Book" }
        if ["zip", "rar", "7z", "tar", "gz"].contains(ext) { return "Archive" }
        if ["mp3", "m4a", "aac", "wav", "flac", "aiff", "ogg"].contains(ext) { return "Audio" }
        if ContentExtractor.looksLikeQuote(searchableText) { return "Quote" }
        if ["md", "txt", "rtf"].contains(ext) { return "Note" }
        if ["html", "htm"].contains(ext) { return "Web page" }
        if ContentExtractor.videoExtensions.contains(ext) { return "Video" }
        if text.contains("recipe") || text.contains("ingredient") { return "Recipe" }
        if text.contains("price") || text.contains("buy") || text.contains("product") || text.contains("shop") { return "Product" }
        if text.contains("article") || text.contains("news") || text.contains("author") { return "Article" }
        if text.contains("hotel") || text.contains("restaurant") || text.contains("travel") || text.contains("location") { return "Place" }
        if text.contains("quote") { return "Quote" }
        if text.contains("screenshot") { return "Screenshot" }
        if ContentExtractor.imageExtensions.contains(ext) { return "Image" }
        return "File"
    }

    func createNote(title: String, body: String) throws -> URL {
        let cleanTitle = sanitized(title.isEmpty ? "Untitled note" : title)
        let url = uniqueDestination(named: cleanTitle + ".md")
        let text = "# \(title.isEmpty ? "Untitled note" : title)\n\n\(body)\n"
        try text.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    func createHighlight(title: String, text: String) throws -> URL {
        let cleanTitle = sanitized(title.isEmpty ? "Web highlight" : title)
        let url = uniqueDestination(named: cleanTitle + ".md")
        try text.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    func createWebMemory(title: String, url: String, body: String? = nil) throws -> URL {
        let cleanTitle = sanitized(title.isEmpty ? "Saved article" : title)
        let destination = uniqueDestination(named: cleanTitle + ".md")
        try "# \(title.isEmpty ? "Saved article" : title)\n\n\(body ?? "")\n\nSource: \(url)\n".write(to: destination, atomically: true, encoding: .utf8)
        return destination
    }

    func updateText(at path: String, text: String) throws {
        let url = URL(fileURLWithPath: path).standardizedFileURL
        let root = capturesURL.standardizedFileURL.path + "/"
        guard url.path.hasPrefix(root), ["md", "txt"].contains(url.pathExtension.lowercased()) else {
            throw CocoaError(.fileWriteNoPermission)
        }
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    func importFiles(_ urls: [URL]) throws -> Int {
        try importFilesReturningURLs(urls).count
    }

    func importFilesReturningURLs(_ urls: [URL]) throws -> [URL] {
        var destinations: [URL] = []
        for source in urls {
            let values = try? source.resourceValues(forKeys: [.isRegularFileKey])
            guard values?.isRegularFile == true else { continue }
            let destination = uniqueDestination(named: source.lastPathComponent)
            try fileManager.copyItem(at: source, to: destination)
            destinations.append(destination)
        }
        return destinations
    }

    func saveImageData(_ data: Data, suggestedName: String?, fileExtension: String) throws -> URL {
        let rawName = suggestedName.map { ($0 as NSString).deletingPathExtension } ?? "Saved image"
        let base = sanitized(rawName)
        let ext = fileExtension.isEmpty ? "png" : fileExtension.lowercased()
        let destination = uniqueDestination(named: "\(base).\(ext)")
        try data.write(to: destination, options: .atomic)
        return destination
    }

    func moveCaptureToTrash(path: String) throws -> Bool {
        let url = URL(fileURLWithPath: path).standardizedFileURL
        let root = capturesURL.standardizedFileURL.path + "/"
        guard url.path.hasPrefix(root), fileManager.fileExists(atPath: url.path) else { return false }
        var trashedURL: NSURL?
        try fileManager.trashItem(at: url, resultingItemURL: &trashedURL)
        return true
    }

    func moveCapturesToTrash(paths: [String]) throws -> Int {
        var moved = 0
        for path in paths {
            if try moveCaptureToTrash(path: path) { moved += 1 }
        }
        return moved
    }

    private func uniqueDestination(named name: String) -> URL {
        let proposed = capturesURL.appendingPathComponent(name)
        guard fileManager.fileExists(atPath: proposed.path) else { return proposed }
        let base = proposed.deletingPathExtension().lastPathComponent
        let ext = proposed.pathExtension
        return capturesURL.appendingPathComponent("\(base)-\(UUID().uuidString.prefix(6)).\(ext)")
    }

    private func sanitized(_ value: String) -> String {
        let forbidden = CharacterSet(charactersIn: "/:")
        return value.components(separatedBy: forbidden).joined(separator: "-").trimmingCharacters(in: .whitespaces)
    }

    private func save(_ index: StoredIndex) {
        cached = index
        let encoder = PropertyListEncoder()
        encoder.outputFormat = .binary
        guard let data = try? encoder.encode(index) else { return }
        try? data.write(to: indexURL, options: .atomic)
    }

    private func scheduleSave() {
        pendingSave?.cancel()
        pendingSave = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(450))
            guard !Task.isCancelled, let self else { return }
            await self.flushPendingSave()
        }
    }

    private func flushPendingSave() {
        save(cached)
    }

    private func collectFiles(in roots: [URL]) -> [URL] {
        var output: [URL] = []
        let keys: [URLResourceKey] = [.isRegularFileKey, .isHiddenKey, .isPackageKey]
        for root in roots {
            guard let enumerator = fileManager.enumerator(at: root, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { continue }
            for case let url as URL in enumerator {
                let values = try? url.resourceValues(forKeys: Set(keys))
                if values?.isRegularFile == true { output.append(url) }
            }
        }
        return output
    }
}
