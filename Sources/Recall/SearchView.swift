import AppKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

private struct ArticleReaderView: NSViewRepresentable {
    let html: String
    let baseURL: URL?

    final class Coordinator { var loadedHTML = "" }
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.setValue(false, forKey: "drawsBackground")
        return view
    }
    func updateNSView(_ view: WKWebView, context: Context) {
        guard context.coordinator.loadedHTML != html else { return }
        context.coordinator.loadedHTML = html
        view.loadHTMLString(html, baseURL: baseURL)
    }
}

@MainActor
struct SearchView: View {
    @EnvironmentObject private var model: AppModel
    @FocusState private var searchFocused: Bool
    @FocusState private var spaceSearchFocused: Bool
    @State private var mode: LibraryMode = .everything
    @State private var showingNote = false
    @State private var isDropTarget = false
    @State private var pendingDelete: IndexedFile?
    @State private var detailFile: IndexedFile?
    @State private var modalDetailFile: IndexedFile?
    @State private var isSelecting = false
    @State private var selectedPaths = Set<String>()
    @State private var confirmingBulkDelete = false
    @State private var activeSpace = "Top of Mind"
    @State private var showingNewSpace = false
    @State private var newSpaceName = ""
    @State private var renamingSpace: String?
    @State private var renamedSpaceName = ""
    @State private var imagesOnly = false
    @State private var notesOnly = false
    @State private var likedOnly = false
    @State private var selectedColor: String?
    @State private var serendipityIndex = 0
    @State private var spaceInspectorFile: IndexedFile?
    @State private var spaceSearch = ""
    @AppStorage("recallAppearance") private var appearance = RecallAppearance.system.rawValue

    private var displayResults: [SearchResult] {
        var results = model.results
        if !model.query.isEmpty || mode == .everything {
            if imagesOnly { results = results.filter { ContentExtractor.imageExtensions.contains($0.file.url.pathExtension.lowercased()) } }
            if notesOnly { results = results.filter { $0.file.kind == "MD" || $0.file.kind == "TXT" } }
            if likedOnly { results = results.filter { model.favoritePaths.contains($0.file.path) } }
            if let selectedColor {
                let tokens = RecallColorFilter.named(selectedColor)?.tokens ?? [selectedColor]
                results = results.filter { result in
                    let text = ((result.file.aiTags ?? []) + [result.file.searchableText]).joined(separator: " ").lowercased()
                    return tokens.contains { text.localizedCaseInsensitiveContains($0) }
                }
            }
        }
        if !model.query.isEmpty { return results }
        switch mode {
        case .everything: return results
        case .topOfMind:
            let paths = Set(model.spaces[activeSpace] ?? [])
            return model.results.filter {
                paths.contains($0.file.path) && (spaceSearch.isEmpty || $0.file.searchableText.localizedCaseInsensitiveContains(spaceSearch) || $0.file.name.localizedCaseInsensitiveContains(spaceSearch))
            }
        case .serendipity:
            return model.results.filter { $0.file.contentType == "Article" }
        }
    }

    private var greeting: String {
        switch Calendar.current.component(.hour, from: Date()) {
        case 5..<12: return "Good Morning"
        case 12..<17: return "Good Afternoon"
        default: return "Good Evening"
        }
    }

