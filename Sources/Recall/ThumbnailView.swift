@preconcurrency import QuickLookThumbnailing
import SwiftUI

@MainActor
struct ThumbnailView: View {
    let url: URL
    var contentMode: ContentMode = .fit
    var requestedSize: CGSize = CGSize(width: 600, height: 600)
    @State private var image: NSImage?

    var body: some View {
        Group {
            if let image { Image(nsImage: image).resizable().aspectRatio(contentMode: contentMode) }
            else { Image(systemName: "doc").font(.system(size: 28)).foregroundStyle(.secondary) }
        }
        .task(id: url) {
            image = nil
            let scale = NSScreen.main?.backingScaleFactor ?? 2
            if ContentExtractor.imageExtensions.contains(url.pathExtension.lowercased()),
               let thumbnail = await ThumbnailCache.shared.image(for: url, size: requestedSize, scale: scale) {
                guard !Task.isCancelled else { return }
                image = NSImage(cgImage: thumbnail, size: NSSize(width: thumbnail.width, height: thumbnail.height))
                return
            }
            guard !Task.isCancelled else { return }
            let request = QLThumbnailGenerator.Request(fileAt: url, size: requestedSize, scale: scale, representationTypes: .thumbnail)
            let fallback = try? await QLThumbnailGenerator.shared.generateBestRepresentation(for: request).nsImage
            guard !Task.isCancelled else { return }
            image = fallback
        }
    }
}
