import AppKit
import Foundation
import UniformTypeIdentifiers

private struct WebCaptureMetadata {
    var title: String?
    var site: String?
    var price: String?
    var contentType: String?
    var articleText: String?
    var articleHTML: String?
}

@MainActor
final class AppModel: ObservableObject {
    @Published var folders: [String] = []
    @Published var files: [IndexedFile] = []
    @Published var results: [SearchResult] = []
    @Published var query = "" { didSet { scheduleSearch() } }
    @Published var isIndexing = false
    @Published var progressText = ""
    @Published var selectedID: String?
    @Published var favoritePaths = Set<String>()
    @Published var customTags: [String: [String]] = [:]
    @Published var itemNotes: [String: String] = [:]
    @Published var spaces: [String: [String]] = [:]
    @Published private(set) var isLoaded = false
    @Published var captureMessage = "" {
        didSet {
            guard !captureMessage.isEmpty else { return }
            let message = captureMessage
            Task {
                try? await Task.sleep(for: .seconds(3))
                if captureMessage == message { captureMessage = "" }
            }
        }
    }

    private let store = IndexStore()
    private var searchTask: Task<Void, Never>?
    private var searchWorker: Task<[SearchResult], Never>?

    func openSafariBookmarkletInstaller() {
        let bundled = Bundle.main.resourceURL?
            .appendingPathComponent("SafariBookmarklet", isDirectory: true)
            .appendingPathComponent("install.html")
        let development = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("SafariBookmarklet/install.html")
        guard let url = [bundled, development].compactMap({ $0 }).first(where: {
            FileManager.default.fileExists(atPath: $0.path)
        }) else {
            captureMessage = "Safari setup page is missing"
            return
        }
        NSWorkspace.shared.open(url)
    }

    func load() async {
        var saved = await store.load()
        let resetKey = "didClearLegacyIndexedFoldersV2"
        if !UserDefaults.standard.bool(forKey: resetKey) {
            UserDefaults.standard.set(true, forKey: resetKey)
            saved.folders = []
            saved.files = await store.rebuild(folders: [], previous: saved.files) { _, _ in }
        }
        // Present the persisted canvas directly. Imports and deletes already update the
        // index, so rebuilding every unchanged item at launch only wastes work.
        saved.folders = []
        folders = []
        // Captures are managed by Recall, so stat-ing every path on every launch
        // is wasted synchronous I/O and becomes visible with large libraries.
        files = saved.files
        for index in files.indices {
            files[index].sourceTitle = cleanedCaptureTitle(files[index].sourceTitle)
            if let source = files[index].sourceURL, let pageURL = URL(string: source) {
                files[index].detectedPrice = cleanedCapturePrice(files[index].detectedPrice, pageURL: pageURL)
            }
        }
        favoritePaths = Set(saved.favoritePaths ?? [])
        customTags = saved.customTags ?? [:]
        itemNotes = saved.itemNotes ?? [:]
        spaces = saved.spaces ?? ["Top of Mind": Array(favoritePaths)]
        if spaces.isEmpty { spaces = ["Top of Mind": []] }
        isLoaded = true
        scheduleSearch(immediately: true)
    }

