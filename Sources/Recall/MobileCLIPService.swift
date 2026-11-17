import AppKit
import CoreML
import Foundation
import ImageIO

final class MobileCLIPService: @unchecked Sendable {
    static let shared = MobileCLIPService()

    private let lock = NSLock()
    private var imageModel: MLModel?
    private var textModel: MLModel?
    private var tokenizer: CLIPTokenizer?
    private var attemptedLoad = false
    private var textCache: [String: [Double]] = [:]
    private var textCacheOrder: [String] = []
    private(set) var diagnostic = "Not loaded"

    var isAvailable: Bool {
        lock.lock(); defer { lock.unlock() }
        loadIfNeeded()
        return imageModel != nil && textModel != nil && tokenizer != nil
    }

    func imageEmbedding(for url: URL) -> [Double]? {
        lock.lock(); defer { lock.unlock() }
        loadIfNeeded()
        guard let model = imageModel,
              let description = model.modelDescription.inputDescriptionsByName["image"],
              let constraint = description.imageConstraint,
              let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
              let value = try? MLFeatureValue(cgImage: image, constraint: constraint, options: nil),
              let provider = try? MLDictionaryFeatureProvider(dictionary: ["image": value]),
              let result = try? model.prediction(from: provider),
              let output = result.featureValue(for: "final_emb_1")?.multiArrayValue else { return nil }
        return normalized(output)
    }

    func textEmbedding(for text: String) -> [Double]? {
        lock.lock(); defer { lock.unlock() }
        let cacheKey = text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if let cached = textCache[cacheKey] { return cached }
        loadIfNeeded()
        guard let model = textModel, let tokenizer,
              let inputDescription = model.modelDescription.inputDescriptionsByName["text"],
              let constraint = inputDescription.multiArrayConstraint else { return nil }
        let shape = constraint.shape
        guard let input = try? MLMultiArray(shape: shape, dataType: constraint.dataType) else { return nil }
        let ids = tokenizer.encode(text, length: input.count)
        for index in 0..<input.count { input[index] = NSNumber(value: ids[index]) }
        guard let provider = try? MLDictionaryFeatureProvider(dictionary: ["text": MLFeatureValue(multiArray: input)]),
              let result = try? model.prediction(from: provider),
              let output = result.featureValue(for: "final_emb_1")?.multiArrayValue else { return nil }
        let vector = normalized(output)
        textCache[cacheKey] = vector
        textCacheOrder.removeAll { $0 == cacheKey }
        textCacheOrder.append(cacheKey)
        if textCacheOrder.count > 64, let oldest = textCacheOrder.first {
            textCacheOrder.removeFirst()
            textCache.removeValue(forKey: oldest)
        }
        return vector
    }

    private func loadIfNeeded() {
        guard !attemptedLoad else { return }
        attemptedLoad = true
        guard let root = modelRoot() else { diagnostic = "Model resources not found"; return }
        tokenizer = CLIPTokenizer(
            vocabularyURL: root.appendingPathComponent("Tokenizer/vocab.json"),
            mergesURL: root.appendingPathComponent("Tokenizer/merges.txt")
        )
        imageModel = loadModel(package: root.appendingPathComponent("mobileclip_s0_image.mlpackage"), name: "mobileclip_s0_image")
        textModel = loadModel(package: root.appendingPathComponent("mobileclip_s0_text.mlpackage"), name: "mobileclip_s0_text")
        if tokenizer != nil, imageModel != nil, textModel != nil { diagnostic = "Ready" }
        else if tokenizer == nil { diagnostic = "Tokenizer could not be loaded" }
        else if diagnostic == "Not loaded" { diagnostic = imageModel == nil ? "Image encoder could not be loaded" : "Text encoder could not be loaded" }
    }

    private func modelRoot() -> URL? {
        let candidates = [
            Bundle.main.resourceURL?.appendingPathComponent("Models/MobileCLIP"),
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("Models/MobileCLIP")
        ].compactMap { $0 }
        return candidates.first { FileManager.default.fileExists(atPath: $0.appendingPathComponent("mobileclip_s0_image.mlpackage/Manifest.json").path) }
    }