    private var dateText: String {
        Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day())
    }

    var body: some View {
        ZStack {
            ambientBackground

            HStack(spacing: 0) {
                if mode != .topOfMind {
                    sideRail
                    Divider().opacity(0.45)
                }

                VStack(spacing: 0) {
                    searchBar
                        .padding(.horizontal, 34)
                        .padding(.top, 10)
                    Divider().opacity(0.35).padding(.horizontal, 34).padding(.top, 4)
                    content
                        .id(mode)
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                        .padding(.horizontal, 20)
                        .padding(.top, 12)
                        .frame(maxHeight: .infinity)
                }
                if let file = detailFile, mode != .topOfMind {
                    Divider().opacity(0.35)
                    canvasInspector(file)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
            .scaleEffect(pendingDelete == nil && !confirmingBulkDelete ? 1 : 0.992)
            .blur(radius: pendingDelete == nil && !confirmingBulkDelete ? 0 : 2)

            deletionOverlay
        }
        .frame(minWidth: 1100, idealWidth: 1380, minHeight: 700, idealHeight: 820)
        .preferredColorScheme(RecallAppearance(rawValue: appearance)?.scheme)
        .animation(.spring(response: 0.42, dampingFraction: 0.86), value: mode)
        .animation(.easeInOut(duration: 0.22), value: selectedColor)
        .animation(.easeInOut(duration: 0.20), value: imagesOnly)
        .animation(.easeInOut(duration: 0.20), value: notesOnly)
        .animation(.easeInOut(duration: 0.20), value: likedOnly)
        .animation(.spring(response: 0.34, dampingFraction: 0.88), value: pendingDelete?.path)
        .animation(.spring(response: 0.34, dampingFraction: 0.88), value: confirmingBulkDelete)
        .animation(.spring(response: 0.22, dampingFraction: 0.90), value: detailFile?.path)
        .onAppear {
            searchFocused = true
        }
        .onChange(of: model.isLoaded) { _, loaded in
            guard loaded else { return }
            if !model.spaceNames.contains(activeSpace) { activeSpace = model.spaceNames.first ?? "Top of Mind" }
        }
        .onReceive(NotificationCenter.default.publisher(for: .focusRecallSearch)) { _ in searchFocused = true }
        .onReceive(NotificationCenter.default.publisher(for: .typeIntoRecallSearch)) { notification in
            guard let characters = notification.object as? String, !characters.isEmpty else { return }
            if mode == .topOfMind {
                spaceSearch.append(contentsOf: characters)
                spaceSearchFocused = true
            } else {
                model.query.append(contentsOf: characters)
                searchFocused = true
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .pasteRecallImage)) { _ in _ = pasteFromClipboard() }
        .onKeyPress(.downArrow) { moveSelection(1); return .handled }
        .onKeyPress(.upArrow) { moveSelection(-1); return .handled }
        .onKeyPress(.escape) { NSApp.keyWindow?.orderOut(nil); return .handled }
        .onKeyPress("v", phases: .down) { keyPress in
            guard keyPress.modifiers.contains(.command) else { return .ignored }
            return pasteFromClipboard() ? .handled : .ignored
        }
        .onDrop(of: [UTType.fileURL, UTType.image, UTType.html, UTType.url, UTType.text], isTargeted: $isDropTarget, perform: handleDrop)
        .overlay {
            if isDropTarget {
                RoundedRectangle(cornerRadius: 24)
                    .strokeBorder(Color.accentColor, style: StrokeStyle(lineWidth: 3, dash: [9]))
                    .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 24))
                    .padding(12)
                    .overlay { Label("Drop to save in Recall", systemImage: "tray.and.arrow.down.fill").font(.title2.bold()) }
            }
        }
        .overlay(alignment: .bottom) {
            if !model.captureMessage.isEmpty {
                Text(model.captureMessage)
                    .font(.callout.weight(.medium))
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(.ultraThinMaterial, in: Capsule())
                    .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
                    .padding(.bottom, 18)
            }
        }
        .sheet(isPresented: $showingNote) { QuickNoteView { title, body in model.createNote(title: title, body: body) } }
        .sheet(item: $modalDetailFile) { file in
            ImageDetailView(
                file: file,
                favorite: model.isFavorite(file),
                tags: model.tags(for: file),
                note: model.note(for: file),
                onFavorite: { model.toggleFavorite(file) },
                onSaveTags: { model.setTags($0, for: file) },
                onSaveNote: { model.setNote($0, for: file) },
                onSaveContent: { model.updateTextMemory($0, file: file) },
                onRefreshSource: {
                    model.refreshWebMetadata(for: file)
                    modalDetailFile = nil
                },
                onSaveSource: { source in
                    model.attachSource(source, to: file)
                    modalDetailFile = nil
                },
                onOpen: { model.open(file) },
                onDelete: { modalDetailFile = nil; requestDelete(file) }
            )
        }
        .alert("New Space", isPresented: $showingNewSpace) {
            TextField("Space name", text: $newSpaceName)
            Button("Cancel", role: .cancel) { newSpaceName = "" }
            Button("Create") {
                let cleaned = newSpaceName.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !cleaned.isEmpty else { return }
                model.createSpace(named: cleaned)
                activeSpace = cleaned
                newSpaceName = ""
            }
        } message: { Text("Spaces keep related memories together.") }
        .alert("Rename Space", isPresented: Binding(get: { renamingSpace != nil }, set: { if !$0 { renamingSpace = nil } })) {
            TextField("Space name", text: $renamedSpaceName)
            Button("Cancel", role: .cancel) { renamingSpace = nil }
            Button("Rename") {
                guard let oldName = renamingSpace else { return }
                model.renameSpace(oldName, to: renamedSpaceName)
                activeSpace = renamedSpaceName.trimmingCharacters(in: .whitespacesAndNewlines)
                renamingSpace = nil
            }
        }
    }

    private var sideRail: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ZStack {
                    Circle()
                        .stroke(sidebarInk.opacity(0.82), lineWidth: 1.4)
                    Circle()
                        .stroke(sidebarInk.opacity(0.32), style: StrokeStyle(lineWidth: 1, dash: [2.2, 2.2]))
                        .padding(4)
                }
                .frame(width: 27, height: 27)

                Text("Recall")
                    .font(.system(size: 20, weight: .medium, design: .serif))
                    .foregroundStyle(.primary.opacity(0.88))
            }
            .padding(.horizontal, 18)
            .padding(.top, 22)
            .padding(.bottom, 24)

            sideNavigationButton(
                "Home",
                icon: "house",
                selected: mode == .everything && !likedOnly
            ) {
                likedOnly = false
                switchMode(.everything)
            }

            sideNavigationButton(
                "Liked",
                icon: likedOnly ? "heart.fill" : "heart",
                selected: mode == .everything && likedOnly
            ) {
                likedOnly = true
                switchMode(.everything)
            }

            sideNavigationButton("Spaces", icon: "rectangle.stack", selected: mode == .topOfMind) {
                switchMode(.topOfMind)
            }

            Spacer()

            SettingsLink {
                Label("Settings", systemImage: "gearshape")
                    .font(.system(size: 14, weight: .medium))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .frame(height: 46)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Settings")
            .padding(.horizontal, 10)
            .padding(.bottom, 18)
        }
        .foregroundStyle(sidebarInk)
        .frame(width: 154)
        .background(.ultraThinMaterial)
    }

    private func sideNavigationButton(
        _ title: String,
        icon: String,
        selected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.system(size: 14, weight: selected ? .semibold : .medium))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .frame(height: 48)
                .contentShape(Rectangle())
                .background(
                    selected ? AnyShapeStyle(Color.white.opacity(0.76)) : AnyShapeStyle(Color.clear),
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(selected ? Color.white.opacity(0.82) : Color.clear, lineWidth: 1)
                }
                .shadow(color: selected ? .black.opacity(0.07) : .clear, radius: 9, y: 3)
        }
        .buttonStyle(.plain)
        .help(title)
        .padding(.horizontal, 10)
    }

    private var sidebarInk: Color { Color(red: 0.45, green: 0.49, blue: 0.56) }

    private var ambientBackground: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.86, green: 0.91, blue: 0.96), Color(red: 0.93, green: 0.92, blue: 0.95), Color(red: 0.98, green: 0.91, blue: 0.84)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            Rectangle().fill(.ultraThinMaterial)
        }.ignoresSafeArea()
    }

    private var topControls: some View {
        HStack(spacing: 16) {
            ForEach(LibraryMode.allCases) { item in
                Button {
                    switchMode(item)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: item.icon)
                        if item == mode { Text(item.title) }
                    }
                        .padding(.horizontal, item == mode ? 10 : 4).padding(.vertical, 6)
                        .background(item == mode ? AnyShapeStyle(.ultraThinMaterial) : AnyShapeStyle(.clear), in: Capsule())
                }
                .help(item.title)
            }
            Spacer()
            Menu {
                Button("Save Files…", systemImage: "photo.on.rectangle") { model.chooseFiles() }
                Button("New Note", systemImage: "square.and.pencil") { showingNote = true }
            } label: { Image(systemName: "plus.circle.fill").font(.system(size: 18)) }
            .menuStyle(.borderlessButton).fixedSize()
            SettingsLink { Image(systemName: "gearshape") }.help("Settings")
        }
        .font(.system(size: 16, weight: .medium))
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
    }

    private var brand: some View {
        VStack(spacing: 10) {
            HStack(spacing: 9) {
                Image(systemName: "sparkles")
                    .font(.system(size: 29, weight: .bold))
                Text("Recall")
                    .font(.system(size: 38, weight: .bold, design: .rounded))
                    .tracking(-1.2)
            }
            Text(dateText)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.secondary)
        }
    }

    private var searchBar: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                if mode != .topOfMind {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass").foregroundStyle(sidebarInk)
                        TextField("Search your memories…", text: $model.query)
                            .textFieldStyle(.plain).font(.system(size: 15))
                            .focused($searchFocused).onSubmit { openSelected() }
                        if model.isIndexing { ProgressView().controlSize(.small) }
                        else if !model.query.isEmpty {
                            Button { model.query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }.buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 14).frame(width: 360, height: 48)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
                    .overlay { RoundedRectangle(cornerRadius: 10).stroke(.white.opacity(0.55)) }
                    addMenu
                }
                Spacer()
                HStack(spacing: 2) {
                    ForEach(LibraryMode.allCases) { item in
                        Button { switchMode(item) } label: {
                            Text(item.title).font(.system(size: 14, weight: item == mode ? .semibold : .regular))
                                .padding(.horizontal, 22).frame(height: 38)
                                .background(item == mode ? AnyShapeStyle(Color.white.opacity(0.92)) : AnyShapeStyle(Color.white.opacity(0.30)), in: RoundedRectangle(cornerRadius: 9))
                                .shadow(color: item == mode ? .black.opacity(0.08) : .clear, radius: 6, y: 2)
                        }.buttonStyle(.plain).foregroundStyle(item == mode ? Color.primary : Color.secondary)
                    }
                }
                .padding(3).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                .overlay { RoundedRectangle(cornerRadius: 12).stroke(.white.opacity(0.48)) }
                Button { isSelecting.toggle(); if !isSelecting { selectedPaths.removeAll() } } label: {
                    Label(isSelecting ? "Done" : "Select", systemImage: "checkmark.circle")
                }.buttonStyle(RecallButtonStyle())
            }

            if mode != .topOfMind || !model.query.isEmpty {
                HStack(spacing: 10) {
                    filterButton("Images", icon: "photo", active: imagesOnly) { imagesOnly.toggle(); if imagesOnly { notesOnly = false } }
                    filterButton("Notes", icon: "note.text", active: notesOnly) { notesOnly.toggle(); if notesOnly { imagesOnly = false } }
                    filterButton("Articles", icon: "doc.text", active: mode == .serendipity) { switchMode(mode == .serendipity ? .everything : .serendipity) }
                    filterButton("Liked", icon: "heart", active: likedOnly) { likedOnly.toggle() }
                    Menu {
                        Button("All colors") { selectedColor = nil }
                        Divider()
                        ForEach(RecallColorFilter.all) { choice in
                            Button { selectedColor = choice.name } label: {
                                HStack {
                                    Circle().fill(choice.color).frame(width: 11, height: 11)
                                    Text(choice.name)
                                    if selectedColor == choice.name { Image(systemName: "checkmark") }
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Circle().fill(RecallColorFilter.named(selectedColor)?.color ?? .clear)
                                .overlay { Circle().stroke(Color.secondary.opacity(0.5)) }.frame(width: 13, height: 13)
                            Text(selectedColor ?? "Color")
                            Image(systemName: "chevron.down").font(.caption2)
                        }
                        .font(.system(size: 13, weight: .medium)).padding(.horizontal, 12).frame(height: 34)
                        .background(selectedColor == nil ? Color(nsColor: .controlBackgroundColor).opacity(0.78) : Color.orange.opacity(0.13), in: Capsule())
                        .overlay { Capsule().stroke(Color.black.opacity(0.09)) }
                    }
                    .menuStyle(.borderlessButton).fixedSize()
                    Circle().fill(model.isIndexing ? Color.orange : Color.green).frame(width: 8, height: 8).padding(.leading, 8)
                    Text(model.isIndexing ? "Analyzing on device…" : "On-device analysis complete").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                }
            }
        }
        .frame(height: mode != .topOfMind || !model.query.isEmpty ? 102 : 64)
    }

    private var addMenu: some View {
        Menu {
            Button("Save Images or Files…", systemImage: "photo.on.rectangle") { model.chooseFiles() }
            Button("New Note", systemImage: "square.and.pencil") { showingNote = true }
            Button("Paste", systemImage: "doc.on.clipboard") { _ = pasteFromClipboard() }
        } label: {
            HStack(spacing: 8) { Image(systemName: "plus"); Image(systemName: "chevron.down").font(.caption) }
                .frame(width: 62, height: 46)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Color.white.opacity(0.72), lineWidth: 1)
                }
                .shadow(color: .black.opacity(0.07), radius: 7, y: 3)
                .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .menuStyle(.borderlessButton)
        .buttonStyle(.plain)
        .fixedSize()
        .help("Add to Recall")
    }

    private func filterButton(_ title: String, icon: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { filterLabel(title, icon: icon, active: active) }.buttonStyle(.plain)
    }

    private func filterLabel(_ title: String, icon: String, active: Bool) -> some View {
        HStack(spacing: 8) { Image(systemName: icon); Text(title); Image(systemName: "chevron.down").font(.caption2) }
            .font(.system(size: 13, weight: .medium)).padding(.horizontal, 12).frame(height: 34)
            .background(active ? AnyShapeStyle(Color.orange.opacity(0.14)) : AnyShapeStyle(.thinMaterial), in: RoundedRectangle(cornerRadius: 9))
            .overlay { RoundedRectangle(cornerRadius: 9).stroke(.white.opacity(0.5)) }
            .foregroundStyle(active ? Color.orange : Color.primary)
    }

    @ViewBuilder
    private var content: some View {
        if !model.query.isEmpty || mode == .everything {
            memoryCanvas
        } else if mode == .topOfMind {
            spacesWorkspace
        } else {
            memoryCanvas
        }
    }

    private var memoryCanvas: some View {
        VStack(spacing: 8) {
            HStack {
                Text(sectionTitle).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                if model.isIndexing {
                    HStack(spacing: 5) {
                        ProgressView().controlSize(.mini)
                        Image(systemName: "apple.logo")
                        Text("Analyzing on device")
                    }
                    .font(.caption).foregroundStyle(.secondary)
                    .padding(.trailing, 12)
                }
                if isSelecting {
                    Text("\(selectedPaths.count) selected")
                        .font(.caption.weight(.medium)).foregroundStyle(.secondary)
                    Button("Select All") { selectAllVisible() }
                        .buttonStyle(.borderless).font(.caption)
                    Button(role: .destructive) { withAnimation { confirmingBulkDelete = true } } label: {
                        Label("Delete", systemImage: "trash")
                    }
                    .buttonStyle(.borderedProminent).tint(.red).controlSize(.small)
                    .disabled(selectedPaths.isEmpty)
                    Button("Done") { endSelection() }
                        .buttonStyle(.bordered).controlSize(.small)
                } else {
                    Text(model.isIndexing ? model.progressText : "\(model.files.count) memories")
                        .font(.caption).foregroundStyle(.tertiary)
                }
            }
            if model.folders.isEmpty && model.files.isEmpty {
                welcomeCard
            } else if displayResults.isEmpty {
                emptyCard
            } else {
                resultsList
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private var spacesWorkspace: some View {
        HStack(spacing: 18) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 8) {
                    Image(systemName: "circle.hexagongrid").font(.title3)
                    Text("Recall").font(.title3.weight(.medium))
                }.padding(.bottom, 18)
                Text("SPACES").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                ForEach(model.spaceNames, id: \.self) { name in
                    Button { activeSpace = name; spaceInspectorFile = nil } label: {
                        HStack(spacing: 9) {
                            RoundedRectangle(cornerRadius: 2).fill(activeSpace == name ? Color.orange : .clear).frame(width: 3, height: 24)
                            Image(systemName: spaceIcon(for: name))
                            Text(name).lineLimit(1)
                            Spacer()
                            Text("\(model.spaces[name]?.count ?? 0)").font(.caption2).foregroundStyle(.secondary)
                        }.padding(.vertical, 8).padding(.horizontal, 7)
                         .background(activeSpace == name ? Color.white.opacity(0.72) : .clear, in: RoundedRectangle(cornerRadius: 9))
                         .shadow(color: activeSpace == name ? .black.opacity(0.05) : .clear, radius: 5, y: 2)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button("Rename…", systemImage: "pencil") { renamingSpace = name; renamedSpaceName = name }
                        Button("Delete Space", systemImage: "trash", role: .destructive) {
                            model.deleteSpace(named: name)
                            activeSpace = model.spaceNames.first ?? "Top of Mind"
                        }.disabled(model.spaceNames.count <= 1)
                    }
                }
                Button { showingNewSpace = true } label: {
                    Label("New Space", systemImage: "plus").font(.callout.weight(.medium)).frame(maxWidth: .infinity)
                }
                .buttonStyle(RecallButtonStyle(compact: true)).padding(.top, 12)
                Spacer()
            }
            .padding(14).frame(width: 178).frame(maxHeight: .infinity, alignment: .topLeading)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 15))
            .overlay { RoundedRectangle(cornerRadius: 15).stroke(Color.white.opacity(0.48)) }

            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Image(systemName: spaceIcon(for: activeSpace)).font(.title2).foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(activeSpace).font(.system(size: 25, weight: .semibold))
                        Text("\(displayResults.count) \(displayResults.count == 1 ? "memory" : "memories")").font(.caption).foregroundStyle(.secondary)
                    }
                    if activeSpace == "Top of Mind" {
                        Label("Smart Space", systemImage: "sparkles").font(.caption.weight(.medium))
                            .padding(.horizontal, 10).padding(.vertical, 6).background(Color.white.opacity(0.82), in: Capsule())
                    }
                    Spacer()
                }
                HStack(spacing: 10) {
                    HStack {
                        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                        TextField("Search this space…", text: $spaceSearch).textFieldStyle(.plain).focused($spaceSearchFocused)
                    }.padding(.horizontal, 11).frame(width: 280, height: 36)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 8))
                        .overlay { RoundedRectangle(cornerRadius: 8).stroke(Color.black.opacity(0.08)) }
                    Spacer()
                    if !displayResults.isEmpty {
                        Button { } label: { Image(systemName: "square.grid.3x3") }.buttonStyle(RecallButtonStyle(compact: true))
                        Button { } label: { Image(systemName: "rectangle.grid.1x2") }.buttonStyle(RecallButtonStyle(compact: true))
                    }
                    Menu {
                        Button("Save Images or Files…") { model.chooseFiles(addToSpace: activeSpace) }
                        Button("New Note") { showingNote = true }
                    } label: {
                        HStack(spacing: 7) {
                            Image(systemName: "plus")
                            Text("Add to Space")
                            Image(systemName: "chevron.down").font(.caption2)
                        }
                    }
                    .menuStyle(.borderlessButton).buttonStyle(RecallButtonStyle(compact: true)).fixedSize()
                }
                if displayResults.isEmpty {
                    VStack(spacing: 16) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 18).fill(Color.white.opacity(0.58)).frame(width: 76, height: 76)
                            Image(systemName: "rectangle.stack.badge.plus").font(.system(size: 30, weight: .light)).foregroundStyle(sidebarInk)
                        }
                        VStack(spacing: 5) {
                            Text("Nothing in \(activeSpace) yet").font(.title2.weight(.semibold))
                            Text("Add saved memories or import files directly into this space.").font(.callout).foregroundStyle(.secondary)
                        }
                        HStack(spacing: 10) {
                            Button { model.chooseFiles(addToSpace: activeSpace) } label: { Label("Add memories", systemImage: "plus") }
                                .buttonStyle(.borderedProminent).tint(.orange).controlSize(.large)
                            Button { switchMode(.everything) } label: { Label("Browse Everything", systemImage: "square.grid.2x2") }
                                .buttonStyle(RecallButtonStyle())
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.white.opacity(0.18), in: RoundedRectangle(cornerRadius: 18))
                    .overlay { RoundedRectangle(cornerRadius: 18).stroke(Color.white.opacity(0.38), style: StrokeStyle(lineWidth: 1, dash: [7])) }
                } else { resultsList }
            }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)

            if let file = spaceInspectorFile {
                spaceInspector(file)
            }
        }
    }

    private func spaceInspector(_ file: IndexedFile) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ThumbnailView(url: file.url, contentMode: .fill, requestedSize: CGSize(width: 500, height: 400))
                    .frame(width: 205, height: 160).clipped().clipShape(RoundedRectangle(cornerRadius: 10))
                Text(file.url.deletingPathExtension().lastPathComponent).font(.headline).lineLimit(2)
                Text("APPEARS IN").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                ForEach(model.spaceNames, id: \.self) { name in
                    Button { model.toggle(file, inSpace: name) } label: {
                        HStack {
                            Image(systemName: spaceIcon(for: name))
                            Text(name).lineLimit(1)
                            Spacer()
                            Image(systemName: model.isInSpace(file, name: name) ? "checkmark.square.fill" : "square")
                                .foregroundStyle(model.isInSpace(file, name: name) ? Color.orange : Color.secondary)
                        }.padding(8).background(Color.black.opacity(0.025), in: RoundedRectangle(cornerRadius: 7))
                    }.buttonStyle(.plain)
                }
                Divider()
                Text("TAGS").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                FlowTags(tags: Array(((file.aiTags ?? []) + model.tags(for: file)).prefix(12)))
                Button { detailFile = file } label: { Label("Open full details", systemImage: "info.circle") }
                    .buttonStyle(.bordered).frame(maxWidth: .infinity)
            }.padding(14)
        }
        .frame(width: 235).frame(maxHeight: .infinity)
        .background(Color.white.opacity(0.62), in: RoundedRectangle(cornerRadius: 12))
    }

    private func spaceIcon(for name: String) -> String {
        let lower = name.lowercased()
        if lower.contains("car") { return "car" }
        if lower.contains("fashion") { return "tshirt" }
        if lower.contains("read") { return "bookmark" }
        if lower.contains("travel") { return "airplane" }
        return "square.grid.2x2"
    }

    private var serendipityWorkspace: some View {
        let memories = displayResults
        return Group {
            if memories.isEmpty {
                ContentUnavailableView("Nothing to rediscover yet", systemImage: "sparkles", description: Text("Add a few memories and Recall will surface an unexpected one here."))
            } else {
                let index = min(serendipityIndex, memories.count - 1)
                let result = memories[index]
                let related = relatedMemories(around: index, in: memories)
                HStack(spacing: 16) {
                    VStack(spacing: 22) {
                        ForEach(Array(related.prefix(2).enumerated()), id: \.element.id) { offset, memory in
                            serendipityRelatedCard(memory, label: offset == 0 ? "Similar mood" : "Related color", memories: memories)
                        }
                    }.frame(width: 165)

                    HStack(spacing: 9) {
                        circleArrow("chevron.left") { stepSerendipity(-1, count: memories.count) }
                        VStack(spacing: 0) {
                            ThumbnailView(url: result.file.url, contentMode: .fill, requestedSize: CGSize(width: 900, height: 1000))
                                .frame(maxWidth: 400, maxHeight: 490).clipped().contentShape(Rectangle())
                                .onTapGesture { detailFile = result.file }
                            VStack(spacing: 7) {
                                Text(serendipityTitle(for: result.file)).font(.system(size: 24, design: .serif)).lineLimit(1)
                                Text("Saved \(relativeAge(result.file.modifiedAt))").font(.caption).foregroundStyle(.secondary)
                                HStack(spacing: 9) {
                                    Button { searchSameVibe(result.file) } label: { Label("Same vibe", systemImage: "heart") }.buttonStyle(RecallButtonStyle())
                                    Button { showForgotten(in: memories) } label: { Label("Show me something forgotten", systemImage: "shuffle") }.buttonStyle(RecallButtonStyle())
                                }.padding(.top, 6)
                            }.padding(15).frame(maxWidth: .infinity).background(Color.white)
                        }.frame(maxWidth: 400).clipShape(RoundedRectangle(cornerRadius: 14)).shadow(color: .black.opacity(0.10), radius: 16, y: 8)
                        circleArrow("chevron.right") { stepSerendipity(1, count: memories.count) }
                    }.frame(maxWidth: .infinity)

                    VStack(spacing: 22) {
                        ForEach(Array(related.dropFirst(2).prefix(2).enumerated()), id: \.element.id) { offset, memory in
                            serendipityRelatedCard(memory, label: offset == 0 ? "Related color" : "Similar mood", memories: memories)
                        }
                    }.frame(width: 165)
                    serendipityInspector(result.file)
                }.padding(.vertical, 8)
            }
        }
    }

    private func stepSerendipity(_ amount: Int, count: Int) {
        guard count > 0 else { return }
        serendipityIndex = (serendipityIndex + amount + count) % count
    }

    private func serendipityRelatedCard(_ result: SearchResult, label: String, memories: [SearchResult]) -> some View {
        Button {
            if let index = memories.firstIndex(where: { $0.id == result.id }) { serendipityIndex = index }
        } label: {
            VStack(spacing: 0) {
                ThumbnailView(url: result.file.url, contentMode: .fill, requestedSize: CGSize(width: 380, height: 380))
                    .frame(width: 165, height: 145).clipped()
                Label(label, systemImage: label == "Similar mood" ? "face.smiling" : "paintpalette")
                    .font(.caption).foregroundStyle(.secondary).padding(9).frame(maxWidth: .infinity, alignment: .leading).background(Color.white)
            }.clipShape(RoundedRectangle(cornerRadius: 10)).shadow(color: .black.opacity(0.06), radius: 7, y: 3)
        }.buttonStyle(.plain)
    }

    private func circleArrow(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 16, weight: .medium)).frame(width: 40, height: 40)
                .background(Color.white, in: Circle()).shadow(color: .black.opacity(0.08), radius: 6, y: 3)
        }.buttonStyle(.plain).foregroundStyle(sidebarInk)
    }

    private func serendipityInspector(_ file: IndexedFile) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("COLOR PALETTE").font(.caption.weight(.bold)).foregroundStyle(.secondary)
            HStack(spacing: 9) {
                ForEach(Array(paletteColors(for: file).enumerated()), id: \.offset) { _, color in
                    Circle().fill(color).frame(width: 27, height: 27).overlay { Circle().stroke(.black.opacity(0.06)) }
                }
            }
            Divider().padding(.vertical, 5)
            Text("RELATED TAGS").font(.caption.weight(.bold)).foregroundStyle(.secondary)
            FlowTags(tags: Array(((file.aiTags ?? []) + model.tags(for: file)).prefix(10)))
            Divider().padding(.vertical, 5)
            Text("AI CAPTION").font(.caption.weight(.bold)).foregroundStyle(.secondary)
            Text(file.aiCaption ?? "Recall found this memory through its visual mood, color, and meaning.").font(.callout).foregroundStyle(.secondary)
            Divider().padding(.vertical, 5)
            Text("MY NOTE").font(.caption.weight(.bold)).foregroundStyle(.secondary)
            Text(model.note(for: file).isEmpty ? "No note added yet." : model.note(for: file)).font(.callout).foregroundStyle(.secondary)
            Spacer()
        }.padding(18).frame(width: 225).frame(maxHeight: .infinity, alignment: .topLeading)
            .background(Color.white.opacity(0.62), in: RoundedRectangle(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).stroke(Color.black.opacity(0.07)) }
    }

    private func relatedMemories(around index: Int, in memories: [SearchResult]) -> [SearchResult] {
        guard memories.count > 1 else { return [] }
        return (1...min(4, memories.count - 1)).map { memories[(index + $0) % memories.count] }
    }

    private func searchSameVibe(_ file: IndexedFile) {
        model.query = (file.aiTags ?? []).prefix(3).joined(separator: " ")
        switchMode(.everything)
    }

    private func showForgotten(in memories: [SearchResult]) {
        serendipityIndex = memories.indices.min(by: { memories[$0].file.modifiedAt < memories[$1].file.modifiedAt }) ?? 0
    }

    private func serendipityTitle(for file: IndexedFile) -> String {
        if let caption = file.aiCaption, !caption.isEmpty { return caption.split(separator: ".").first.map(String.init) ?? caption }
        return file.url.deletingPathExtension().lastPathComponent.replacingOccurrences(of: "_", with: " ")
    }

    private func relativeAge(_ date: Date) -> String {
        RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
    }

    private func paletteColors(for file: IndexedFile) -> [Color] {
        let text = ((file.aiTags ?? []) + [file.searchableText]).joined(separator: " ").lowercased()
        let choices: [(String, Color)] = [("red", .red), ("orange", .orange), ("yellow", .yellow), ("green", .green), ("blue", .blue), ("purple", .purple), ("brown", Color(red: 0.44, green: 0.29, blue: 0.17)), ("gray", .gray), ("black", .black), ("white", .white)]
        let matches = choices.filter { text.contains($0.0) }.map(\.1)
        return matches.isEmpty ? [Color(red: 0.48, green: 0.46, blue: 0.32), Color(red: 0.72, green: 0.63, blue: 0.50), Color(red: 0.59, green: 0.36, blue: 0.16), Color(red: 0.34, green: 0.25, blue: 0.17), .gray] : Array(matches.prefix(5))
    }

    private func canvasInspector(_ file: IndexedFile) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text(file.contentType ?? "MEMORY").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                Spacer()
                Button { detailFile = nil } label: { Image(systemName: "xmark") }
                    .buttonStyle(.plain).foregroundStyle(.secondary)
            }.padding(.horizontal, 16).padding(.top, 14)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if inspectorShowsImage(file) {
                        ThumbnailView(url: file.url, contentMode: .fill, requestedSize: CGSize(width: 520, height: 360))
                            .frame(height: 132).frame(maxWidth: .infinity).clipped()
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    } else if file.contentType == "Article" {
                        Text(file.articleText ?? inspectorFallback(for: file))
                            .font(.system(size: 12, design: .serif)).lineSpacing(4).lineLimit(12)
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
                    }

                    Text(file.sourceTitle ?? file.aiCaption ?? file.url.deletingPathExtension().lastPathComponent)
                        .font(.system(size: 15, weight: .semibold)).lineLimit(2).padding(.top, 12)
                    Text(file.modifiedAt.formatted(date: .abbreviated, time: .shortened))
                        .font(.caption2).foregroundStyle(.secondary).padding(.top, 3)

                    inspectorSection("TLDR", top: 18) {
                        Text(file.aiCaption ?? inspectorFallback(for: file))
                            .font(.caption).foregroundStyle(.secondary).lineSpacing(3)
                    }

                    if let source = file.sourceURL, let url = URL(string: source) {
                        inspectorSection("SOURCE", top: 18) {
                            Button { NSWorkspace.shared.open(url) } label: {
                                HStack {
                                    Image(systemName: file.contentType == "Video" ? "play.rectangle" : "arrow.up.right.square")
                                    Text(file.sourceSite ?? url.host ?? "Original source").lineLimit(1)
                                    Spacer(); Image(systemName: "chevron.right").font(.caption2)
                                }.font(.caption.weight(.medium))
                            }.buttonStyle(.plain)
                        }
                    }

                    if inspectorShowsImage(file) {
                        inspectorSection("COLOR PALETTE", top: 18) {
                            HStack(spacing: 7) {
                                ForEach(DominantColorExtractor.palette(from: file.url)) { swatch in
                                    RoundedRectangle(cornerRadius: 4).fill(swatch.color).frame(height: 25)
                                        .overlay { RoundedRectangle(cornerRadius: 4).stroke(.white.opacity(0.55)) }
                                }
                            }
                        }
                    }

                    inspectorSection("MIND TAGS", top: 18) {
                        FlowTags(tags: Array(((file.aiTags ?? []) + model.tags(for: file)).prefix(8)))
                    }

                    inspectorSection("MIND NOTES", top: 18) {
                        Text(model.note(for: file).isEmpty ? "Add a personal note in full details." : model.note(for: file))
                            .font(.caption).foregroundStyle(.secondary).lineLimit(4)
                    }
                }.padding(14)
            }

            HStack(spacing: 8) {
                Button { model.toggleFavorite(file) } label: { Image(systemName: model.isFavorite(file) ? "star.fill" : "star") }
                Button { model.open(file) } label: { Image(systemName: "arrow.up.right.square") }
                Button { modalDetailFile = file } label: { Image(systemName: "ellipsis") }
                Button(role: .destructive) { detailFile = nil; requestDelete(file) } label: { Image(systemName: "trash") }
            }
            .buttonStyle(GlassIconButtonStyle()).padding(12)
        }
        .frame(width: 250).frame(maxHeight: .infinity)
        .background(.ultraThinMaterial)
        .overlay(alignment: .leading) { Rectangle().fill(.white.opacity(0.38)).frame(width: 1) }
    }

    private func inspectorFallback(for file: IndexedFile) -> String {
        if file.contentType == "Video" { return "A saved video ready to watch from its original source." }
        if file.contentType == "Article" { return "An article saved for reading, reference, and future search." }
        let text = file.searchableText.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? "A private memory saved in Recall." : String(text.prefix(180))
    }

    private func inspectorShowsImage(_ file: IndexedFile) -> Bool {
        ContentExtractor.imageExtensions.contains(file.url.pathExtension.lowercased())
            && !["Highlight", "Quote", "Article", "Note"].contains(file.contentType ?? "")
    }

    private func inspectorSection<Content: View>(_ title: String, top: CGFloat, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(title).font(.system(size: 9, weight: .bold)).foregroundStyle(.secondary)
            content()
        }.padding(.top, top).frame(maxWidth: .infinity, alignment: .leading)
    }

    private var welcomeCard: some View {
        VStack(spacing: 9) {
            Text("Nothing saved yet").font(.title3.weight(.medium))
            Text("Use the + button above, paste, or drag something here to begin.")
                .font(.callout).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyCard: some View {
        HStack(spacing: 12) {
            Image(systemName: "doc.text.magnifyingglass").font(.title2).foregroundStyle(.secondary)
            Text(model.query.isEmpty ? "Your recently modified files will appear here." : "No matching files found.")
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(18)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var resultsList: some View {
        GeometryReader { geometry in
            let cardWidth = max(130, (geometry.size.width - 40) / 5)
            let columns = masonryColumns(width: cardWidth)
            ScrollView {
                HStack(alignment: .top, spacing: 10) {
                    ForEach(0..<5, id: \.self) { column in
                        LazyVStack(spacing: 10) {
                            if column == 0 && model.query.isEmpty && mode == .everything {
                                NewNoteCard(width: cardWidth) { showingNote = true }
                            }
                            ForEach(columns[column], id: \.result.id) { item in
                                GalleryCard(
                                    result: item.result,
                                    cardWidth: cardWidth,
                                    previewHeight: item.height,
                                    selected: model.selectedID == item.result.id,
                                    selectionMode: isSelecting,
                                    multiSelected: selectedPaths.contains(item.result.file.path),
                                    favorite: model.isFavorite(item.result.file),
                                    onToggleSelection: { toggleSelection(item.result.file) },
                                    onFavorite: { model.toggleFavorite(item.result.file) },
                                    onDelete: { requestDelete(item.result.file) }
                                )
                                .onTapGesture(count: 2) {
                                    if isSelecting { toggleSelection(item.result.file) }
                                    else { model.open(item.result.file) }
                                }
                                .onTapGesture {
                                    if isSelecting {
                                        toggleSelection(item.result.file)
                                    } else {
                                        model.selectedID = item.result.id
                                        if mode == .topOfMind { spaceInspectorFile = item.result.file }
                                        else { detailFile = item.result.file }
                                    }
                                }
                                .contextMenu {
                                    Button("Open") { model.open(item.result.file) }
                                    Button("Show in Finder") { model.reveal(item.result.file) }
                                    Button(model.isFavorite(item.result.file) ? "Remove from Top of Mind" : "Add to Top of Mind") {
                                        model.toggleFavorite(item.result.file)
                                    }
                                    Menu("Add to Space") {
                                        ForEach(model.spaceNames, id: \.self) { name in
                                            Button {
                                                model.toggle(item.result.file, inSpace: name)
                                            } label: {
                                                Label(name, systemImage: model.isInSpace(item.result.file, name: name) ? "checkmark" : "rectangle.stack")
                                            }
                                        }
                                        Divider()
                                        Button("New Space…") { showingNewSpace = true }
                                    }
                                    Button(selectedPaths.contains(item.result.file.path) ? "Deselect" : "Select") {
                                        isSelecting = true
                                        toggleSelection(item.result.file)
                                    }
                                    Divider()
                                    Button("Move to Trash", role: .destructive) { requestDelete(item.result.file) }
                                }
                            }
                        }
                        .frame(width: cardWidth)
                    }
                }
                .frame(width: geometry.size.width, alignment: .leading)
                .padding(.vertical, 10)
            }
        }
        .frame(maxHeight: .infinity)
    }

    private func masonryColumns(width: CGFloat) -> [[(result: SearchResult, height: CGFloat)]] {
        var columnHeights = [CGFloat](repeating: 0, count: 5)
        if model.query.isEmpty && mode == .everything { columnHeights[0] = 218 }
        var output = [[(result: SearchResult, height: CGFloat)]](repeating: [], count: 5)

        for result in displayResults.prefix(40) {
            let height = naturalPreviewHeight(for: result.file, width: width)
            let column = columnHeights.enumerated().min(by: { $0.element < $1.element })?.offset ?? 0
            output[column].append((result, height))
            columnHeights[column] += height + 30
        }
        return output
    }

    private func naturalPreviewHeight(for file: IndexedFile, width: CGFloat) -> CGFloat {
        if file.contentType == "Article" { return min(360, max(270, width * 1.18)) }
        if ContentExtractor.imageExtensions.contains(file.url.pathExtension.lowercased()),
           let ratio = ThumbnailCache.shared.aspectRatio(for: file.url) {
            return min(310, max(120, width * ratio))
        }
        if file.kind == "MD" || file.kind == "TXT" { return 170 }
        if file.kind == "PDF" { return 260 }
        return 190
    }

    private func moveSelection(_ delta: Int) {
        guard !displayResults.isEmpty else { return }
        let visible = Array(displayResults.prefix(40))
        let current = visible.firstIndex { $0.id == model.selectedID } ?? 0
        model.selectedID = visible[min(max(current + delta, 0), visible.count - 1)].id
    }

    private func openSelected() {
        if let result = displayResults.first(where: { $0.id == model.selectedID }) { model.open(result.file) }
    }

    private var sectionTitle: String {
        if !model.query.isEmpty { return "Best Matches" }
        switch mode {
        case .everything: return greeting
        case .topOfMind: return "Spaces"
        case .serendipity: return "Saved Articles"
        }
    }

    private func stableOrder(_ value: String) -> UInt64 {
        value.utf8.reduce(1469598103934665603) { ($0 ^ UInt64($1)) &* 1099511628211 }
    }

    private func toggleSelection(_ file: IndexedFile) {
        withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
            if selectedPaths.contains(file.path) { selectedPaths.remove(file.path) }
            else { selectedPaths.insert(file.path) }
        }
    }

    private func selectAllVisible() {
        selectedPaths.formUnion(displayResults.prefix(40).map { $0.file.path })
    }

    private func endSelection() {
        selectedPaths.removeAll()
        isSelecting = false
    }

    private func deleteSelectedItems() {
        let selected = model.files.filter { selectedPaths.contains($0.path) }
        confirmingBulkDelete = false
        endSelection()
        model.deleteFromRecall(selected)
    }

    private func requestDelete(_ file: IndexedFile) {
        withAnimation(.spring(response: 0.34, dampingFraction: 0.88)) { pendingDelete = file }
    }

    private func switchMode(_ newMode: LibraryMode) {
        withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
            mode = newMode
            model.query = ""
        }
    }

    @ViewBuilder
    private var deletionOverlay: some View {
        if let file = pendingDelete {
            ZStack {
                Color.black.opacity(0.24).ignoresSafeArea().onTapGesture { withAnimation { pendingDelete = nil } }
                VStack(spacing: 18) {
                    ZStack(alignment: .topTrailing) {
                        ThumbnailView(url: file.url, contentMode: .fill, requestedSize: CGSize(width: 280, height: 220))
                            .frame(width: 210, height: 150).clipped()
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        Image(systemName: "trash.fill")
                            .font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                            .frame(width: 34, height: 34).background(Color.red, in: Circle())
                            .offset(x: 9, y: -9).shadow(color: .black.opacity(0.18), radius: 8, y: 3)
                    }
                    VStack(spacing: 7) {
                        Text("Remove this memory?").font(.title2.weight(.semibold))
                        Text(file.sourceTitle ?? file.url.deletingPathExtension().lastPathComponent)
                            .font(.callout).foregroundStyle(.secondary).lineLimit(2).multilineTextAlignment(.center)
                        Label("Recoverable from macOS Trash", systemImage: "arrow.uturn.backward.circle")
                            .font(.caption).foregroundStyle(.secondary)
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(Color.black.opacity(0.035), in: Capsule())
                    }
                    HStack(spacing: 10) {
                        Button("Keep it") { withAnimation { pendingDelete = nil } }
                            .buttonStyle(RecallButtonStyle()).frame(maxWidth: .infinity)
                        Button {
                            let deleting = file
                            withAnimation { pendingDelete = nil }
                            model.deleteFromRecall(deleting)
                        } label: { Label("Move to Trash", systemImage: "trash") }
                            .buttonStyle(PremiumDestructiveButtonStyle()).frame(maxWidth: .infinity)
                    }
                }
                .padding(26).frame(width: 390)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 24).stroke(Color.white.opacity(0.65)) }
                .shadow(color: .black.opacity(0.22), radius: 35, y: 16)
                .transition(.scale(scale: 0.92).combined(with: .opacity))
            }
            .zIndex(100)
        } else if confirmingBulkDelete {
            ZStack {
                Color.black.opacity(0.24).ignoresSafeArea().onTapGesture { withAnimation { confirmingBulkDelete = false } }
                VStack(spacing: 18) {
                    Image(systemName: "rectangle.stack.badge.minus")
                        .font(.system(size: 38, weight: .medium)).foregroundStyle(.red)
                        .frame(width: 76, height: 76).background(Color.red.opacity(0.09), in: Circle())
                    VStack(spacing: 7) {
                        Text("Remove \(selectedPaths.count) memories?").font(.title2.weight(.semibold))
                        Text("They will remain recoverable from macOS Trash.")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                    HStack(spacing: 10) {
                        Button("Cancel") { withAnimation { confirmingBulkDelete = false } }
                            .buttonStyle(RecallButtonStyle()).frame(maxWidth: .infinity)
                        Button(action: deleteSelectedItems) { Label("Move All to Trash", systemImage: "trash") }
                            .buttonStyle(PremiumDestructiveButtonStyle()).frame(maxWidth: .infinity)
                    }
                }
                .padding(28).frame(width: 400)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 24).stroke(Color.white.opacity(0.65)) }
                .shadow(color: .black.opacity(0.22), radius: 35, y: 16)
                .transition(.scale(scale: 0.92).combined(with: .opacity))
            }
            .zIndex(100)
        }
    }

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        var accepted = false
        let openPageURL = activeSafariPageURL()
        for provider in providers {
            let suggestedName = provider.suggestedName
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                accepted = true
                provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
                    let url: URL?
                    if let value = item as? URL { url = value }
                    else if let data = item as? Data { url = URL(dataRepresentation: data, relativeTo: nil) }
                    else { url = nil }
                    guard let url else { return }
                    Task { @MainActor in
                        if url.isFileURL { model.importFiles([url]) }
                        else { model.importRemoteImage(url, suggestedName: suggestedName) }
                    }
                }
                continue
            }

            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                accepted = true
                provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
                    let url = (item as? URL) ?? (item as? String).flatMap(URL.init(string:))
                    guard let url else { return }
                    Task { @MainActor in
                        model.importRemoteImage(url, suggestedName: suggestedName, sourcePageURL: isDirectImageURL(url) ? openPageURL : nil)
                    }
                }
                continue
            }

            let preferredImageTypes = [UTType.heic.identifier, UTType.png.identifier, UTType.tiff.identifier, UTType.jpeg.identifier]
            let imageType = preferredImageTypes.first(where: provider.hasItemConformingToTypeIdentifier)
                ?? provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .image) == true })
            if let imageType {
                accepted = true
                provider.loadDataRepresentation(forTypeIdentifier: imageType) { data, _ in
                    guard let data else { return }
                    Task { @MainActor in model.importImageData(data, suggestedName: suggestedName, typeIdentifier: imageType, sourceURL: openPageURL) }
                }
                continue
            }

            if provider.hasItemConformingToTypeIdentifier(UTType.html.identifier) {
                accepted = true
                provider.loadDataRepresentation(forTypeIdentifier: UTType.html.identifier) { data, _ in
                    guard let data, let html = String(data: data, encoding: .utf8), let url = firstImageURL(in: html) else { return }
                    Task { @MainActor in model.importRemoteImage(url, suggestedName: suggestedName) }
                }
                continue
            }

            if provider.hasItemConformingToTypeIdentifier(UTType.text.identifier) {
                accepted = true
                provider.loadItem(forTypeIdentifier: UTType.text.identifier, options: nil) { item, _ in
                    let text = (item as? String) ?? (item as? Data).flatMap { String(data: $0, encoding: .utf8) }
                    guard let text, let url = firstImageURL(in: text) ?? URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)) else { return }
                    Task { @MainActor in model.importRemoteImage(url, suggestedName: suggestedName) }
                }
            }

        }
        return accepted
    }

    private func pasteFromClipboard() -> Bool {
        let pasteboard = NSPasteboard.general
        let clipboardURL = pasteboard.string(forType: .URL).flatMap(URL.init(string:))
            ?? (pasteboard.readObjects(forClasses: [NSURL.self], options: nil)?.first as? URL)
        let sourceURL = clipboardURL.flatMap { isDirectImageURL($0) ? (activeSafariPageURL() ?? $0) : $0 }
            ?? activeSafariPageURL()
        let preferred: [(NSPasteboard.PasteboardType, String)] = [
            (NSPasteboard.PasteboardType(UTType.heic.identifier), UTType.heic.identifier),
            (.png, UTType.png.identifier),
            (NSPasteboard.PasteboardType(UTType.jpeg.identifier), UTType.jpeg.identifier),
            (NSPasteboard.PasteboardType(UTType.webP.identifier), UTType.webP.identifier),
            (.tiff, UTType.tiff.identifier)
        ]
        for (type, identifier) in preferred {
            if let data = pasteboard.data(forType: type) {
                model.importImageData(data, suggestedName: sourceURL?.deletingPathExtension().lastPathComponent ?? "Saved image", typeIdentifier: identifier, sourceURL: sourceURL)
                return true
            }
        }
        if let image = pasteboard.readObjects(forClasses: [NSImage.self], options: nil)?.first as? NSImage,
           let tiff = image.tiffRepresentation,
           let bitmap = NSBitmapImageRep(data: tiff),
           let png = bitmap.representation(using: .png, properties: [:]) {
            model.importImageData(png, suggestedName: sourceURL?.deletingPathExtension().lastPathComponent ?? "Saved image", typeIdentifier: UTType.png.identifier, sourceURL: sourceURL)
            return true
        }
        if let text = pasteboard.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !text.isEmpty {
            let firstLine = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? "Pasted text"
            let title = firstLine.count > 52 ? String(firstLine.prefix(49)) + "…" : firstLine
            model.createNote(title: title, body: text)
            return true
        }
        model.captureMessage = "No image or text found on the clipboard"
        return false
    }

    private func isDirectImageURL(_ url: URL) -> Bool {
        ContentExtractor.imageExtensions.contains(url.pathExtension.lowercased())
            || url.host?.lowercased().contains("pinimg.com") == true
            || url.host?.lowercased().contains("images.") == true
    }

    private func activeSafariPageURL() -> URL? {
        let source = #"tell application "Safari" to if (count of documents) > 0 then return URL of front document"#
        var error: NSDictionary?
        guard let value = NSAppleScript(source: source)?.executeAndReturnError(&error).stringValue,
              let url = URL(string: value),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return nil }
        return url
    }

    nonisolated private func firstImageURL(in text: String) -> URL? {
        let decoded = text.replacingOccurrences(of: "&amp;", with: "&")
        let patterns = [
            #"(?:property|name)=[\"'](?:og:image|twitter:image(?::src)?)[\"'][^>]+content=[\"']([^\"']+)[\"']"#,
            #"content=[\"']([^\"']+)[\"'][^>]+(?:property|name)=[\"'](?:og:image|twitter:image(?::src)?)[\"']"#,
            #"https?://i\.pinimg\.com/[^\"'\s<>]+"#,
            #"<img[^>]+src=[\"']([^\"']+)[\"']"#
        ]
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
                  let match = regex.firstMatch(in: decoded, range: NSRange(decoded.startIndex..., in: decoded)) else { continue }
            let capture = match.numberOfRanges > 1 ? 1 : 0
            guard let range = Range(match.range(at: capture), in: decoded),
                  let url = URL(string: String(decoded[range])) else { continue }
            return url
        }
        return nil
    }
}