    func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = true
        panel.prompt = "Index"
        panel.begin { [weak self] response in
            guard response == .OK, let self else { return }
            for url in panel.urls where !self.folders.contains(url.path) { self.folders.append(url.path) }
            self.reindex()
        }
    }

    func removeFolder(_ path: String) {
        folders.removeAll { $0 == path }
        reindex()
    }

    func chooseFiles(addToSpace spaceName: String? = nil) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = true
        panel.prompt = "Save to Recall"
        panel.begin { [weak self] response in
            guard response == .OK else { return }
            self?.importFiles(panel.urls, addToSpace: spaceName)
        }
    }

    func importFiles(_ urls: [URL], addToSpace spaceName: String? = nil) {
        guard !urls.isEmpty else { return }
        Task {
            do {
                let destinations = try await store.importFilesReturningURLs(urls)
                let count = destinations.count
                if let spaceName, count > 0 {
                    var paths = spaces[spaceName] ?? []
                    paths.append(contentsOf: destinations.map(\.path))
                    spaces[spaceName] = Array(Set(paths))
                    await store.setSpaces(spaces)
                }
                captureMessage = count == 1 ? "Saved 1 item" : "Saved \(count) items"
                reindex(analyzeNewImages: true)
            } catch {
                captureMessage = "Couldn’t save that item"
            }
        }
    }

    func importRemoteImage(
        _ url: URL,
        suggestedName: String? = nil,
        sourcePageURL: URL? = nil,
        capturedTitle: String? = nil,
        capturedPrice: String? = nil,
        capturedSite: String? = nil,
        capturedContentType: String? = nil
    ) {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return }
        Task {
            do {
                let pageURL = sourcePageURL ?? url
                let preferredURL = highestQualityPinterestURL(from: url)
                var request = URLRequest(url: preferredURL)
                request.setValue("image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.5", forHTTPHeaderField: "Accept")
                request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Safari/537.36", forHTTPHeaderField: "User-Agent")
                var (data, response) = try await URLSession.shared.data(for: request)
                var sourceURL = preferredURL
                guard !data.isEmpty else { throw URLError(.zeroByteResource) }
                var mime = response.mimeType ?? ""
                var webMetadata: WebCaptureMetadata
                if capturedTitle != nil || capturedPrice != nil || capturedSite != nil {
                    let fetched = capturedPrice == nil && sourcePageURL != nil ? await self.webMetadata(from: pageURL) : WebCaptureMetadata()
                    let capturedIsAuthoritative = ["Article", "Video", "Product"].contains(capturedContentType ?? "")
                    let finalType = capturedIsAuthoritative ? capturedContentType : (fetched.contentType ?? capturedContentType)
                    webMetadata = WebCaptureMetadata(
                        title: capturedTitle ?? fetched.title,
                        site: capturedSite ?? fetched.site ?? pageURL.host,
                        price: finalType == "Video" ? nil : (capturedPrice ?? fetched.price),
                        contentType: finalType ?? (capturedPrice == nil ? "Web image" : "Product"),
                        articleText: fetched.articleText,
                        articleHTML: fetched.articleHTML
                    )
                } else {
                    webMetadata = sourcePageURL == nil ? WebCaptureMetadata(site: pageURL.host) : await self.webMetadata(from: pageURL)
                }

                if !mime.lowercased().hasPrefix("image/") && !ContentExtractor.imageExtensions.contains(sourceURL.pathExtension.lowercased()) {
                    guard let html = String(data: data, encoding: .utf8), let embeddedURL = embeddedImageURL(in: html) else {
                        throw URLError(.cannotDecodeContentData)
                    }
                    webMetadata = detectedWebMetadata(in: html, url: pageURL)
                    let preferredEmbeddedURL = highestQualityPinterestURL(from: embeddedURL)
                    var imageRequest = URLRequest(url: preferredEmbeddedURL)
                    imageRequest.setValue("image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.5", forHTTPHeaderField: "Accept")
                    imageRequest.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Safari/537.36", forHTTPHeaderField: "User-Agent")
                    (data, response) = try await URLSession.shared.data(for: imageRequest)
                    sourceURL = preferredEmbeddedURL
                    mime = response.mimeType ?? ""
                    guard mime.lowercased().hasPrefix("image/") || ContentExtractor.imageExtensions.contains(sourceURL.pathExtension.lowercased()) else {
                        throw URLError(.cannotDecodeContentData)
                    }
                }
                let ext: String
                if let type = UTType(mimeType: mime), let preferred = type.preferredFilenameExtension { ext = preferred }
                else if !sourceURL.pathExtension.isEmpty { ext = sourceURL.pathExtension }
                else { ext = "jpg" }
                let savedURL = try await store.saveImageData(data, suggestedName: suggestedName ?? sourceURL.deletingPathExtension().lastPathComponent, fileExtension: ext)
                await store.setWebMetadata(sourceURL: pageURL.absoluteString, price: webMetadata.price, title: webMetadata.title, site: webMetadata.site, contentType: webMetadata.contentType, articleText: webMetadata.articleText, articleHTML: webMetadata.articleHTML, for: savedURL.path)
                captureMessage = "Image saved • analyzing on device"
                reindex(analyzeNewImages: true)
            } catch {
                captureMessage = "Couldn’t download that image"
            }
        }
    }

    func importExtensionCapture(_ url: URL) {
        guard url.scheme?.lowercased() == "recall", url.host?.lowercased() == "save",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        let values = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).compactMap { item in
            item.value.map { (item.name, $0) }
        })
        if let selectedText = values["text"]?
            .replacingOccurrences(of: "+", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines), !selectedText.isEmpty {
            if values["silent"] == "1" { hideRecallAndReturnToSafari() }
            saveWebHighlight(
                text: String(selectedText.prefix(6_000)),
                title: cleanedCaptureTitle(values["title"]) ?? "Web highlight",
                sourceURL: values["url"],
                site: values["site"]
            )
            return
        }
        guard let pageValue = values["url"], let pageURL = URL(string: pageValue) else {
            captureMessage = "Safari couldn’t read this page"
            return
        }
        let title = cleanedCaptureTitle(values["title"])
        let price = cleanedCapturePrice(values["price"], pageURL: pageURL)
        if values["silent"] == "1" {
            hideRecallAndReturnToSafari()
        }
        // An article is a document, not merely its hero image. Always run the
        // reader extraction path even when the page advertises an og:image.
        if values["type"] == "Article" {
            saveWebPage(pageURL, title: title, site: values["site"], capturedType: "Article")
            return
        }
        guard let imageValue = values["image"], let imageURL = URL(string: imageValue) else {
            saveWebPage(pageURL, title: title, site: values["site"], capturedType: values["type"])
            return
        }
        captureMessage = "Saving from Safari…"
        importRemoteImage(
            imageURL,
            suggestedName: title,
            sourcePageURL: pageURL,
            capturedTitle: title,
            capturedPrice: price,
            capturedSite: values["site"],
            capturedContentType: values["type"]
        )
    }

    private func saveWebHighlight(text: String, title: String, sourceURL: String?, site: String?) {
        Task {
            do {
                let savedURL = try await store.createHighlight(title: title, text: text)
                if let sourceURL {
                    let pageContext = "\(title) \(sourceURL)".lowercased()
                    let isQuote = ContentExtractor.looksLikeQuote(text)
                        || pageContext.range(of: #"(?:^|[/\\s_-])quotes?(?:[/\\s_?-]|$)"#, options: .regularExpression) != nil
                    await store.setWebMetadata(
                        sourceURL: sourceURL,
                        price: nil,
                        title: title,
                        site: site,
                        contentType: isQuote ? "Quote" : "Highlight",
                        for: savedURL.path
                    )
                }
                captureMessage = "Highlight saved"
                reindex()
            } catch {
                captureMessage = "Couldn’t save that highlight"
            }
        }
    }

    private func saveWebPage(_ pageURL: URL, title: String?, site: String?, capturedType: String?) {
        Task {
            let metadata = await webMetadata(from: pageURL)
            let finalTitle = metadata.title ?? title ?? pageURL.host ?? "Saved webpage"
            let finalType = capturedType == "Article" ? "Article" : (metadata.contentType ?? capturedType ?? "Web page")
            do {
                let savedURL = try await store.createWebMemory(title: finalTitle, url: pageURL.absoluteString, body: metadata.articleText)
                await store.setWebMetadata(
                    sourceURL: pageURL.absoluteString,
                    price: finalType == "Video" ? nil : metadata.price,
                    title: finalTitle,
                    site: metadata.site ?? site,
                    contentType: finalType,
                    articleText: metadata.articleText,
                    articleHTML: metadata.articleHTML,
                    for: savedURL.path
                )
                captureMessage = finalType == "Article" ? "Article saved" : "Webpage saved"
                reindex()
            } catch { captureMessage = "Couldn’t save this webpage" }
        }
    }

    private func hideRecallAndReturnToSafari() {
        NSApp.windows.forEach { $0.orderOut(nil) }
        NSApp.hide(nil)
        if let safari = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Safari").first {
            safari.activate(options: [.activateAllWindows])
        }
    }

    private func cleanedCaptureTitle(_ value: String?) -> String? {
        guard let value else { return nil }
        let cleaned = value
            .replacingOccurrences(of: "+", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? nil : String(cleaned.prefix(240))
    }

    private func cleanedCapturePrice(_ value: String?, pageURL: URL) -> String? {
        guard let value, value.rangeOfCharacter(from: .decimalDigits) != nil else { return nil }
        let cleaned = value.replacingOccurrences(of: "+", with: " ")
        let pattern = #"(?:₹|Rs\.?|INR|\$|€|£)?\s*([0-9][0-9,.]*)"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let match = regex.firstMatch(in: cleaned, range: NSRange(cleaned.startIndex..., in: cleaned)),
              let numberRange = Range(match.range(at: 1), in: cleaned) else { return nil }
        let numberText = String(cleaned[numberRange])
            .trimmingCharacters(in: CharacterSet(charactersIn: " ,.;"))
            .replacingOccurrences(of: ",", with: "")
        guard let number = Double(numberText), number > 0 else { return nil }

        let lower = cleaned.lowercased()
        let currencyCode: String
        if cleaned.contains("₹") || lower.contains("inr") || lower.contains("rs") || pageURL.host?.hasSuffix(".in") == true { currencyCode = "INR" }
        else if cleaned.contains("€") { currencyCode = "EUR" }
        else if cleaned.contains("£") { currencyCode = "GBP" }
        else { currencyCode = "USD" }

        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currencyCode
        formatter.locale = currencyCode == "INR" ? Locale(identifier: "en_IN") : Locale(identifier: "en_US")
        formatter.maximumFractionDigits = number.rounded() == number ? 0 : 2
        return formatter.string(from: NSNumber(value: number))
    }

    private func embeddedImageURL(in html: String) -> URL? {
        let decoded = html.replacingOccurrences(of: "&amp;", with: "&")
        let patterns = [
            #"(?:property|name)=[\"'](?:og:image|twitter:image)[\"'][^>]+content=[\"']([^\"']+)[\"']"#,
            #"content=[\"']([^\"']+)[\"'][^>]+(?:property|name)=[\"'](?:og:image|twitter:image(?::src)?)[\"']"#,
            #"https?://i\.pinimg\.com/[^\"'\s<>]+"#
        ]
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
                  let match = regex.firstMatch(in: decoded, range: NSRange(decoded.startIndex..., in: decoded)) else { continue }
            let capture = match.numberOfRanges > 1 ? 1 : 0
            guard let range = Range(match.range(at: capture), in: decoded), let url = URL(string: String(decoded[range])) else { continue }
            return url
        }
        return nil
    }

    private func detectedProductPrice(in html: String) -> String? {
        let decoded = html.replacingOccurrences(of: "&quot;", with: "\"")
        let patterns = [
            #"(?:property|itemprop)=[\"'](?:product:price:amount|price)[\"'][^>]*content=[\"']([^\"']+)[\"']"#,
            #"content=[\"']([^\"']+)[\"'][^>]*(?:property|itemprop)=[\"'](?:product:price:amount|price)[\"']"#,
            #"[\"']price[\"']\s*:\s*[\"']([0-9][0-9,.]*)[\"']"#,
            #"[\"']price[\"']\s*:\s*([0-9][0-9,.]*)"#,
            #"[\"']lowPrice[\"']\s*:\s*[\"']?([0-9][0-9,.]*)"#,
            #"(?:product:price:amount|price)[\"']?\s*(?:content|value)?[\"']?\s*[:=]\s*[\"']([^\"']+)[\"']"#,
            #"[\"']price[\"']\s*:\s*[\"']?([₹$€£]\s?[0-9][0-9,.]*)"#,
            #"([₹$€£]\s?[0-9][0-9,.]{1,})"#
        ]
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
                  let match = regex.firstMatch(in: decoded, range: NSRange(decoded.startIndex..., in: decoded)),
                  match.numberOfRanges > 1,
                  let range = Range(match.range(at: 1), in: decoded) else { continue }
            let value = String(decoded[range]).trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty {
                if value.rangeOfCharacter(from: CharacterSet(charactersIn: "₹$€£")) != nil { return String(value.prefix(40)) }
                let currencyPatterns: [(String, String)] = [(#"[\"']priceCurrency[\"']\s*:\s*[\"']([A-Z]{3})[\"']"#, ""), (#"product:price:currency[^>]*content=[\"']([A-Z]{3})[\"']"#, "")]
                for (currencyPattern, _) in currencyPatterns {
                    if let currencyRegex = try? NSRegularExpression(pattern: currencyPattern, options: [.caseInsensitive]),
                       let currencyMatch = currencyRegex.firstMatch(in: decoded, range: NSRange(decoded.startIndex..., in: decoded)),
                       let currencyRange = Range(currencyMatch.range(at: 1), in: decoded) {
                        return "\(String(decoded[currencyRange]).uppercased()) \(String(value.prefix(32)))"
                    }
                }
                return String(value.prefix(40))
            }
        }
        return nil
    }

    private func detectedWebMetadata(in html: String, url: URL) -> WebCaptureMetadata {
        func capture(_ patterns: [String]) -> String? {
            for pattern in patterns {
                guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]),
                      let match = regex.firstMatch(in: html, range: NSRange(html.startIndex..., in: html)), match.numberOfRanges > 1,
                      let range = Range(match.range(at: 1), in: html) else { continue }
                let value = String(html[range])
                    .replacingOccurrences(of: "&amp;", with: "&")
                    .replacingOccurrences(of: "&quot;", with: "\"")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !value.isEmpty { return String(value.prefix(240)) }
            }
            return nil
        }
        let title = capture([
            #"[\"']@type[\"']\s*:\s*[\"']Product[\"'][\s\S]{0,6000}?[\"']name[\"']\s*:\s*[\"']([^\"']+)[\"']"#,
            #"itemprop=[\"']name[\"'][^>]*content=[\"']([^\"']+)[\"']"#,
            #"property=[\"']og:title[\"'][^>]*content=[\"']([^\"']+)[\"']"#,
            #"content=[\"']([^\"']+)[\"'][^>]*property=[\"']og:title[\"']"#,
            #"<title[^>]*>(.*?)</title>"#
        ])
        let site = capture([#"property=[\"']og:site_name[\"'][^>]*content=[\"']([^\"']+)[\"']"#]) ?? url.host
        let rawType = capture([
            #"property=[\"']og:type[\"'][^>]*content=[\"']([^\"']+)[\"']"#,
            #"[\"']@type[\"']\s*:\s*[\"']([^\"']+)[\"']"#
        ])?.lowercased() ?? ""
        let lower = html.lowercased()
        let host = url.host?.lowercased() ?? ""
        let marketplaceProduct = (host.contains("amazon.") && (url.path.contains("/dp/") || url.path.contains("/gp/product/")))
            || (host.contains("flipkart.") && url.path.contains("/p/"))
        let type: String
        if rawType.contains("product") || lower.contains("product:price") || lower.contains("\"offers\"") || marketplaceProduct { type = "Product" }
        else if rawType.contains("article") || rawType.contains("news") || rawType.contains("blogposting")
            || lower.contains("<article") || lower.contains("article:published_time") || lower.contains("schema.org/article") { type = "Article" }
        else if rawType.contains("recipe") { type = "Recipe" }
        else if rawType.contains("video") { type = "Video" }
        else if rawType.contains("place") || rawType.contains("restaurant") || rawType.contains("hotel") { type = "Place" }
        else { type = "Web image" }
        let articleText = type == "Article" ? extractedArticleText(from: html) : nil
        let articleHTML = type == "Article" ? sanitizedArticleHTML(from: html, url: url) : nil
        return WebCaptureMetadata(title: title, site: site, price: type == "Video" ? nil : detectedProductPrice(in: html), contentType: type, articleText: articleText, articleHTML: articleHTML)
    }

    private func extractedArticleText(from html: String) -> String? {
        var source = largestArticleFragment(in: html) ?? html
        for pattern in [#"<(script|style|nav|header|footer|aside)\b[^>]*>[\s\S]*?</\1>"#, #"<!--([\s\S]*?)-->"#] {
            source = source.replacingOccurrences(of: pattern, with: " ", options: [.regularExpression, .caseInsensitive])
        }
        source = source.replacingOccurrences(of: #"</(p|div|h[1-6]|li|blockquote)>"#, with: "\n\n", options: [.regularExpression, .caseInsensitive])
        source = source.replacingOccurrences(of: #"<br\s*/?>"#, with: "\n", options: [.regularExpression, .caseInsensitive])
        source = source.replacingOccurrences(of: #"<[^>]+>"#, with: " ", options: .regularExpression)
        let entities = ["&amp;": "&", "&quot;": "\"", "&#39;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " "]
        for (entity, value) in entities { source = source.replacingOccurrences(of: entity, with: value) }
        source = source.replacingOccurrences(of: #"[ \t]+"#, with: " ", options: .regularExpression)
        source = source.replacingOccurrences(of: #"\n\s*\n\s*\n+"#, with: "\n\n", options: .regularExpression)
        let cleaned = source.trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.count >= 120 ? String(cleaned.prefix(250_000)) : nil
    }

    private func sanitizedArticleHTML(from html: String, url: URL) -> String? {
        var body = largestArticleFragment(in: html) ?? html
        for pattern in [
            #"<(script|style|nav|header|footer|aside|form|iframe|noscript)\b[^>]*>[\s\S]*?</\1>"#,
            #"<([a-z0-9]+)\b[^>]*(?:class|id)=[\"'][^\"']*(?:advert|\bad\b|promo|newsletter|cookie|social|share|related|recommend)[^\"']*[\"'][^>]*>[\s\S]*?</\1>"#,
            #"<!--[\s\S]*?-->"#
        ] { body = body.replacingOccurrences(of: pattern, with: "", options: [.regularExpression, .caseInsensitive]) }
        // Many publishers keep the real image URL in a lazy-loading attribute.
        body = body.replacingOccurrences(of: #"<img([^>]*?)\s(?:data-src|data-lazy-src|data-original)=[\"']([^\"']+)[\"']([^>]*)>"#, with: #"<img$1 src="$2"$3>"#, options: [.regularExpression, .caseInsensitive])
        guard body.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression).count > 120 else { return nil }
        let base = url.deletingLastPathComponent().absoluteString
        let document = """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><base href="\(base)">
        <style>body{margin:0 auto;padding:44px 50px 80px;max-width:760px;color:#202128;background:#fff;font:20px/1.72 Georgia,serif}h1,h2,h3{line-height:1.18;margin:1.3em 0 .55em}h1{font-size:42px}h2{font-size:30px}p{margin:0 0 1.25em}img,figure,video{max-width:100%;height:auto;border-radius:12px}figure{margin:2em 0}figcaption{font:14px -apple-system;color:#777;margin-top:8px}a{color:#b85f00}blockquote{border-left:3px solid #f29332;margin:2em 0;padding:.2em 1.4em;color:#555}button,input,svg{display:none!important}@media(prefers-color-scheme:dark){body{background:#1c1c1e;color:#eee}a{color:#ffad55}}</style></head><body>\(String(body.prefix(1_800_000)))</body></html>
        """
        return document
    }

    private func largestArticleFragment(in html: String) -> String? {
        for pattern in [#"<article\b[^>]*>([\s\S]*?)</article>"#, #"<main\b[^>]*>([\s\S]*?)</main>"#] {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { continue }
            let matches = regex.matches(in: html, range: NSRange(html.startIndex..., in: html))
            let fragments = matches.compactMap { match -> String? in
                guard match.numberOfRanges > 1, let range = Range(match.range(at: 1), in: html) else { return nil }
                return String(html[range])
            }
            if let largest = fragments.max(by: { $0.count < $1.count }), largest.count >= 120 { return largest }
        }
        return nil
    }

    private func highestQualityPinterestURL(from url: URL) -> URL {
        guard url.host?.lowercased() == "i.pinimg.com",
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        let parts = components.path.split(separator: "/")
        guard parts.count >= 5, parts[0].range(of: #"^\d+x$"#, options: .regularExpression) != nil else { return url }
        components.path = "/originals/" + parts.dropFirst().joined(separator: "/")
        return components.url ?? url
    }

    func importImageData(_ data: Data, suggestedName: String? = nil, typeIdentifier: String? = nil, sourceURL: URL? = nil) {
        guard !data.isEmpty else { return }
        Task {
            do {
                let ext = typeIdentifier.flatMap { UTType($0)?.preferredFilenameExtension } ?? "png"
                let savedURL = try await store.saveImageData(data, suggestedName: suggestedName, fileExtension: ext)
                if let sourceURL {
                    let metadata = await webMetadata(from: sourceURL)
                    await store.setWebMetadata(sourceURL: sourceURL.absoluteString, price: metadata.price, title: metadata.title, site: metadata.site, contentType: metadata.contentType, articleText: metadata.articleText, articleHTML: metadata.articleHTML, for: savedURL.path)
                }
                captureMessage = "Image saved • analyzing on device"
                reindex(analyzeNewImages: true)
            } catch {
                captureMessage = "Couldn’t save that image"
            }
        }
    }

    private func webMetadata(from url: URL) async -> WebCaptureMetadata {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return WebCaptureMetadata() }
        if let shopify = await shopifyProductMetadata(from: url) { return shopify }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15", forHTTPHeaderField: "User-Agent")
        request.setValue("text/html,application/xhtml+xml", forHTTPHeaderField: "Accept")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              !(response.mimeType ?? "").lowercased().hasPrefix("image/"),
              let html = String(data: data.prefix(8_000_000), encoding: .utf8) else { return WebCaptureMetadata(site: url.host) }
        return detectedWebMetadata(in: html, url: url)
    }

    private func shopifyProductMetadata(from url: URL) async -> WebCaptureMetadata? {
        let parts = url.pathComponents.filter { $0 != "/" }
        guard let productIndex = parts.firstIndex(of: "products"), parts.indices.contains(productIndex + 1) else { return nil }
        let handle = parts[productIndex + 1].replacingOccurrences(of: ".js", with: "")
        guard !handle.isEmpty, var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        components.path = "/products/\(handle).js"
        components.query = nil
        guard let endpoint = components.url else { return nil }
        var request = URLRequest(url: endpoint)
        request.timeoutInterval = 8
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Mozilla/5.0 AppleWebKit/605.1.15 Safari/605.1.15", forHTTPHeaderField: "User-Agent")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }

        let title = (object["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let vendor = (object["vendor"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let variants = object["variants"] as? [[String: Any]] ?? []
        let availablePrices: [Double] = variants.compactMap { variant in
            if let value = variant["price"] as? String { return Double(value.replacingOccurrences(of: ",", with: "")) }
            if let value = variant["price"] as? Double { return value > 10_000 ? value / 100 : value }
            if let value = variant["price"] as? Int { return value > 10_000 ? Double(value) / 100 : Double(value) }
            return nil
        }.filter { $0 > 0 }
        let price = availablePrices.min().map { formattedShopifyPrice($0, host: url.host) }
        guard title != nil || price != nil else { return nil }
        return WebCaptureMetadata(title: title, site: vendor ?? url.host, price: price, contentType: "Product")
    }

    private func formattedShopifyPrice(_ value: Double, host: String?) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.maximumFractionDigits = value.rounded() == value ? 0 : 2
        formatter.currencyCode = host?.lowercased().hasSuffix(".in") == true ? "INR" : "USD"
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)
    }

    func refreshWebMetadata(for file: IndexedFile) {
        guard let value = file.sourceURL, let url = URL(string: value) else { return }
        Task {
            let metadata = await webMetadata(from: url)
            await store.setWebMetadata(sourceURL: value, price: metadata.price, title: metadata.title, site: metadata.site, contentType: metadata.contentType, articleText: metadata.articleText, articleHTML: metadata.articleHTML, for: file.path)
            if let index = files.firstIndex(where: { $0.path == file.path }) {
                if let price = metadata.price { files[index].detectedPrice = price }
                if let title = metadata.title { files[index].sourceTitle = title }
                if let site = metadata.site { files[index].sourceSite = site }
                if let contentType = metadata.contentType { files[index].contentType = contentType }
                if let articleText = metadata.articleText { files[index].articleText = articleText }
                if let articleHTML = metadata.articleHTML { files[index].articleHTML = articleHTML }
            }
            captureMessage = metadata.price == nil ? "Source refreshed" : "Current price refreshed"
            scheduleSearch(immediately: true)
        }
    }

    func attachSource(_ source: String, to file: IndexedFile) {
        let cleaned = source.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: cleaned), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            captureMessage = "Enter a complete http or https product link"
            return
        }
        Task {
            let metadata = await webMetadata(from: url)
            await store.setWebMetadata(sourceURL: cleaned, price: metadata.price, title: metadata.title, site: metadata.site, contentType: metadata.contentType, articleText: metadata.articleText, articleHTML: metadata.articleHTML, for: file.path)
            if let index = files.firstIndex(where: { $0.path == file.path }) {
                files[index].sourceURL = cleaned
                files[index].detectedPrice = metadata.price
                files[index].sourceTitle = metadata.title
                files[index].sourceSite = metadata.site
                files[index].contentType = metadata.contentType ?? files[index].contentType
                files[index].articleText = metadata.articleText ?? files[index].articleText
                files[index].articleHTML = metadata.articleHTML ?? files[index].articleHTML
            }
            captureMessage = metadata.price == nil ? "Source saved • price not exposed by this page" : "Product name and current price saved"
            scheduleSearch(immediately: true)
        }
    }

    func createNote(title: String, body: String) {
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty || !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        Task {
            do {
                _ = try await store.createNote(title: title, body: body)
                captureMessage = "Note saved"
                reindex()
            } catch {
                captureMessage = "Couldn’t save note"
            }
        }
    }

    func updateTextMemory(_ text: String, file: IndexedFile) {
        Task {
            do {
                try await store.updateText(at: file.path, text: text)
                captureMessage = "Changes saved"
                reindex()
            } catch {
                captureMessage = "Couldn’t save those changes"
            }
        }
    }

    func toggleFavorite(_ file: IndexedFile) {
        if favoritePaths.contains(file.path) { favoritePaths.remove(file.path) }
        else { favoritePaths.insert(file.path) }
        let paths = Array(favoritePaths)
        Task { await store.setFavorites(paths) }
        scheduleSearch(immediately: true)
    }

    func isFavorite(_ file: IndexedFile) -> Bool { favoritePaths.contains(file.path) }

    func tags(for file: IndexedFile) -> [String] { customTags[file.path] ?? [] }

    func setTags(_ tags: [String], for file: IndexedFile) {
        let cleaned = Array(Set(tags.map { $0.lowercased().trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })).sorted()
        customTags[file.path] = cleaned
        Task { await store.setTags(cleaned, for: file.path) }
        scheduleSearch(immediately: true)
    }

    func note(for file: IndexedFile) -> String { itemNotes[file.path] ?? "" }

    func setNote(_ note: String, for file: IndexedFile) {
        let cleaned = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty { itemNotes.removeValue(forKey: file.path) }
        else { itemNotes[file.path] = cleaned }
        Task { await store.setNote(cleaned, for: file.path) }
    }

    var spaceNames: [String] { spaces.keys.sorted() }

    func createSpace(named name: String) {
        let cleaned = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty, spaces[cleaned] == nil else { return }
        spaces[cleaned] = []
        let snapshot = spaces
        Task { await store.setSpaces(snapshot) }
    }

    func renameSpace(_ oldName: String, to newName: String) {
        let cleaned = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty, cleaned != oldName, spaces[cleaned] == nil, let paths = spaces.removeValue(forKey: oldName) else { return }
        spaces[cleaned] = paths
        let snapshot = spaces
        Task { await store.setSpaces(snapshot) }
    }

    func deleteSpace(named name: String) {
        guard spaces.count > 1 else { return }
        spaces.removeValue(forKey: name)
        let snapshot = spaces
        Task { await store.setSpaces(snapshot) }
    }

    func files(inSpace name: String) -> [IndexedFile] {
        let paths = Set(spaces[name] ?? [])
        return files.filter { paths.contains($0.path) }
    }

    func isInSpace(_ file: IndexedFile, name: String) -> Bool {
        spaces[name]?.contains(file.path) == true
    }

    func toggle(_ file: IndexedFile, inSpace name: String) {
        var paths = spaces[name] ?? []
        if let index = paths.firstIndex(of: file.path) { paths.remove(at: index) }
        else { paths.append(file.path) }
        spaces[name] = paths
        let snapshot = spaces
        Task { await store.setSpaces(snapshot) }
    }

    func deleteFromRecall(_ file: IndexedFile) {
        Task {
            do {
                if try await store.moveCaptureToTrash(path: file.path) {
                    favoritePaths.remove(file.path)
                    for name in spaces.keys { spaces[name]?.removeAll { $0 == file.path } }
                    await store.setFavorites(Array(favoritePaths))
                    await store.setSpaces(spaces)
                    captureMessage = "Moved to Trash"
                    reindex()
                } else {
                    captureMessage = "Indexed originals can only be removed by removing their folder"
                }
            } catch {
                captureMessage = "Couldn’t move item to Trash"
            }
        }
    }

    func deleteFromRecall(_ selectedFiles: [IndexedFile]) {
        guard !selectedFiles.isEmpty else { return }
        let paths = selectedFiles.map(\.path)
        Task {
            do {
                let moved = try await store.moveCapturesToTrash(paths: paths)
                guard moved > 0 else {
                    captureMessage = "Those items couldn’t be removed"
                    return
                }
                for path in paths {
                    favoritePaths.remove(path)
                    customTags.removeValue(forKey: path)
                    itemNotes.removeValue(forKey: path)
                    await store.setTags([], for: path)
                    await store.setNote("", for: path)
                    for name in spaces.keys { spaces[name]?.removeAll { $0 == path } }
                }
                await store.setSpaces(spaces)
                await store.setFavorites(Array(favoritePaths))
                captureMessage = moved == 1 ? "Moved 1 item to Trash" : "Moved \(moved) items to Trash"
                reindex()
            } catch {
                captureMessage = "Couldn’t move selected items to Trash"
            }
        }
    }

    func reindex(analyzeNewImages: Bool = false) {
        guard !isIndexing else { return }
        isIndexing = true
        progressText = "Scanning…"
        let selectedFolders = folders
        let previous = files
        let previousPaths = Set(previous.map(\.path))
        Task {
            let updated = await store.rebuild(folders: selectedFolders, previous: previous) { done, total in
                // Avoid invalidating the entire palette for every single indexed file.
                guard done == total || done.isMultiple(of: 25) else { return }
                await MainActor.run { self.progressText = "Indexing \(done) of \(total)" }
            }
            files = updated
            isIndexing = false
            progressText = "\(files.count) files indexed"
            scheduleSearch(immediately: true)
            if analyzeNewImages {
                let newImagePaths = Set(updated.filter {
                    !previousPaths.contains($0.path) && ContentExtractor.imageExtensions.contains($0.url.pathExtension.lowercased())
                }.map(\.path))
                if !newImagePaths.isEmpty { captureMessage = "Apple analysis ready" }
            }
        }
    }

    func open(_ file: IndexedFile) {
        if ["Video", "Article", "Highlight", "Quote", "Web page", "Web image", "Product"].contains(file.contentType ?? ""),
           let source = file.sourceURL, let url = URL(string: source) {
            NSWorkspace.shared.open(url)
        } else {
            NSWorkspace.shared.open(file.url)
        }
    }
    func reveal(_ file: IndexedFile) { NSWorkspace.shared.activateFileViewerSelecting([file.url]) }

    private func scheduleSearch(immediately: Bool = false) {
        searchTask?.cancel()
        searchWorker?.cancel()
        let currentQuery = query
        let currentFiles = files
        let currentFavorites = favoritePaths
        let currentTags = customTags
        let currentNotes = itemNotes
        searchTask = Task {
            if !immediately {
                try? await Task.sleep(for: .milliseconds(25))
                guard !Task.isCancelled else { return }
            }
            let fastWorker = Task.detached(priority: .userInitiated) {
                SemanticSearch.search(currentQuery, in: currentFiles, favorites: currentFavorites, customTags: currentTags, itemNotes: currentNotes, includeVisual: false)
            }
            searchWorker = fastWorker
            let matches = await fastWorker.value
            guard !Task.isCancelled, currentQuery == query else { return }
            results = matches
            if selectedID == nil || !matches.contains(where: { $0.id == selectedID }) {
                selectedID = matches.first?.id
            }
            // Core ML visual search is deliberately deferred until the user pauses.
            // This avoids loading the model for every intermediate keystroke.
            guard !currentQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            try? await Task.sleep(for: .milliseconds(320))
            guard !Task.isCancelled, currentQuery == query else { return }
            let visualWorker = Task.detached(priority: .utility) {
                SemanticSearch.search(currentQuery, in: currentFiles, favorites: currentFavorites, customTags: currentTags, itemNotes: currentNotes, includeVisual: true)
            }
            searchWorker = visualWorker
            let refined = await visualWorker.value
            guard !Task.isCancelled, currentQuery == query else { return }
            results = refined
        }
    }
}
