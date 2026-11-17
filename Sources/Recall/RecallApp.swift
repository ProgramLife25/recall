import AppKit
import SwiftUI
import UniformTypeIdentifiers

@main
@MainActor
struct RecallApp: App {
    @StateObject private var model = AppModel()
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    init() {
        // Small release-build diagnostic used by the build/test workflow. It performs
        // no network access and is otherwise invisible to users.
        if let marker = CommandLine.arguments.firstIndex(of: "--mobileclip-self-test"),
           CommandLine.arguments.indices.contains(marker + 1) {
            let service = MobileCLIPService.shared
            let imageURL = URL(fileURLWithPath: CommandLine.arguments[marker + 1])
            let image = service.imageEmbedding(for: imageURL)
            let text = service.textEmbedding(for: "a colorful screenshot")
            print("MobileCLIP available=\(service.isAvailable) image=\(image?.count ?? 0) text=\(text?.count ?? 0) diagnostic=\(service.diagnostic)")
            exit(image?.count == text?.count && !(image?.isEmpty ?? true) ? EXIT_SUCCESS : EXIT_FAILURE)
        }
    }

    var body: some Scene {
        WindowGroup("Recall") {
            SearchView()
                .environmentObject(model)
                .task { await model.load() }
                .onOpenURL { model.importExtensionCapture($0) }
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        .defaultSize(width: 1380, height: 820)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandGroup(replacing: .pasteboard) {
                Button("Paste Image into Recall") {
                    NotificationCenter.default.post(name: .pasteRecallImage, object: nil)
                }
                .keyboardShortcut("v", modifiers: .command)
            }
        }

        Settings { SettingsView().environmentObject(model) }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var hotKey: HotKey?
    private var pasteMonitor: Any?

    func applicationDidFinishLaunching(_ notification: Notification) {
        hotKey = HotKey()
        hotKey?.onPress = { [weak self] in self?.togglePalette() }
        pasteMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { (event: NSEvent) -> NSEvent? in
            let isPaste = event.modifierFlags.contains(.command) && event.charactersIgnoringModifiers?.lowercased() == "v"
            let pasteboard = NSPasteboard.general
            let containsImage = pasteboard.canReadObject(forClasses: [NSImage.self], options: nil)
                || pasteboard.data(forType: .png) != nil
                || pasteboard.data(forType: .tiff) != nil
                || pasteboard.data(forType: NSPasteboard.PasteboardType(UTType.jpeg.identifier)) != nil
                || pasteboard.data(forType: NSPasteboard.PasteboardType(UTType.heic.identifier)) != nil
                || pasteboard.data(forType: NSPasteboard.PasteboardType(UTType.webP.identifier)) != nil
            if isPaste && containsImage {
                NotificationCenter.default.post(name: .pasteRecallImage, object: nil)
                return nil
            }
            let blockedModifiers: NSEvent.ModifierFlags = [.command, .control, .option]
            let isEditingText = NSApp.keyWindow?.firstResponder is NSTextView
            if !isEditingText,
               event.modifierFlags.intersection(blockedModifiers).isEmpty,
               let characters = event.characters,
               characters.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }),
               !characters.isEmpty {
                NotificationCenter.default.post(name: .typeIntoRecallSearch, object: characters)
                return nil
            }
            return event
        }
        NSApp.setActivationPolicy(.regular)
    }

    deinit {
        if let pasteMonitor { NSEvent.removeMonitor(pasteMonitor) }
    }

    private func togglePalette() {
        guard let window = NSApp.windows.first(where: { $0.title == "Recall" || !($0 is NSPanel) }) else { return }
        if window.isVisible && NSApp.isActive { window.orderOut(nil) }
        else {
            window.center()
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            NotificationCenter.default.post(name: .focusRecallSearch, object: nil)
        }
    }
}