private struct FlowTags: View {
    let tags: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(Array(tags.chunked(into: 2).enumerated()), id: \.offset) { _, row in
                HStack(spacing: 6) {
                    ForEach(row, id: \.self) { tag in
                        Text(tag)
                            .font(.caption)
                            .padding(.horizontal, 9).padding(.vertical, 6)
                            .background(Color.black.opacity(0.055), in: Capsule())
                    }
                }
            }
        }
    }
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        guard size > 0 else { return [] }
        return stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
    }
}

private struct RecallButtonStyle: ButtonStyle {
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: compact ? 12 : 13, weight: .medium))
            .foregroundStyle(Color.primary)
            .padding(.horizontal, compact ? 10 : 14)
            .frame(height: compact ? 34 : 38)
            .background(configuration.isPressed ? AnyShapeStyle(Color.black.opacity(0.06)) : AnyShapeStyle(.thinMaterial), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Color.white.opacity(0.52), lineWidth: 1) }
            .shadow(color: .black.opacity(configuration.isPressed ? 0.02 : 0.045), radius: 3, y: 1)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
    }
}

private struct GlassIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .medium))
            .frame(width: 40, height: 36)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 9))
            .overlay { RoundedRectangle(cornerRadius: 9).stroke(.white.opacity(0.55)) }
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

