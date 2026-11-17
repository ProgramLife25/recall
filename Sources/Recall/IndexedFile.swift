import Foundation

struct IndexedFile: Codable, Identifiable, Hashable, Sendable {
    var id: String { path }
    let path: String
    let name: String
    let kind: String
    let modifiedAt: Date
    let byteSize: Int64
    let searchableText: String
    let embedding: [Double]
    var aiMetadata: String? = nil
    var aiCaption: String? = nil
    var aiTags: [String]? = nil
    var metadataVersion: Int? = nil
    var visualEmbedding: [Double]? = nil
    var sourceURL: String? = nil
    var detectedPrice: String? = nil
    var sourceTitle: String? = nil
    var sourceSite: String? = nil
    var contentType: String? = nil
    var articleText: String? = nil
    var articleHTML: String? = nil

    var url: URL { URL(fileURLWithPath: path) }
}

struct SearchResult: Identifiable, Sendable {
    let file: IndexedFile
    let score: Double
    var id: String { file.id }
}

struct StoredIndex: Codable, Sendable {
    var folders: [String] = []
    var files: [IndexedFile] = []
    var favoritePaths: [String]? = nil
    var customTags: [String: [String]]? = nil
    var itemNotes: [String: String]? = nil
    var spaces: [String: [String]]? = nil
    var sourceURLs: [String: String]? = nil
    var detectedPrices: [String: String]? = nil
    var sourceTitles: [String: String]? = nil
    var sourceSites: [String: String]? = nil
    var contentTypes: [String: String]? = nil
    var articleTexts: [String: String]? = nil
    var articleHTMLByPath: [String: String]? = nil
}
