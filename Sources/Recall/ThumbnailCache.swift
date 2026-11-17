import AppKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

final class ThumbnailCache: @unchecked Sendable {
    static let shared = ThumbnailCache()

    private let memory = NSCache<NSString, CGImage>()
    private let fileManager = FileManager.default
    private let directory: URL
    private let ratioLock = NSLock()
    private var ratios: [String: CGFloat] = [:]
    private let workLock = NSLock()
    private var inFlight: [String: Task<CGImage?, Never>] = [:]

    private init() {
        directory = fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Recall/Thumbnails", isDirectory: true)
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        memory.countLimit = 48
        memory.totalCostLimit = 48 * 1_024 * 1_024
    }

    func image(for sourceURL: URL, size: CGSize, scale: CGFloat) async -> CGImage? {
        // Gallery thumbnails do not benefit from retina-sized source images. The
        // view still renders at native scale, while decoding ~60% fewer pixels.
        let maxPixels = max(160, min(560, Int(max(size.width, size.height) * min(1.20, max(1, scale)))))
        let key = cacheKey(for: sourceURL, maxPixels: maxPixels)
        if let cached = memory.object(forKey: key as NSString) { return cached }
        let diskURL = directory.appendingPathComponent(key).appendingPathExtension("jpg")

        if let existing = existingTask(for: key) { return await existing.value }
        let proposed = Task.detached(priority: .utility) { () -> CGImage? in
            if let cachedSource = CGImageSourceCreateWithURL(diskURL as CFURL, nil),
               let cachedImage = CGImageSourceCreateImageAtIndex(cachedSource, 0, nil) { return cachedImage }
            guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil) else { return nil }
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maxPixels,
                kCGImageSourceShouldCacheImmediately: true
            ]
            guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
            if let destination = CGImageDestinationCreateWithURL(diskURL as CFURL, UTType.jpeg.identifier as CFString, 1, nil) {
                CGImageDestinationAddImage(destination, thumbnail, [kCGImageDestinationLossyCompressionQuality: 0.82] as CFDictionary)
                CGImageDestinationFinalize(destination)
            }
            return thumbnail
        }
        let task = register(proposed, for: key)
        let result = await task.value
        removeTask(for: key, matching: task)

        if let result {
            let cost = max(1, result.width * result.height * 4)
            memory.setObject(result, forKey: key as NSString, cost: cost)
        }
        return result
    }

    private func existingTask(for key: String) -> Task<CGImage?, Never>? {
        workLock.withLock { inFlight[key] }
    }

    private func register(_ task: Task<CGImage?, Never>, for key: String) -> Task<CGImage?, Never> {
        workLock.withLock {
            if let existing = inFlight[key] { return existing }
            inFlight[key] = task
            return task
        }
    }

    private func removeTask(for key: String, matching task: Task<CGImage?, Never>) {
        _ = workLock.withLock { inFlight.removeValue(forKey: key) }
    }

    func aspectRatio(for url: URL) -> CGFloat? {
        ratioLock.lock()
        if let cached = ratios[url.path] {
            ratioLock.unlock()
            return cached
        }
        ratioLock.unlock()
        guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue,
              let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue,
              width > 0, height > 0 else { return nil }
        let ratio = CGFloat(height / width)
        ratioLock.lock()
        ratios[url.path] = ratio
        ratioLock.unlock()
        return ratio
    }

    private func cacheKey(for url: URL, maxPixels: Int) -> String {
        let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        let modified = Int64((values?.contentModificationDate?.timeIntervalSince1970 ?? 0).rounded())
        let size = values?.fileSize ?? 0
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in url.path.utf8 {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return String(format: "%016llx-%lld-%d-%d", hash, modified, size, maxPixels)
    }
}
