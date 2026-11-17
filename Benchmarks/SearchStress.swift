import Foundation
import Darwin

@main
struct SearchStress {
    static func main() throws {
        let sizes = [1_000, 10_000, 25_000]
        let queries = ["red sports car", "quiet forest", "design article", "elephant", "blue shirt", "type:article creativity"]
        for count in sizes {
            let files = makeFiles(count)
            let encodedStart = ContinuousClock.now
            let data = try PropertyListEncoder().encode(StoredIndex(files: files))
            let encodeTime = encodedStart.duration(to: .now)
            let decodeStart = ContinuousClock.now
            _ = try PropertyListDecoder().decode(StoredIndex.self, from: data)
            let decodeTime = decodeStart.duration(to: .now)

            // Warm caches once, then emulate sustained interactive use.
            _ = SemanticSearch.search(queries[0], in: files, includeVisual: false)
            let searchStart = ContinuousClock.now
            var returned = 0
            let iterations = 20
            for index in 0..<iterations {
                returned += SemanticSearch.search(queries[index % queries.count], in: files, includeVisual: false).count
            }
            let searchTime = searchStart.duration(to: .now)
            let averageMS = Double(searchTime.components.seconds) * 1_000 / Double(iterations)
                + Double(searchTime.components.attoseconds) / 1e15 / Double(iterations)
            let indexMB = String(format: "%.2f", Double(data.count) / 1_048_576)
            let searchMS = String(format: "%.2f", averageMS)
            var usage = rusage()
            getrusage(RUSAGE_SELF, &usage)
            let peakMB = Double(usage.ru_maxrss) / 1_048_576
            print("COUNT=\(count) INDEX_MB=\(indexMB) ENCODE=\(encodeTime) DECODE=\(decodeTime) SEARCH_AVG_MS=\(searchMS) PEAK_RSS_MB=\(String(format: "%.1f", peakMB)) RETURNED=\(returned)")
        }
        let visualFiles = makeFiles(10_000)
        let visualStart = ContinuousClock.now
        let visualResults = SemanticSearch.search("red sports car", in: visualFiles, includeVisual: true)
        print("VISUAL_10000=\(visualStart.duration(to: .now)) RESULTS=\(visualResults.count)")
    }

    static func makeFiles(_ count: Int) -> [IndexedFile] {
        let subjects = ["red sports car porsche road", "quiet green forest sunlight", "elephant wildlife africa", "blue shirt fashion cotton", "creative design article ideas", "minimal interior chair"]
        return (0..<count).map { index in
            let text = subjects[index % subjects.count] + " memory number \(index)"
            return IndexedFile(
                path: "/private/tmp/recall-stress/item-\(index).jpg",
                name: "item-\(index).jpg",
                kind: "JPG",
                modifiedAt: Date(timeIntervalSince1970: Double(1_700_000_000 + index)),
                byteSize: 125_000,
                searchableText: text,
                embedding: deterministicVector(index),
                aiMetadata: text,
                aiCaption: subjects[index % subjects.count],
                aiTags: Array(subjects[index % subjects.count].split(separator: " ").map(String.init)),
                metadataVersion: 4,
                visualEmbedding: deterministicVector(index + 7),
                contentType: index % 11 == 0 ? "Article" : "Image"
            )
        }
    }

    static func deterministicVector(_ seed: Int) -> [Double] {
        (0..<64).map { dimension in
            let raw = (seed &* 1_103_515_245 &+ dimension &* 12_345) & 0x7fffffff
            return Double(raw % 10_000) / 10_000
        }
    }
}
