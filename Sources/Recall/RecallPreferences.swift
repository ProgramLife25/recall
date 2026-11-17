import SwiftUI

enum RecallAppearance: String, CaseIterable, Identifiable {
    case system = "System"
    case light = "Light"
    case dark = "Night"
    var id: String { rawValue }

    var scheme: ColorScheme? {
        switch self { case .system: nil; case .light: .light; case .dark: .dark }
    }
}

enum RecallNoteTypeface: String, CaseIterable, Identifiable {
    case serif = "Editorial Serif"
    case sans = "Clean Sans"
    case rounded = "Soft Rounded"
    case mono = "Monospaced"
    var id: String { rawValue }

    func font(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        switch self {
        case .serif: .system(size: size, weight: weight, design: .serif)
        case .sans: .system(size: size, weight: weight, design: .default)
        case .rounded: .system(size: size, weight: weight, design: .rounded)
        case .mono: .system(size: size, weight: weight, design: .monospaced)
        }
    }
}
