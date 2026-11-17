// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Recall",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "Recall", targets: ["Recall"])],
    targets: [
        .executableTarget(
            name: "Recall",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("Carbon"),
                .linkedFramework("CoreML"),
                .linkedFramework("NaturalLanguage"),
                .linkedFramework("PDFKit"),
                .linkedFramework("QuickLookThumbnailing"),
                .linkedFramework("Vision")
            ]
        )
    ],
    swiftLanguageModes: [.v5]
)
