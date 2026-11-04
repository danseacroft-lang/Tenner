// Tenner Layout: a small Mac app for trying new layouts of tenner.stream by dragging things about.
// It shows the live site at computer and phone sizes, lets you drag sections into new places, and writes the moves down
// as plain instructions to paste to Claude. It never changes the site or its code.
import SwiftUI
import WebKit
import AppKit

enum Size: String, CaseIterable, Identifiable {
    case computer = "Computer", phone = "Phone"
    var id: String { rawValue }
    var icon: String { self == .computer ? "desktopcomputer" : "iphone" }
    var width: Int { self == .computer ? 1280 : 390 }
}

struct Move: Identifiable { let id = UUID(); let page: String; let text: String }

@MainActor
final class Store: NSObject, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate {
    @Published var size: Size = .computer { didSet { address = web(size).url?.absoluteString ?? address } }
    @Published var arranging = true { didSet { pushArranging() } }
    @Published var moves: [Size: [Move]] = [.computer: [], .phone: []]
    @Published var picked = ""
    @Published var note = ""
    @Published var address = "https://tenner.stream/"
    @Published var copied = false
    var views: [Size: WKWebView] = [:]

    override init() {
        super.init()
        for s in Size.allCases { views[s] = makeWeb(s) }
    }

    func web(_ s: Size) -> WKWebView { views[s]! }
    var current: WKWebView { web(size) }

    private func makeWeb(_ s: Size) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        let script = Bundle.main.url(forResource: "layout", withExtension: "js").flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
        cfg.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        cfg.userContentController.add(self, name: "tennerLayout")
        let w = WKWebView(frame: NSRect(x: 0, y: 0, width: s.width, height: 800), configuration: cfg)
        w.navigationDelegate = self
        w.allowsBackForwardNavigationGestures = true
        if s == .phone {
            w.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
        }
        w.load(URLRequest(url: URL(string: address)!))
        return w
    }

    // Messages from the drag layer in the page.
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String,
              let s = views.first(where: { $0.value === message.webView })?.key else { return }
        if type == "ready" { pushArranging(to: s); return }
        if type == "state" {
            let list = (body["moves"] as? [[String: Any]] ?? []).map { Move(page: $0["page"] as? String ?? "/", text: $0["text"] as? String ?? "") }
            moves[s] = list
            if s == size { picked = body["picked"] as? String ?? "" }
        }
    }

    func webView(_ w: WKWebView, didFinish navigation: WKNavigation!) {
        if w === current, let u = w.url { address = u.absoluteString }
    }

    private func run(_ js: String, on s: Size? = nil) { web(s ?? size).evaluateJavaScript("window.TennerLayout && TennerLayout.\(js)") }
    private func pushArranging(to s: Size? = nil) {
        for v in s.map({ [$0] }) ?? Size.allCases { run("setArranging(\(arranging))", on: v) }
    }

    func go() {
        var a = address.trimmingCharacters(in: .whitespaces)
        if !a.contains("://") { a = a.hasPrefix("/") ? "https://tenner.stream" + a : "https://" + a }
        guard let u = URL(string: a) else { return }
        for v in views.values { v.load(URLRequest(url: u)) }   // both sizes show the same page
    }
    func undo() { run("undo()") }
    func bigger() { run("bigger()") }
    func smaller() { run("smaller()") }
    func reload() { current.reload() }
    func startAgain() { for s in Size.allCases { run("reset()", on: s) }; note = "" }

    var total: Int { moves.values.reduce(0) { $0 + $1.count } }

    // Everything written out for Claude.
    var forClaude: String {
        var out = "Tenner layout changes (made in Tenner Layout). Please apply these to tenner.stream, only at the sizes listed, following CLAUDE.md.\n"
        for s in Size.allCases {
            let list = moves[s] ?? []
            if list.isEmpty { continue }
            out += "\n\(s.rawValue) (\(s.width)px wide\(s == .phone ? ", iPhone" : "")):\n"
            for (page, group) in Dictionary(grouping: list, by: { $0.page }).sorted(by: { $0.key < $1.key }) {
                out += "Page \(page == "/" ? "/ (home)" : page):\n"
                for (i, m) in group.enumerated() { out += "\(i + 1). \(m.text)\n" }
            }
        }
        let n = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if !n.isEmpty { out += "\nNotes: \(n)\n" }
        return out
    }
    func copy() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(forClaude, forType: .string)
        copied = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.copied = false }
    }
    func save() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "tenner-layout.md"
        if panel.runModal() == .OK, let u = panel.url { try? forClaude.write(to: u, atomically: true, encoding: .utf8) }
    }
}

// Tenner's button: a solid deep navy fill, white icon and words, 9px corners; a dark grey circle when it's only an icon.
struct TennerButton: ButtonStyle {
    var round = false
    func makeBody(configuration: Configuration) -> some View { TennerButtonBody(configuration: configuration, round: round) }
}
private struct TennerButtonBody: View {
    let configuration: ButtonStyle.Configuration
    let round: Bool
    @Environment(\.isEnabled) private var enabled
    var body: some View {
        configuration.label
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(.white)
            .labelStyle(.titleAndIcon)
            .padding(.horizontal, round ? 0 : 12)
            .frame(width: round ? 32 : nil, height: 32)
            .background(round ? Color(red: 0.13, green: 0.13, blue: 0.15).opacity(0.9) : Color(red: 0.043, green: 0.118, blue: 0.235).opacity(0.9),
                        in: RoundedRectangle(cornerRadius: round ? 16 : 9, style: .continuous))
            .opacity(enabled ? (configuration.isPressed ? 0.75 : 1) : 0.4)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.8), value: configuration.isPressed)
            .contentShape(Rectangle())
    }
}