private struct PremiumDestructiveButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 15).frame(height: 40)
            .background(
                LinearGradient(colors: [Color(red: 0.93, green: 0.24, blue: 0.22), Color(red: 0.78, green: 0.08, blue: 0.12)], startPoint: .top, endPoint: .bottom),
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
            .shadow(color: Color.red.opacity(configuration.isPressed ? 0.12 : 0.26), radius: configuration.isPressed ? 3 : 9, y: 4)
            .scaleEffect(configuration.isPressed ? 0.975 : 1)
            .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
    }
}

private struct RecallColorFilter: Identifiable {
    let name: String
    let color: Color
    let tokens: [String]
    var id: String { name }

    static let all: [RecallColorFilter] = [
        .init(name: "Crimson", color: Color(red: 0.72, green: 0.05, blue: 0.12), tokens: ["crimson", "burgundy", "maroon", "red"]),
        .init(name: "Red", color: .red, tokens: ["red", "scarlet"]),
        .init(name: "Coral", color: Color(red: 1, green: 0.42, blue: 0.34), tokens: ["coral", "salmon", "red", "orange"]),
        .init(name: "Orange", color: .orange, tokens: ["orange", "tangerine"]),
        .init(name: "Amber", color: Color(red: 1, green: 0.67, blue: 0.08), tokens: ["amber", "gold", "orange", "yellow"]),
        .init(name: "Yellow", color: .yellow, tokens: ["yellow", "gold"]),
        .init(name: "Lime", color: Color(red: 0.58, green: 0.82, blue: 0.16), tokens: ["lime", "yellow green", "green"]),
        .init(name: "Green", color: .green, tokens: ["green", "emerald"]),
        .init(name: "Mint", color: Color(red: 0.42, green: 0.88, blue: 0.68), tokens: ["mint", "seafoam", "green", "teal"]),
        .init(name: "Teal", color: Color(red: 0.05, green: 0.56, blue: 0.55), tokens: ["teal", "turquoise", "cyan", "green", "blue"]),
        .init(name: "Cyan", color: .cyan, tokens: ["cyan", "aqua", "turquoise", "blue"]),
        .init(name: "Sky", color: Color(red: 0.28, green: 0.68, blue: 0.95), tokens: ["sky", "light blue", "cyan", "blue"]),
        .init(name: "Blue", color: .blue, tokens: ["blue", "azure"]),
        .init(name: "Navy", color: Color(red: 0.04, green: 0.12, blue: 0.34), tokens: ["navy", "dark blue", "blue"]),
        .init(name: "Indigo", color: .indigo, tokens: ["indigo", "blue", "purple"]),
        .init(name: "Purple", color: .purple, tokens: ["purple", "violet"]),
        .init(name: "Lavender", color: Color(red: 0.72, green: 0.62, blue: 0.90), tokens: ["lavender", "lilac", "purple"]),
        .init(name: "Pink", color: .pink, tokens: ["pink", "magenta"]),
        .init(name: "Rose", color: Color(red: 0.88, green: 0.31, blue: 0.46), tokens: ["rose", "pink", "red"]),
        .init(name: "Brown", color: .brown, tokens: ["brown", "chocolate"]),
        .init(name: "Tan", color: Color(red: 0.72, green: 0.54, blue: 0.36), tokens: ["tan", "camel", "brown", "beige"]),
        .init(name: "Beige", color: Color(red: 0.86, green: 0.81, blue: 0.69), tokens: ["beige", "cream", "ivory", "tan"]),
        .init(name: "Gray", color: .gray, tokens: ["gray", "grey", "silver"]),
        .init(name: "Black", color: .black, tokens: ["black", "charcoal"]),
        .init(name: "White", color: .white, tokens: ["white", "ivory", "cream"])
    ]