    private func loadModel(package: URL, name: String) -> MLModel? {
        let manager = FileManager.default
        let base = manager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Recall/CompiledModels", isDirectory: true)
        let cached = base.appendingPathComponent(name + ".mlmodelc", isDirectory: true)
        let configuration = MLModelConfiguration()
        // Avoid keeping a large GPU working set alive in a background library app.
        configuration.computeUnits = .cpuAndNeuralEngine
        if manager.fileExists(atPath: cached.path) {
            do { return try MLModel(contentsOf: cached, configuration: configuration) }
            catch { try? manager.removeItem(at: cached) }
        }
        let temporary: URL
        do { temporary = try MLModel.compileModel(at: package) }
        catch { diagnostic = "Compile \(name): \(error.localizedDescription)"; return nil }
        try? manager.createDirectory(at: base, withIntermediateDirectories: true)
        try? manager.removeItem(at: cached)
        do {
            try manager.copyItem(at: temporary, to: cached)
            return try MLModel(contentsOf: cached, configuration: configuration)
        } catch {
            do { return try MLModel(contentsOf: temporary, configuration: configuration) }
            catch { diagnostic = "Load \(name): \(error.localizedDescription)"; return nil }
        }
    }

    private func normalized(_ array: MLMultiArray) -> [Double] {
        let values = (0..<array.count).map { array[$0].doubleValue }
        let magnitude = sqrt(values.reduce(0) { $0 + $1 * $1 })
        guard magnitude > 0 else { return [] }
        return values.map { $0 / magnitude }
    }
}

private struct CLIPTokenizer {
    private let vocabulary: [String: Int32]
    private let ranks: [String: Int]
    private let byteEncoder: [UInt8: Character]
    private let expression: NSRegularExpression
    private let startToken: Int32
    private let endToken: Int32

    init?(vocabularyURL: URL, mergesURL: URL) {
        guard let data = try? Data(contentsOf: vocabularyURL),
              let rawVocabulary = try? JSONDecoder().decode([String: Int32].self, from: data),
              let mergeText = try? String(contentsOf: mergesURL, encoding: .utf8),
              let regex = try? NSRegularExpression(
                pattern: #"<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]+|[^\s\p{L}\p{N}]+"#,
                options: [.caseInsensitive]
              ),
              let start = rawVocabulary["<|startoftext|>"],
              let end = rawVocabulary["<|endoftext|>"] else { return nil }
        vocabulary = rawVocabulary
        expression = regex
        startToken = start
        endToken = end
        byteEncoder = Self.makeByteEncoder()
        let lines = mergeText.split(whereSeparator: \.isNewline).dropFirst()
        ranks = Dictionary(uniqueKeysWithValues: lines.enumerated().compactMap { index, line in
            let parts = line.split(separator: " ")
            return parts.count == 2 ? (parts[0] + " " + parts[1], index) : nil
        })
    }

    func encode(_ input: String, length: Int) -> [Int32] {
        let cleaned = input.lowercased().replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let range = NSRange(cleaned.startIndex..<cleaned.endIndex, in: cleaned)
        var tokens: [Int32] = [startToken]
        for match in expression.matches(in: cleaned, range: range) {
            guard let swiftRange = Range(match.range, in: cleaned) else { continue }
            let encoded = cleaned[swiftRange].utf8.compactMap { byteEncoder[$0] }.map(String.init).joined()
            tokens.append(contentsOf: bpe(encoded).compactMap { vocabulary[$0] })
            if tokens.count >= length - 1 { break }
        }
        tokens = Array(tokens.prefix(max(1, length - 1)))
        tokens.append(endToken)
        if tokens.count < length { tokens.append(contentsOf: repeatElement(0, count: length - tokens.count)) }
        return Array(tokens.prefix(length))
    }

    private func bpe(_ token: String) -> [String] {
        var word = token.map(String.init)
        guard !word.isEmpty else { return [] }
        word[word.count - 1] += "</w>"
        while word.count > 1 {
            var bestIndex: Int?
            var bestRank = Int.max
            for index in 0..<(word.count - 1) {
                let key = word[index] + " " + word[index + 1]
                if let rank = ranks[key], rank < bestRank { bestRank = rank; bestIndex = index }
            }
            guard let index = bestIndex else { break }
            word.replaceSubrange(index...index + 1, with: [word[index] + word[index + 1]])
        }
        return word
    }

    private static func makeByteEncoder() -> [UInt8: Character] {
        var bytes = Array(33...126) + Array(161...172) + Array(174...255)
        var scalars = bytes
        var extra = 0
        for byte in 0...255 where !bytes.contains(byte) {
            bytes.append(byte)
            scalars.append(256 + extra)
            extra += 1
        }
        return Dictionary(uniqueKeysWithValues: zip(bytes, scalars).compactMap { byte, scalar in
            UnicodeScalar(scalar).map { (UInt8(byte), Character(String($0))) }
        })
    }
}