struct WebHost: NSViewRepresentable {
    let web: WKWebView
    func makeNSView(context: Context) -> WKWebView { web }
    func updateNSView(_ v: WKWebView, context: Context) {}
}

struct Frost: ViewModifier {
    func body(content: Content) -> some View {
        content.background(.regularMaterial, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Color.primary.opacity(0.12), lineWidth: 0.5))
    }
}

struct ContentView: View {
    @EnvironmentObject var store: Store

    var body: some View {
        VStack(spacing: 0) {
            bar
            HStack(spacing: 0) {
                canvas
                Divider()
                side.frame(width: 300)
            }
        }
        .frame(minWidth: 1100, minHeight: 720)
    }

    var bar: some View {
        HStack(spacing: 10) {
            Picker("Size", selection: $store.size) {
                ForEach(Size.allCases) { s in Label(s.rawValue, systemImage: s.icon).tag(s) }
            }
            .pickerStyle(.segmented).labelsHidden().frame(width: 220)
            .help("Switch between the computer and phone layouts")

            Button { store.reload() } label: { Label("Reload", systemImage: "arrow.clockwise").labelStyle(.iconOnly) }
                .buttonStyle(TennerButton(round: true)).help("Reload this page")
            TextField("Page address", text: $store.address).textFieldStyle(.plain)
                .padding(.horizontal, 10).frame(height: 32).modifier(Frost())
                .onSubmit { store.go() }

            Toggle(isOn: $store.arranging) { Label("Arrange", systemImage: "hand.draw") }
                .toggleStyle(.switch).help("On: drag things about. Off: use the site normally to open menus and pages.")
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(.bar)
    }

    var canvas: some View {
        ZStack {
            Color(nsColor: .underPageBackgroundColor)
            WebHost(web: store.web(.computer))
                .opacity(store.size == .computer ? 1 : 0).allowsHitTesting(store.size == .computer)
            WebHost(web: store.web(.phone))
                .frame(width: 390)
                .frame(maxHeight: 844)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                .shadow(color: .black.opacity(0.3), radius: 24, y: 10)
                .padding(.vertical, 20)
                .opacity(store.size == .phone ? 1 : 0).allowsHitTesting(store.size == .phone)
        }
    }

    var side: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Selected").font(.headline)
                Text(store.picked.isEmpty ? "Click anything on the page, then drag it to a new place." : store.picked)
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    Button { store.bigger() } label: { Label("Bigger", systemImage: "arrow.up.left.and.arrow.down.right") }
                        .help("Select the box around it (↑)")
                    Button { store.smaller() } label: { Label("Smaller", systemImage: "arrow.down.right.and.arrow.up.left") }
                        .help("Go back to the smaller thing (↓)")
                }
                .buttonStyle(TennerButton()).disabled(store.picked.isEmpty)
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading).modifier(Frost())

            HStack {
                Text("Changes").font(.title3.weight(.semibold))
                Spacer()
                Button { store.undo() } label: { Label("Undo", systemImage: "arrow.uturn.backward").labelStyle(.iconOnly) }
                    .buttonStyle(TennerButton(round: true)).help("Undo the last move on this size (⌘Z)")
                    .disabled((store.moves[store.size] ?? []).isEmpty)
            }

            List {
                ForEach(Size.allCases) { s in
                    let list = store.moves[s] ?? []
                    Section {
                        if list.isEmpty {
                            Text("Nothing moved yet").foregroundStyle(.tertiary)
                        }
                        ForEach(list) { m in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(m.text).font(.callout).fixedSize(horizontal: false, vertical: true)
                                Text(m.page == "/" ? "Home page" : m.page).font(.caption).foregroundStyle(.secondary)
                            }.padding(.vertical, 4)
                        }
                    } header: { Label(s.rawValue, systemImage: s.icon) }
                }
            }
            .listStyle(.inset).scrollContentBackground(.hidden)
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous)).modifier(Frost())

            TextField("Notes for Claude (optional)", text: $store.note, axis: .vertical)
                .lineLimit(2...4).textFieldStyle(.plain).padding(10).modifier(Frost())

            VStack(spacing: 8) {
                Button { store.copy() } label: {
                    Label(store.copied ? "Copied" : "Copy for Claude", systemImage: store.copied ? "checkmark" : "doc.on.doc")
                        .frame(maxWidth: .infinity)
                }
                HStack(spacing: 8) {
                    Button { store.save() } label: { Label("Save as file", systemImage: "square.and.arrow.down").frame(maxWidth: .infinity) }
                    Button { store.startAgain() } label: { Label("Start again", systemImage: "trash").frame(maxWidth: .infinity) }
                }
            }
            .buttonStyle(TennerButton()).disabled(store.total == 0)
        }
        .padding(14)
        .background(.regularMaterial)
    }
}

@main
struct TennerLayoutApp: App {
    @StateObject private var store = Store()
    var body: some Scene {
        WindowGroup("Tenner Layout") {
            ContentView().environmentObject(store)
        }
        .commands {
            CommandGroup(replacing: .undoRedo) {
                Button("Undo move") { store.undo() }.keyboardShortcut("z")
            }
            CommandMenu("Layout") {
                Button("Computer size") { store.size = .computer }.keyboardShortcut("1")
                Button("Phone size") { store.size = .phone }.keyboardShortcut("2")
                Divider()
                Button("Select bigger") { store.bigger() }.keyboardShortcut(.upArrow, modifiers: .command)
                Button("Select smaller") { store.smaller() }.keyboardShortcut(.downArrow, modifiers: .command)
                Divider()
                Button("Copy for Claude") { store.copy() }.keyboardShortcut("c", modifiers: [.command, .shift])
            }
        }
    }
}