    static func named(_ name: String?) -> RecallColorFilter? {
        guard let name else { return nil }
        return all.first { $0.name == name }
    }
}

private enum LibraryMode: String, CaseIterable, Identifiable {
    case everything, topOfMind, serendipity
    var id: String { rawValue }
    var title: String {
        switch self { case .everything: return "Everything"; case .topOfMind: return "Spaces"; case .serendipity: return "Articles" }
    }
    var icon: String {
        switch self { case .everything: return "square.grid.2x2"; case .topOfMind: return "rectangle.stack"; case .serendipity: return "doc.text" }
    }
}

@MainActor
private struct NewNoteCard: View {
    let width: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                Text("ADD NEW NOTE")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.orange)
                Text("Start typing here…")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.black)
                VStack(spacing: 13) {
                    ForEach(0..<6, id: \.self) { _ in Divider().opacity(0.35) }
                }
                Spacer(minLength: 0)
            }
            .padding(15)
            .frame(width: width, height: 208, alignment: .topLeading)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10).stroke(Color.black.opacity(0.09), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
    }
}

@MainActor
private struct QuickNoteView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var bodyText = ""
    @AppStorage("recallNoteTypeface") private var noteTypeface = RecallNoteTypeface.serif.rawValue
    let onSave: (String, String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("New Note").font(.title2.bold())
            TextField("Title", text: $title).font(.title3).textFieldStyle(.plain)
            Divider()
            TextEditor(text: $bodyText).font(selectedTypeface.font(size: 16)).scrollContentBackground(.hidden)
                .frame(minHeight: 180)
            HStack {
                Text("Saved privately on this Mac").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Save") { onSave(title, bodyText); dismiss() }.buttonStyle(.borderedProminent)
            }
        }
        .padding(24).frame(width: 480, height: 340)
        .background(.ultraThinMaterial)
    }

    private var selectedTypeface: RecallNoteTypeface { RecallNoteTypeface(rawValue: noteTypeface) ?? .serif }
}

@MainActor
private struct GalleryCard: View {
    let result: SearchResult
    let cardWidth: CGFloat
    let previewHeight: CGFloat
    let selected: Bool
    let selectionMode: Bool
    let multiSelected: Bool
    let favorite: Bool
    let onToggleSelection: () -> Void
    let onFavorite: () -> Void
    let onDelete: () -> Void
    @State private var hovering = false
    @AppStorage("recallNoteTypeface") private var noteTypeface = RecallNoteTypeface.serif.rawValue

