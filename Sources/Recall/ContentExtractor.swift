import AppKit
import CoreServices
import Foundation
import ImageIO
import PDFKit
import Vision

struct ExtractedContent: Sendable {
    let searchableText: String
    let caption: String?
    let tags: [String]
}

enum ContentExtractor {
    // Bump this whenever Apple analysis changes so existing captures are upgraded once.
    static let metadataVersion = 4
    static let imageExtensions = Set(["png", "jpg", "jpeg", "heic", "gif", "tiff", "bmp", "webp", "avif"])
    static let textExtensions = Set(["txt", "md", "rtf", "csv", "json", "yaml", "yml", "xml", "html", "swift", "js", "ts", "py", "css"])
    static let documentExtensions = Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pages", "numbers", "key"])
    static let videoExtensions = Set(["mp4", "mov", "m4v", "webm"])
    static let supportedExtensions = imageExtensions.union(textExtensions).union(documentExtensions).union(videoExtensions)

    static func looksLikeQuote(_ text: String) -> Bool {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.count >= 12, value.count <= 700 else { return false }
        let quoted = value.hasPrefix("\"") || value.hasPrefix("“") || value.hasPrefix("‘")
        let attributed = value.range(of: #"(?:\n|\s)[—–-]\s*[A-Z][A-Za-z .'-]{2,60}$"#, options: .regularExpression) != nil
        return quoted || attributed || value.lowercased().contains(" once wrote")
    }

    static func extract(from url: URL) -> ExtractedContent {
        let ext = url.pathExtension.lowercased()
        if ext == "pdf" { return plain(pdfText(url)) }
        if imageExtensions.contains(ext) { return analyzeImage(url) }
        if videoExtensions.contains(ext) { return plain(spotlightText(url)) }
        if textExtensions.contains(ext) {
            return plain((try? String(contentsOf: url, encoding: .utf8)).map { String($0.prefix(30_000)) } ?? "")
        }
        return plain(spotlightText(url))
    }

    static func text(from url: URL) -> String { extract(from: url).searchableText }

    private static func plain(_ text: String) -> ExtractedContent {
        ExtractedContent(searchableText: text, caption: nil, tags: [])
    }

    private static func pdfText(_ url: URL) -> String {
        guard let document = PDFDocument(url: url) else { return "" }
        var output = ""
        for pageIndex in 0..<min(document.pageCount, 30) {
            if let pageText = document.page(at: pageIndex)?.string {
                output += " " + pageText
                if output.count >= 30_000 { break }
            }
        }
        return String(output.prefix(30_000))
    }

    private static func analyzeImage(_ url: URL) -> ExtractedContent {
        // A bounded decode is materially cooler than converting a full-resolution image
        // to TIFF. Vision still gets enough detail for labels and accurate OCR.
        guard let cgImage = analysisImage(url, maxPixelSize: 1800) else {
            return ExtractedContent(searchableText: "", caption: "Image", tags: ["image"])
        }

        let textRequest = VNRecognizeTextRequest()
        textRequest.recognitionLevel = .accurate
        textRequest.usesLanguageCorrection = true
        textRequest.minimumTextHeight = 0.012

        let classifyRequest = VNClassifyImageRequest()
        classifyRequest.revision = VNClassifyImageRequest.supportedRevisions.max() ?? VNClassifyImageRequest.defaultRevision

        let animalRequest = VNRecognizeAnimalsRequest()
        animalRequest.revision = VNRecognizeAnimalsRequest.supportedRevisions.max() ?? VNRecognizeAnimalsRequest.defaultRevision

        let faceRequest = VNDetectFaceRectanglesRequest()
        let humanRequest = VNDetectHumanRectanglesRequest()
        humanRequest.upperBodyOnly = false

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        try? handler.perform([textRequest, classifyRequest, animalRequest, faceRequest, humanRequest])

        let recognizedText = (textRequest.results ?? [])
            .compactMap { $0.topCandidates(1).first?.string }

        var weightedTags: [(String, Float)] = []
        for result in (classifyRequest.results ?? []).prefix(40) where result.confidence >= 0.035 {
            for label in splitIdentifier(result.identifier) { weightedTags.append((label, result.confidence)) }
        }
        for label in (animalRequest.results ?? []).flatMap(\.labels) where label.confidence >= 0.08 {
            for value in splitIdentifier(label.identifier) { weightedTags.append((value, label.confidence + 0.35)) }
        }
        if !(faceRequest.results ?? []).isEmpty { weightedTags.append(("face", 0.9)) }
        if !(humanRequest.results ?? []).isEmpty {
            weightedTags.append(("person", 0.95))
            weightedTags.append(("people", 0.9))
        }

        let colorTags = dominantColorWords(cgImage)
        for color in colorTags { weightedTags.append((color, 0.25)) }
        let tags = uniqueRankedTags(weightedTags).prefix(28).map { $0 }
        let subjectTags = tags.filter { !colorTags.contains($0) && !["image", "photo", "photography"].contains($0) }
        let caption: String
        if let subject = subjectTags.first {
            let detail = subjectTags.dropFirst().prefix(2).joined(separator: ", ")
            let color = colorTags.first.map { "\($0) " } ?? ""
            caption = detail.isEmpty ? "A \(color)\(subject) image" : "A \(color)\(subject) image featuring \(detail)"
        } else if !recognizedText.isEmpty {
            caption = "An image containing text"
        } else {
            caption = "An image"
        }

        let searchable = (recognizedText + tags + [caption]).joined(separator: " ")
        return ExtractedContent(searchableText: String(searchable.prefix(30_000)), caption: caption, tags: tags)
    }

    private static func analysisImage(_ url: URL, maxPixelSize: Int) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
            kCGImageSourceShouldCacheImmediately: true
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    private static func splitIdentifier(_ identifier: String) -> [String] {
        identifier.lowercased()
            .components(separatedBy: CharacterSet(charactersIn: ",/;_"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.count > 1 }
    }

    private static func uniqueRankedTags(_ values: [(String, Float)]) -> [String] {
        var best: [String: Float] = [:]
        for (raw, confidence) in values {
            let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty else { continue }
            best[value] = max(best[value] ?? 0, confidence)
        }
        return best.sorted {
            if $0.value == $1.value { return $0.key < $1.key }
            return $0.value > $1.value
        }.map(\.key)
    }

    private static func dominantColorWords(_ cgImage: CGImage) -> [String] {
        let bitmap = NSBitmapImageRep(cgImage: cgImage)
        let stepX = max(1, bitmap.pixelsWide / 14)
        let stepY = max(1, bitmap.pixelsHigh / 14)
        var histogram: [String: Int] = [:]
        for x in stride(from: 0, to: bitmap.pixelsWide, by: stepX) {
            for y in stride(from: 0, to: bitmap.pixelsHigh, by: stepY) {
                guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                var hue: CGFloat = 0, saturation: CGFloat = 0, brightness: CGFloat = 0, alpha: CGFloat = 0
                color.getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: &alpha)
                histogram[colorName(hue: hue * 360, saturation: saturation, brightness: brightness), default: 0] += 1
            }
        }
        let total = histogram.values.reduce(0, +)
        guard total > 0 else { return [] }
        return histogram.sorted { $0.value > $1.value }
            .filter { Double($0.value) / Double(total) >= 0.045 }
            .prefix(5).map(\.key)
    }

    private static func colorName(hue: CGFloat, saturation: CGFloat, brightness: CGFloat) -> String {
        if brightness < 0.16 { return "black" }
        if saturation < 0.11 {
            if brightness > 0.88 { return "white" }
            return brightness < 0.42 ? "dark gray" : "gray"
        }
        switch hue {
        case 0..<15, 345...360: return "red"
        case 15..<45: return brightness < 0.48 ? "brown" : "orange"
        case 45..<70: return "yellow"
        case 70..<165: return "green"
        case 165..<195: return "teal"
        case 195..<255: return "blue"
        case 255..<290: return "purple"
        case 290..<345: return "pink"
        default: return "colorful"
        }
    }

    private static func spotlightText(_ url: URL) -> String {
        guard let item = MDItemCreate(kCFAllocatorDefault, url.path as CFString),
              let value = MDItemCopyAttribute(item, kMDItemTextContent) as? String else { return "" }
        return String(value.prefix(30_000))
    }
}
