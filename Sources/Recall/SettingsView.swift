import SwiftUI

@MainActor
struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @AppStorage("recallAppearance") private var appearance = RecallAppearance.system.rawValue
    @AppStorage("recallNoteTypeface") private var noteTypeface = RecallNoteTypeface.serif.rawValue

    var body: some View {
        Form {
            Section("Appearance") {
                Picker("Theme", selection: $appearance) {
                    ForEach(RecallAppearance.allCases) { Text($0.rawValue).tag($0.rawValue) }
                }
                Picker("Note typeface", selection: $noteTypeface) {
                    ForEach(RecallNoteTypeface.allCases) { Text($0.rawValue).tag($0.rawValue) }
                }
                Text("The selected typeface is used for notes, highlights, and detected quotes.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Your Recall library") {
                HStack {
                    Text("\(model.files.count) saved items")
                    Spacer()
                    if !model.progressText.isEmpty { Text(model.progressText).foregroundStyle(.secondary) }
                }
                Button("Save Files…") { model.chooseFiles() }
            }
            Section("Privacy") {
                Text("Recall searches only items you deliberately save. Everything stays on this Mac; on-device OCR and language models never upload your library.")
                    .foregroundStyle(.secondary)
            }
            Section("Save from Safari") {
                Button("Install Save to Recall Bookmark…") {
                    model.openSafariBookmarkletInstaller()
                }
                Text("Adds a Safari Favorites Bar button without Xcode or a browser extension. Product details are read from the open page and passed directly to Recall.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Apple on-device recognition") {
                Label("Ready", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                Text("Every new image is analyzed automatically with Apple Vision’s strongest available classifier, accurate text recognition, animal and people detection, and dominant-color analysis. Recall uses a bounded analysis copy to stay responsive; originals remain untouched and nothing leaves this Mac.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Semantic image search") {
                Label(MobileCLIPService.shared.isAvailable ? "MobileCLIP S0 ready" : "MobileCLIP unavailable", systemImage: MobileCLIPService.shared.isAvailable ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundStyle(MobileCLIPService.shared.isAvailable ? .green : .orange)
                Text("MobileCLIP matches natural-language searches directly against image meaning. Image vectors are generated once and saved locally.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Text("Recall 0.4 • Apple Vision + MobileCLIP")
                .font(.caption2).foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .formStyle(.grouped).frame(width: 580, height: 580)
        .preferredColorScheme(RecallAppearance(rawValue: appearance)?.scheme)
    }
}