    var body: some View {
        VStack(alignment: .center, spacing: 7) {
            ZStack(alignment: .topTrailing) {
                Group {
                    if result.file.contentType == "Article" {
                        VStack(spacing: 0) {
                            VStack(alignment: .leading, spacing: 16) {
                                Image(systemName: "book.pages")
                                    .font(.system(size: 18, weight: .medium))
                                    .foregroundStyle(Color(red: 0.49, green: 0.55, blue: 0.65))
                                Spacer(minLength: 2)
                                Text(friendlyTitle)
                                    .font(selectedTypeface.font(size: max(20, cardWidth * 0.105)))
                                    .foregroundStyle(.primary)
                                    .lineSpacing(-1).lineLimit(3)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(18)
                            .frame(height: previewHeight * 0.54)
                            .background(Color(nsColor: .controlBackgroundColor))

                            ZStack(alignment: .bottomTrailing) {
                                if ContentExtractor.imageExtensions.contains(result.file.url.pathExtension.lowercased()) {
                                    ThumbnailView(url: result.file.url, contentMode: .fill, requestedSize: CGSize(width: cardWidth * 1.4, height: previewHeight))
                                        .frame(width: cardWidth, height: previewHeight * 0.46).clipped()
                                } else if let heroURL = articleHeroURL(for: result.file) {
                                    AsyncImage(url: heroURL) { phase in
                                        if case let .success(image) = phase { image.resizable().scaledToFill() }
                                        else { Color(red: 0.88, green: 0.91, blue: 0.94) }
                                    }
                                    .frame(width: cardWidth, height: previewHeight * 0.46).clipped()
                                } else {
                                    LinearGradient(colors: [Color(red: 0.22, green: 0.31, blue: 0.43), Color(red: 0.55, green: 0.68, blue: 0.70)], startPoint: .topLeading, endPoint: .bottomTrailing)
                                        .frame(height: previewHeight * 0.46)
                                        .overlay { Image(systemName: "text.book.closed").font(.system(size: 42)).foregroundStyle(.white.opacity(0.65)) }
                                }
                                Label("ARTICLE", systemImage: "arrow.up.right.square")
                                    .font(.system(size: 10, weight: .semibold)).tracking(1.4)
                                    .padding(.horizontal, 10).padding(.vertical, 7)
                                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 4))
                                    .padding(7)
                            }
                        }
                        .frame(width: cardWidth, height: previewHeight)
                    } else if result.file.contentType == "Quote" {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text("QUOTE").font(.system(size: 9, weight: .bold)).tracking(1.6).foregroundStyle(Color.orange)
                                Spacer()
                                Image(systemName: "quote.opening").font(.system(size: 26, weight: .light)).foregroundStyle(Color.orange.opacity(0.34))
                            }
                            Text(noteText)
                                .font(selectedTypeface.font(size: 17))
                                .foregroundStyle(Color(red: 0.28, green: 0.20, blue: 0.17))
                                .multilineTextAlignment(.center).lineSpacing(5).lineLimit(9)
                                .frame(maxWidth: .infinity, alignment: .center)
                            Spacer(minLength: 0)
                            HStack {
                                if let site = result.file.sourceSite {
                                    Label(site, systemImage: "safari").font(.caption2).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(result.file.modifiedAt.formatted(date: .abbreviated, time: .omitted)).font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        .padding(19)
                        .frame(width: cardWidth, height: previewHeight, alignment: .topLeading)
                        .background(
                            LinearGradient(colors: [Color(red: 1.0, green: 0.96, blue: 0.91), Color(red: 0.98, green: 0.88, blue: 0.80)], startPoint: .topLeading, endPoint: .bottomTrailing)
                        )
                    } else if result.file.contentType == "Highlight" {
                        HStack(spacing: 0) {
                            Rectangle().fill(Color(red: 1.0, green: 0.78, blue: 0.14)).frame(width: 6)
                            VStack(alignment: .leading, spacing: 14) {
                                HStack {
                                    Label("WEB HIGHLIGHT", systemImage: "highlighter")
                                        .font(.system(size: 9, weight: .bold)).tracking(1.2).foregroundStyle(Color(red: 0.72, green: 0.45, blue: 0.02))
                                    Spacer()
                                }
                                Text(noteText)
                                    .font(selectedTypeface.font(size: 15)).foregroundStyle(.black.opacity(0.82))
                                    .lineSpacing(5).lineLimit(9)
                                    .padding(.horizontal, 3)
                                    .background(LinearGradient(colors: [.clear, Color.yellow.opacity(0.42), Color.yellow.opacity(0.42), .clear], startPoint: .top, endPoint: .bottom))
                                Spacer(minLength: 0)
                                HStack {
                                    if let site = result.file.sourceSite { Label(site, systemImage: "link").font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                                    Spacer()
                                    Image(systemName: "arrow.up.right").font(.caption2).foregroundStyle(.secondary)
                                }
                            }.padding(17)
                        }
                        .frame(width: cardWidth, height: previewHeight, alignment: .topLeading)
                        .background(Color(red: 1.0, green: 0.99, blue: 0.94))
                    } else if result.file.kind == "MD" || result.file.kind == "TXT" {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(noteText)
                                .font(selectedTypeface.font(size: 15))
                                .foregroundStyle(.primary.opacity(0.84))
                                .multilineTextAlignment(.leading).lineLimit(9)
                            Spacer(minLength: 0)
                            HStack {
                                Text(result.file.modifiedAt.formatted(date: .abbreviated, time: .omitted)).font(.caption2).foregroundStyle(.secondary)
                                Spacer()
                                Label("NOTE", systemImage: "note.text")
                                    .font(.system(size: 8, weight: .bold)).padding(.horizontal, 8).padding(.vertical, 5)
                                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 5))
                            }
                        }
                        .padding(18).frame(width: cardWidth, height: previewHeight, alignment: .topLeading)
                        .background(Color(nsColor: .controlBackgroundColor))
                    } else {
                        ThumbnailView(
                            url: result.file.url,
                            contentMode: .fill,
                            requestedSize: CGSize(width: cardWidth * 2, height: previewHeight * 2)
                        )
                            .frame(width: cardWidth, height: previewHeight)
                            .background(Color(nsColor: .controlBackgroundColor))
                            .clipped()
                            .overlay(alignment: .bottom) { mediaFooter }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 7)
                        .stroke(multiSelected ? Color.accentColor : selected ? Color.accentColor.opacity(0.7) : Color.black.opacity(0.045), lineWidth: multiSelected ? 3 : selected ? 1.5 : 1)
                }
                .overlay {
                    if result.file.contentType == "Video" {
                        Image(systemName: "play.fill")
                            .font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
                            .frame(width: 48, height: 48)
                            .background(.black.opacity(0.62), in: Circle())
                            .overlay { Circle().stroke(.white.opacity(0.55), lineWidth: 1) }
                            .shadow(color: .black.opacity(0.28), radius: 10, y: 4)
                    }
                }

                if selectionMode {
                    Button(action: onToggleSelection) {
                        Image(systemName: multiSelected ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(multiSelected ? Color.accentColor : Color.white)
                            .shadow(color: .black.opacity(0.35), radius: 3)
                    }
                    .buttonStyle(.plain).padding(9)
                } else if hovering {
                    Button(action: onDelete) { Image(systemName: "trash") }
                    .font(.system(size: 11, weight: .semibold))
                    .buttonStyle(.plain)
                    .padding(7)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(7)
                }
            }

        }
        .frame(width: cardWidth)
        .scaleEffect(hovering ? 1.012 : 1)
        .shadow(color: .black.opacity(hovering ? 0.11 : 0), radius: hovering ? 12 : 0, y: 6)
        .animation(.spring(response: 0.30, dampingFraction: 0.82), value: hovering)
        .animation(.spring(response: 0.28, dampingFraction: 0.82), value: multiSelected)
        .onHover { hovering = $0 }
    }

    private var selectedTypeface: RecallNoteTypeface { RecallNoteTypeface(rawValue: noteTypeface) ?? .serif }

    private var mediaFooter: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                if result.file.contentType == "Video" {
                    Image(systemName: "play.rectangle.fill").foregroundStyle(.red)
                }
                Text(friendlyTitle).font(.system(size: 10.5, weight: .semibold)).lineLimit(1)
                Spacer()
                if result.file.contentType == "Product" { Image(systemName: "arrow.up.right.square") }
                Button(action: onFavorite) {
                    Image(systemName: favorite ? "heart.fill" : "heart")
                        .foregroundStyle(favorite ? .red : .white.opacity(0.9))
                }.buttonStyle(.plain)
            }
            HStack(spacing: 4) {
                if let site = result.file.sourceSite { Text(site) }
                else { Text(result.file.modifiedAt.formatted(date: .abbreviated, time: .omitted)) }
                if result.file.contentType == "Product", let price = result.file.detectedPrice { Text("•"); Text(price) }
            }.font(.system(size: 8.5)).foregroundStyle(.white.opacity(0.78)).lineLimit(1)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 10).padding(.top, 30).padding(.bottom, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient(colors: [.clear, .black.opacity(0.62)], startPoint: .top, endPoint: .bottom))
    }

    private var friendlyTitle: String {
        if ["Video", "Article"].contains(result.file.contentType ?? ""), let title = result.file.sourceTitle, !title.isEmpty {
            return title
        }
        if result.file.contentType == "Highlight", let title = result.file.sourceTitle, !title.isEmpty {
            return title
        }
        if let caption = result.file.aiCaption?.trimmingCharacters(in: .whitespacesAndNewlines), !caption.isEmpty {
            return caption.split(separator: ".").first.map(String.init) ?? caption
        }
        return result.file.url.deletingPathExtension().lastPathComponent
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: #"(?i)^pasted image(?: [A-F0-9]+)?$"#, with: "Saved image", options: .regularExpression)
    }

    private func articleHeroURL(for file: IndexedFile) -> URL? {
        guard let html = file.articleHTML,
              let regex = try? NSRegularExpression(pattern: #"<img\b[^>]*?src=["']([^"']+)["']"#, options: .caseInsensitive),
              let match = regex.firstMatch(in: html, range: NSRange(html.startIndex..., in: html)),
              let range = Range(match.range(at: 1), in: html) else { return nil }
        let value = String(html[range]).replacingOccurrences(of: "&amp;", with: "&")
        if let absolute = URL(string: value), absolute.scheme != nil { return absolute }
        guard let source = file.sourceURL, let base = URL(string: source) else { return nil }
        return URL(string: value, relativeTo: base)?.absoluteURL
    }

    private var noteText: String {
        let text = result.file.searchableText
            .replacingOccurrences(of: "# ", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return String(text.prefix(420))
    }
}

@MainActor
private struct ImageDetailView: View {
    @Environment(\.dismiss) private var dismiss
    let file: IndexedFile
    let favorite: Bool
    let tags: [String]
    let note: String
    let onFavorite: () -> Void
    let onSaveTags: ([String]) -> Void
    let onSaveNote: (String) -> Void
    let onSaveContent: (String) -> Void
    let onRefreshSource: () -> Void
    let onSaveSource: (String) -> Void
    let onOpen: () -> Void
    let onDelete: () -> Void
    @State private var tagText: String
    @State private var noteText: String
    @State private var newTag = ""
    @State private var addingTag = false
    @State private var colorPalette: [PaletteSwatch] = []
    @State private var sourceText = ""
    @State private var editingSource = false
    @State private var contentText: String
    @AppStorage("recallAppearance") private var appearance = RecallAppearance.system.rawValue
    @AppStorage("recallNoteTypeface") private var noteTypeface = RecallNoteTypeface.serif.rawValue

    init(file: IndexedFile, favorite: Bool, tags: [String], note: String, onFavorite: @escaping () -> Void, onSaveTags: @escaping ([String]) -> Void, onSaveNote: @escaping (String) -> Void, onSaveContent: @escaping (String) -> Void, onRefreshSource: @escaping () -> Void, onSaveSource: @escaping (String) -> Void, onOpen: @escaping () -> Void, onDelete: @escaping () -> Void) {
        self.file = file
        self.favorite = favorite
        self.tags = tags
        self.note = note
        self.onFavorite = onFavorite
        self.onSaveTags = onSaveTags
        self.onSaveNote = onSaveNote
        self.onSaveContent = onSaveContent
        self.onRefreshSource = onRefreshSource
        self.onSaveSource = onSaveSource
        self.onOpen = onOpen
        self.onDelete = onDelete
        _tagText = State(initialValue: tags.joined(separator: ", "))
        _noteText = State(initialValue: note)
        _sourceText = State(initialValue: file.sourceURL ?? "")
        let rawContent = (try? String(contentsOf: file.url, encoding: .utf8)) ?? file.searchableText
        if file.contentType != "Highlight", rawContent.hasPrefix("# ") {
            let lines = rawContent.split(separator: "\n", omittingEmptySubsequences: false)
            let heading = lines.first.map { String($0.dropFirst(2)) } ?? ""
            let body = lines.dropFirst().joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            _contentText = State(initialValue: body.isEmpty ? heading : body)
        } else {
            _contentText = State(initialValue: rawContent)
        }
    }

    private var dimensions: String? {
        guard let image = NSImage(contentsOf: file.url) else { return nil }
        guard let rep = image.representations.max(by: { ($0.pixelsWide * $0.pixelsHigh) < ($1.pixelsWide * $1.pixelsHigh) }) else { return nil }
        return "\(rep.pixelsWide) × \(rep.pixelsHigh) px"
    }

    private var sizeText: String {
        ByteCountFormatter.string(fromByteCount: file.byteSize, countStyle: .file)
    }

    private var sourceActionTitle: String {
        if file.contentType == "Video" { return "Watch video" }
        if file.contentType == "Product" { return file.detectedPrice.map { "Buy for \($0)" } ?? "View product" }
        return "Open source"
    }

    private func openVideo() {
        if let source = file.sourceURL, let url = URL(string: source) { NSWorkspace.shared.open(url) }
        else { onOpen() }
    }

    private var isTextMemory: Bool {
        file.contentType == "Highlight" || file.kind == "MD" || file.kind == "TXT"
    }

    var body: some View {
        Group {
            if file.contentType == "Article" { articleDetail }
            else if isTextMemory { textMemoryDetail }
            else { imageDetail }
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .foregroundStyle(Color.primary)
        .preferredColorScheme(RecallAppearance(rawValue: appearance)?.scheme)
        .task(id: file.path) {
            guard !isTextMemory, file.contentType != "Video" else { return }
            colorPalette = DominantColorExtractor.palette(from: file.url)
        }
    }

    private var articleDetail: some View {
        HStack(spacing: 0) {
            if let html = file.articleHTML, !html.isEmpty {
                ArticleReaderView(html: html, baseURL: file.sourceURL.flatMap(URL.init(string:)))
                    .frame(width: 650, height: 650)
            } else { ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    Text(file.sourceTitle ?? file.url.deletingPathExtension().lastPathComponent)
                        .font(selectedTypeface.font(size: 40, weight: .medium))
                        .lineSpacing(3).frame(maxWidth: .infinity, alignment: .leading)

                    if ContentExtractor.imageExtensions.contains(file.url.pathExtension.lowercased()) {
                        ThumbnailView(url: file.url, contentMode: .fit, requestedSize: CGSize(width: 1100, height: 900))
                            .frame(maxWidth: .infinity).frame(height: 390)
                            .background(Color.black.opacity(0.035), in: RoundedRectangle(cornerRadius: 12))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }

                    Text(articleBody)
                        .font(selectedTypeface.font(size: 20))
                        .lineSpacing(10).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    if let source = file.sourceURL, let url = URL(string: source) {
                        Button { NSWorkspace.shared.open(url) } label: {
                            Label("Continue reading the original article", systemImage: "arrow.up.right.square")
                        }.buttonStyle(RecallButtonStyle())
                    }
                }
                .padding(.horizontal, 52).padding(.vertical, 42)
            }
            .frame(width: 650, height: 650)
            .background(Color(nsColor: .textBackgroundColor))
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(file.sourceTitle ?? file.url.deletingPathExtension().lastPathComponent)
                                .font(.title2.weight(.medium)).lineLimit(2)
                            HStack(spacing: 5) {
                                Text(relativeArticleDate)
                                if let site = file.sourceSite { Label(site, systemImage: "arrow.up.right.square") }
                            }.font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button(action: onRefreshSource) { Image(systemName: "arrow.clockwise") }
                            .buttonStyle(.plain).font(.title3).foregroundStyle(.secondary).help("Refresh and extract article text")
                        Button { dismiss() } label: { Image(systemName: "xmark.circle.fill") }
                            .buttonStyle(.plain).font(.title2).foregroundStyle(.secondary)
                    }

                    Text("TLDR").font(.caption.weight(.bold)).foregroundStyle(.orange)
                        .padding(.top, 28).padding(.bottom, 8)
                    Text(articleSummary)
                        .font(.system(size: 16)).foregroundStyle(.secondary).lineSpacing(4)
                        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.orange.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
                        .overlay { RoundedRectangle(cornerRadius: 10).stroke(Color.orange.opacity(0.32)) }

                    Button(action: onFavorite) {
                        Label(favorite ? "I’ve read this article" : "Mark as read", systemImage: favorite ? "checkmark.seal.fill" : "checkmark.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(RecallButtonStyle()).padding(.top, 18)

                    Text("MIND TAGS").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                        .padding(.top, 28).padding(.bottom, 10)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), spacing: 7)], alignment: .leading, spacing: 7) {
                        Button { addingTag.toggle() } label: {
                            Label("Add tag", systemImage: "plus").font(.caption.weight(.semibold)).foregroundStyle(.white)
                                .padding(.horizontal, 10).padding(.vertical, 7).background(Color.orange, in: Capsule())
                        }.buttonStyle(.plain)
                        ForEach(allDisplayTags, id: \.self) { tag in
                            Text(tag).font(.caption).padding(.horizontal, 10).padding(.vertical, 7)
                                .background(Color.black.opacity(0.055), in: Capsule())
                        }
                    }
                    if addingTag {
                        HStack { TextField("New tag", text: $newTag).textFieldStyle(.roundedBorder).onSubmit { addTag() }; Button("Add") { addTag() } }
                            .padding(.top, 9)
                    }

                    Text("MIND NOTES").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                        .padding(.top, 28).padding(.bottom, 9)
                    TextEditor(text: $noteText).font(.callout).scrollContentBackground(.hidden)
                        .padding(8).frame(height: 110).background(Color.black.opacity(0.035), in: RoundedRectangle(cornerRadius: 9))
                    HStack {
                        Button("Delete", role: .destructive, action: onDelete)
                        Spacer()
                        Button { onSaveNote(noteText) } label: { Label("Save note", systemImage: "note.text.badge.plus") }
                            .buttonStyle(RecallButtonStyle(compact: true))
                    }.padding(.top, 10)
                }
                .padding(26).frame(width: 410).frame(minHeight: 650, alignment: .top)
            }
            .frame(width: 410, height: 650)
            .background(Color(nsColor: .windowBackgroundColor))
        }
        .frame(width: 1060, height: 650)
    }

    private var articleBody: String {
        if let articleText = file.articleText?.trimmingCharacters(in: .whitespacesAndNewlines), !articleText.isEmpty {
            return articleText
        }
        let cleaned = contentText
            .replacingOccurrences(of: file.sourceURL ?? "", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !cleaned.isEmpty { return cleaned }
        return articleSummary + "\n\nRecall saved this article’s source and cover privately. Open the original article to read the complete text."
    }

    private var articleSummary: String {
        if let caption = file.aiCaption, !caption.isEmpty { return caption }
        let text = file.searchableText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty, !text.hasPrefix("http") { return String(text.prefix(360)) }
        return "An article saved from \(file.sourceSite ?? "the web") for reading and reference."
    }

    private var relativeArticleDate: String {
        let formatter = RelativeDateTimeFormatter(); formatter.unitsStyle = .full
        return formatter.localizedString(for: file.modifiedAt, relativeTo: Date())
    }

    private var imageDetail: some View {
        HStack(spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                Color(red: 0.20, green: 0.15, blue: 0.10)
                ThumbnailView(
                    url: file.url,
                    contentMode: .fit,
                    requestedSize: CGSize(width: 1300, height: 1300)
                )
                    .padding(28)
                if file.contentType == "Video" {
                    Button(action: openVideo) {
                        Image(systemName: "play.fill")
                            .font(.system(size: 27, weight: .bold)).foregroundStyle(.white)
                            .frame(width: 72, height: 72).background(.black.opacity(0.68), in: Circle())
                            .overlay { Circle().stroke(.white.opacity(0.55), lineWidth: 1.5) }
                            .shadow(color: .black.opacity(0.3), radius: 16, y: 7)
                    }.buttonStyle(.plain)
                }
                HStack(spacing: 8) {
                    if let dimensions { Text(dimensions) }
                    Text("•")
                    Text(sizeText)
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(.white.opacity(0.85))
                .padding(12)
                .background(.black.opacity(0.35), in: Capsule())
                .padding(18)
            }
            .frame(width: 650, height: 650)

            ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(file.contentType == "Video" ? (file.sourceTitle ?? file.url.deletingPathExtension().lastPathComponent) : file.url.deletingPathExtension().lastPathComponent)
                            .font(.title2.weight(.medium)).lineLimit(2)
                        Text(file.modifiedAt.formatted(date: .abbreviated, time: .shortened))
                            .font(.caption).foregroundStyle(.secondary)
                        if let source = file.sourceURL, let url = URL(string: source) {
                            Button {
                                NSWorkspace.shared.open(url)
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: file.contentType == "Video" ? "play.circle" : file.contentType == "Product" ? "cart" : "link")
                                    Text(sourceActionTitle)
                                    Image(systemName: "arrow.up.right")
                                }
                                .font(.caption.weight(.semibold))
                            }
                            .buttonStyle(RecallButtonStyle(compact: true))
                            .help(source)
                        } else {
                            Button {
                                NSWorkspace.shared.activateFileViewerSelecting([file.url])
                            } label: {
                                Label("Show original file", systemImage: "folder")
                                    .font(.caption.weight(.semibold))
                            }
                            .buttonStyle(RecallButtonStyle(compact: true))
                        }
                    }
                    Spacer()
                    Button { dismiss() } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.plain).font(.title2).foregroundStyle(.secondary)
                }
                .padding(.bottom, 20)

                Text("TLDR").font(.caption.weight(.bold)).foregroundStyle(.orange)
                Text(file.contentType == "Video" ? (file.sourceTitle ?? "Video saved to Recall. Open it anytime from its original source.") : (file.aiCaption ?? "AI description will appear after this image is analyzed."))
                    .font(.system(size: 16)).foregroundStyle(.secondary)
                    .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.orange.opacity(0.055), in: RoundedRectangle(cornerRadius: 10))
                    .overlay { RoundedRectangle(cornerRadius: 10).stroke(Color.orange.opacity(0.45)) }
                    .padding(.top, 7)

                if let source = file.sourceURL, let url = URL(string: source) {
                    VStack(alignment: .leading, spacing: 9) {
                        HStack {
                            Label(file.contentType ?? "Web source", systemImage: contentTypeIcon(file.contentType))
                                .font(.caption.weight(.bold)).foregroundStyle(.orange)
                            Spacer()
                            Button { editingSource.toggle() } label: { Image(systemName: "pencil") }
                                .buttonStyle(.plain).help("Change product source")
                            Button { onRefreshSource() } label: { Image(systemName: "arrow.clockwise") }
                                .buttonStyle(.plain).help("Refresh source details")
                        }
                        Text(file.sourceTitle ?? url.host ?? "Original webpage").font(.headline).lineLimit(2)
                        HStack {
                            Text(file.sourceSite ?? url.host ?? "Website").font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            if file.contentType == "Product" {
                                VStack(alignment: .trailing, spacing: 1) {
                                    Text("CURRENT PRICE").font(.system(size: 8, weight: .bold)).foregroundStyle(.secondary)
                                    Text(file.detectedPrice ?? "Not available").font(.title3.weight(.semibold))
                                }
                            }
                        }
                        Button { NSWorkspace.shared.open(url) } label: {
                            Label(file.contentType == "Video" ? "Watch on YouTube" : file.detectedPrice == nil ? "Open source" : "View or buy", systemImage: file.contentType == "Video" ? "play.rectangle" : "arrow.up.right.square")
                                .frame(maxWidth: .infinity)
                        }.buttonStyle(RecallButtonStyle())
                        if editingSource {
                            HStack {
                                TextField("Exact product-page URL", text: $sourceText).textFieldStyle(.roundedBorder)
                                Button("Save") { onSaveSource(sourceText) }.buttonStyle(RecallButtonStyle(compact: true))
                            }
                        }
                    }
                    .padding(13).background(Color.black.opacity(0.025), in: RoundedRectangle(cornerRadius: 11))
                    .overlay { RoundedRectangle(cornerRadius: 11).stroke(Color.black.opacity(0.08)) }
                    .padding(.top, 14)
                } else if file.contentType == "Product" {
                    VStack(alignment: .leading, spacing: 9) {
                        Label("ADD PRODUCT SOURCE", systemImage: "link.badge.plus")
                            .font(.caption.weight(.bold)).foregroundStyle(.orange)
                        Text("Paste the exact product-page link to retrieve its official name, website and current price.")
                            .font(.caption).foregroundStyle(.secondary)
                        TextField("https://store.example/product", text: $sourceText).textFieldStyle(.roundedBorder)
                        Button { onSaveSource(sourceText) } label: {
                            Label("Find product details", systemImage: "magnifyingglass")
                                .frame(maxWidth: .infinity)
                        }.buttonStyle(RecallButtonStyle()).disabled(sourceText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    .padding(13).background(Color.black.opacity(0.025), in: RoundedRectangle(cornerRadius: 11))
                    .overlay { RoundedRectangle(cornerRadius: 11).stroke(Color.black.opacity(0.08)) }
                    .padding(.top, 14)
                } else {
                    HStack(spacing: 10) {
                        Image(systemName: file.contentType == "Video" ? "film" : "doc")
                            .font(.title3).foregroundStyle(.orange)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(file.contentType == "Video" ? "LOCAL VIDEO" : "LOCAL MEMORY").font(.caption.weight(.bold)).foregroundStyle(.orange)
                            Text("Stored privately on this Mac").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .padding(13).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.black.opacity(0.025), in: RoundedRectangle(cornerRadius: 11))
                    .padding(.top, 14)
                }

                if file.contentType != "Video" {
                    Text("COLOR PALETTE")
                        .font(.caption.weight(.bold)).foregroundStyle(.secondary)
                        .padding(.top, 18).padding(.bottom, 9)
                    HStack(spacing: 12) {
                        if colorPalette.isEmpty {
                            ProgressView().controlSize(.small)
                            Text("Reading colors on device…").font(.caption).foregroundStyle(.secondary)
                        } else {
                            ForEach(colorPalette) { swatch in
                                VStack(spacing: 5) {
                                    Circle().fill(swatch.color).frame(width: 36, height: 36)
                                        .overlay { Circle().stroke(Color.black.opacity(0.10)) }
                                    Text(swatch.hex).font(.system(size: 8, design: .monospaced)).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }

                Text("MIND TAGS")
                    .font(.caption.weight(.bold)).foregroundStyle(.secondary)
                    .padding(.top, 18).padding(.bottom, 10)

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), spacing: 7)], alignment: .leading, spacing: 7) {
                    Button {
                        addingTag.toggle()
                    } label: {
                        Label("Add tag", systemImage: "plus")
                            .font(.caption.weight(.semibold)).foregroundStyle(.white)
                            .padding(.horizontal, 10).padding(.vertical, 7)
                            .background(Color.orange, in: Capsule())
                    }.buttonStyle(.plain)
                    ForEach(allDisplayTags, id: \.self) { tag in
                        Text(tag).font(.caption)
                            .padding(.horizontal, 10).padding(.vertical, 7)
                            .background(Color.black.opacity(0.055), in: Capsule())
                    }
                }
                if addingTag {
                    HStack {
                        TextField("New tag", text: $newTag).textFieldStyle(.roundedBorder)
                            .onSubmit { addTag() }
                        Button("Add") { addTag() }
                    }.padding(.top, 10)
                }

                Text("MIND NOTES")
                    .font(.caption.weight(.bold)).foregroundStyle(.secondary)
                    .padding(.top, 24).padding(.bottom, 9)
                TextEditor(text: $noteText)
                    .font(.callout).scrollContentBackground(.hidden)
                    .padding(8).frame(height: 105)
                    .background(Color.black.opacity(0.035), in: RoundedRectangle(cornerRadius: 9))
                    .overlay { RoundedRectangle(cornerRadius: 9).stroke(Color.black.opacity(0.08)) }
                HStack {
                    Spacer()
                    Button { onSaveNote(noteText) } label: {
                        Label(noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Add note" : "Save note", systemImage: "note.text.badge.plus")
                    }.buttonStyle(.bordered)
                }

                Text("DETECTED CONTENT")
                    .font(.caption.weight(.bold)).foregroundStyle(.secondary)
                    .padding(.top, 12).padding(.bottom, 5)
                ScrollView {
                    Text(detectedContent)
                        .font(.caption).foregroundStyle(.secondary)
                        .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }.frame(height: 48)

                Spacer()
                HStack {
                    Button(action: onFavorite) {
                        Label(favorite ? "Liked" : "Like", systemImage: favorite ? "heart.fill" : "heart")
                            .foregroundStyle(favorite ? .red : .primary)
                    }
                    Button("Open Original", action: onOpen).buttonStyle(.borderedProminent)
                    Spacer()
                    Button("Delete", role: .destructive, action: onDelete)
                }
            }
            .padding(26).frame(width: 410, alignment: .top)
            }
            .frame(width: 410, height: 650)
        }
        .frame(width: 1060, height: 650)
    }

    private var textMemoryDetail: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 9) {
                    Image(systemName: file.contentType == "Highlight" ? "highlighter" : file.contentType == "Quote" ? "quote.opening" : file.contentType == "Article" ? "doc.text" : "note.text")
                    Text(file.contentType == "Highlight" ? "WEB HIGHLIGHT" : file.contentType == "Quote" ? "QUOTE" : file.contentType == "Article" ? "ARTICLE" : "NOTE")
                    Spacer()
                    Text("Editable").font(.caption2.weight(.semibold))
                        .padding(.horizontal, 9).padding(.vertical, 5)
                        .background(Color.black.opacity(0.055), in: Capsule())
                }
                .font(.caption.weight(.bold))
                .foregroundStyle(file.contentType == "Highlight" ? Color.orange : Color.secondary)
                .padding(.horizontal, 30).padding(.top, 26).padding(.bottom, 18)

                TextEditor(text: $contentText)
                    .font(selectedTypeface.font(size: 20))
                    .lineSpacing(8)
                    .scrollContentBackground(.hidden)
                    .padding(25)
                    .background(file.contentType == "Highlight" ? Color.yellow.opacity(0.23) : Color(nsColor: .textBackgroundColor))
                    .overlay(alignment: .topLeading) {
                        if file.contentType == "Highlight" {
                            Rectangle().fill(Color.yellow.opacity(0.48)).frame(height: 9).padding(.horizontal, 26).padding(.top, 24)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay { RoundedRectangle(cornerRadius: 16).stroke(Color.black.opacity(0.08)) }
                    .padding(.horizontal, 30)

                HStack {
                    Text("\(contentText.count) characters").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button { onSaveContent(contentText) } label: {
                        Label("Save changes", systemImage: "checkmark.circle.fill")
                    }.buttonStyle(RecallButtonStyle())
                }
                .padding(.horizontal, 30).padding(.vertical, 20)
            }
            .frame(width: 650, height: 650)
            .background(file.contentType == "Highlight" ? Color(red: 1, green: 0.99, blue: 0.93) : Color(red: 0.975, green: 0.972, blue: 0.963))

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(file.sourceTitle ?? file.url.deletingPathExtension().lastPathComponent)
                                .font(.title2.weight(.medium)).lineLimit(3)
                            Text(file.modifiedAt.formatted(date: .abbreviated, time: .shortened))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button { dismiss() } label: { Image(systemName: "xmark.circle.fill") }
                            .buttonStyle(.plain).font(.title2).foregroundStyle(.secondary)
                    }

                    if let source = file.sourceURL, let url = URL(string: source) {
                        VStack(alignment: .leading, spacing: 10) {
                            Label(file.contentType == "Article" ? "ARTICLE SOURCE" : "ORIGINAL SOURCE", systemImage: "safari")
                                .font(.caption.weight(.bold)).foregroundStyle(.orange)
                            Text(file.sourceSite ?? url.host ?? "Website")
                                .font(.headline).lineLimit(2)
                            Text(url.host ?? source).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            Button { NSWorkspace.shared.open(url) } label: {
                                Label("Open original page", systemImage: "arrow.up.right.square")
                                    .frame(maxWidth: .infinity)
                            }.buttonStyle(RecallButtonStyle())
                        }
                        .padding(14).background(Color.orange.opacity(0.045), in: RoundedRectangle(cornerRadius: 12))
                        .overlay { RoundedRectangle(cornerRadius: 12).stroke(Color.orange.opacity(0.18)) }
                        .padding(.top, 20)
                    }

                    Text("TAGS").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                        .padding(.top, 24).padding(.bottom, 10)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), spacing: 7)], alignment: .leading, spacing: 7) {
                        Button { addingTag.toggle() } label: {
                            Label("Add tag", systemImage: "plus").font(.caption.weight(.semibold))
                                .foregroundStyle(.white).padding(.horizontal, 10).padding(.vertical, 7)
                                .background(Color.orange, in: Capsule())
                        }.buttonStyle(.plain)
                        ForEach(allDisplayTags, id: \.self) { tag in
                            Text(tag).font(.caption).padding(.horizontal, 10).padding(.vertical, 7)
                                .background(Color.black.opacity(0.055), in: Capsule())
                        }
                    }
                    if addingTag {
                        HStack {
                            TextField("New tag", text: $newTag).textFieldStyle(.roundedBorder).onSubmit { addTag() }
                            Button("Add") { addTag() }
                        }.padding(.top, 10)
                    }

                    Text("MY NOTE").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                        .padding(.top, 26).padding(.bottom, 9)
                    TextEditor(text: $noteText)
                        .font(.callout).scrollContentBackground(.hidden).padding(8).frame(height: 125)
                        .background(Color.black.opacity(0.035), in: RoundedRectangle(cornerRadius: 10))
                        .overlay { RoundedRectangle(cornerRadius: 10).stroke(Color.black.opacity(0.08)) }
                    HStack {
                        Spacer()
                        Button { onSaveNote(noteText) } label: { Label("Save note", systemImage: "note.text.badge.plus") }
                            .buttonStyle(RecallButtonStyle(compact: true))
                    }.padding(.top, 8)

                    Spacer(minLength: 28)
                    HStack {
                        Button(action: onFavorite) {
                            Label(favorite ? "Liked" : "Like", systemImage: favorite ? "heart.fill" : "heart")
                                .foregroundStyle(favorite ? .red : .primary)
                        }
                        Spacer()
                        Button("Delete", role: .destructive, action: onDelete)
                    }
                }
                .padding(26).frame(width: 410).frame(minHeight: 650, alignment: .top)
            }
            .frame(width: 410, height: 650)
        }
        .frame(width: 1060, height: 650)
    }

    private func saveTags() {
        onSaveTags(tagText.split(separator: ",").map(String.init))
    }

    private var selectedTypeface: RecallNoteTypeface { RecallNoteTypeface(rawValue: noteTypeface) ?? .serif }

    private func contentTypeIcon(_ type: String?) -> String {
        switch type {
        case "Product": return "bag"
        case "Article": return "doc.text"
        case "Recipe": return "fork.knife"
        case "Video": return "play.rectangle"
        case "Place": return "mappin.and.ellipse"
        case "Screenshot": return "macwindow"
        case "Quote": return "quote.opening"
        case "Document": return "doc.richtext"
        case "Spreadsheet": return "tablecells"
        case "Presentation": return "rectangle.on.rectangle"
        case "Audio": return "waveform"
        case "Archive": return "archivebox"
        default: return "link"
        }
    }

    private var allDisplayTags: [String] {
        var seen = Set<String>()
        let currentManualTags = tagText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        return ((file.aiTags ?? []) + currentManualTags + basicDetectedTags).filter { seen.insert($0.lowercased()).inserted }.prefix(18).map { $0 }
    }

    private var basicDetectedTags: [String] {
        let ignored = Set(["image", "saved", "pasted", "light", "dark", "neutral", "with", "from", "this", "that"])
        return file.searchableText.lowercased()
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .map(String.init)
            .filter { $0.count > 2 && !ignored.contains($0) }
            .reduce(into: [String]()) { result, word in
                if !result.contains(word) { result.append(word) }
            }
            .prefix(10).map { $0 }
    }

    private var detectedContent: String {
        let text = file.searchableText.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? "No OCR or Apple Vision content detected." : String(text.prefix(900))
    }

    private func addTag() {
        let cleaned = newTag.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return }
        let updated = tags + [cleaned]
        tagText = updated.joined(separator: ", ")
        onSaveTags(updated)
        newTag = ""
        addingTag = false
    }
}

private struct PaletteSwatch: Identifiable {
    let id: String
    let color: Color
    let hex: String
}

@MainActor
private enum DominantColorExtractor {
    private static var cache: [String: [PaletteSwatch]] = [:]

    static func palette(from url: URL) -> [PaletteSwatch] {
        let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        let key = "\(url.path)|\(values?.contentModificationDate?.timeIntervalSince1970 ?? 0)|\(values?.fileSize ?? 0)"
        if let cached = cache[key] { return cached }
        guard let image = NSImage(contentsOf: url),
              let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 48, pixelsHigh: 48, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return [] }
        bitmap.size = NSSize(width: 48, height: 48)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        image.draw(in: NSRect(x: 0, y: 0, width: 48, height: 48), from: .zero, operation: .copy, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()

        var buckets: [Int: (count: Int, red: CGFloat, green: CGFloat, blue: CGFloat)] = [:]
        for y in stride(from: 0, to: 48, by: 2) {
            for x in stride(from: 0, to: 48, by: 2) {
                guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB), color.alphaComponent > 0.45 else { continue }
                let r = color.redComponent, g = color.greenComponent, b = color.blueComponent
                let key = Int(r * 7) * 64 + Int(g * 7) * 8 + Int(b * 7)
                let old = buckets[key] ?? (0, 0, 0, 0)
                buckets[key] = (old.count + 1, old.red + r, old.green + g, old.blue + b)
            }
        }
        let ranked = buckets.values.sorted { left, right in
            let leftRGB = (left.red / CGFloat(left.count), left.green / CGFloat(left.count), left.blue / CGFloat(left.count))
            let rightRGB = (right.red / CGFloat(right.count), right.green / CGFloat(right.count), right.blue / CGFloat(right.count))
            let leftSaturation = max(leftRGB.0, leftRGB.1, leftRGB.2) - min(leftRGB.0, leftRGB.1, leftRGB.2)
            let rightSaturation = max(rightRGB.0, rightRGB.1, rightRGB.2) - min(rightRGB.0, rightRGB.1, rightRGB.2)
            return CGFloat(left.count) * (1 + leftSaturation * 1.8) > CGFloat(right.count) * (1 + rightSaturation * 1.8)
        }
        var chosen: [(CGFloat, CGFloat, CGFloat)] = []
        if let dominant = buckets.values.max(by: { $0.count < $1.count }) {
            chosen.append((dominant.red / CGFloat(dominant.count), dominant.green / CGFloat(dominant.count), dominant.blue / CGFloat(dominant.count)))
        }
        for bucket in ranked {
            guard bucket.count > 0 else { continue }
            let rgb = (bucket.red / CGFloat(bucket.count), bucket.green / CGFloat(bucket.count), bucket.blue / CGFloat(bucket.count))
            let distinct = chosen.allSatisfy { existing in
                abs(existing.0 - rgb.0) + abs(existing.1 - rgb.1) + abs(existing.2 - rgb.2) > 0.28
            }
            if distinct { chosen.append(rgb) }
            if chosen.count == 5 { break }
        }
        let result = chosen.map { r, g, b in
            let hex = String(format: "#%02X%02X%02X", Int(r * 255), Int(g * 255), Int(b * 255))
            return PaletteSwatch(id: hex, color: Color(red: r, green: g, blue: b), hex: hex)
        }
        if cache.count > 300 { cache.removeAll(keepingCapacity: true) }
        cache[key] = result
        return result
    }
}

private struct DetailLine: View {
    let label: String
    let value: String
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(.secondary).frame(width: 82, alignment: .leading)
            Text(value).textSelection(.enabled)
        }.font(.callout)
    }
}

extension Notification.Name {
    static let focusRecallSearch = Notification.Name("focusRecallSearch")
    static let pasteRecallImage = Notification.Name("pasteRecallImage")
    static let typeIntoRecallSearch = Notification.Name("typeIntoRecallSearch")
}
