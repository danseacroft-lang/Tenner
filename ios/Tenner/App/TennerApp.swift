import SwiftUI

@main
struct TennerApp: App {
    @State private var model = AppModel()
    @State private var library: Library
    @State private var account: Account
    @AppStorage("theme") private var theme = Theme.dark.rawValue
    @Environment(\.scenePhase) private var phase

    init() {
        // posters and the hourly files kept on the phone, so the app opens instantly and works on the Tube
        URLCache.shared = URLCache(memoryCapacity: 40 << 20, diskCapacity: 300 << 20)
        let l = Library()
        _library = State(initialValue: l)
        _account = State(initialValue: Account(library: l))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(library)
                .environment(account)
                .preferredColorScheme(Theme(rawValue: theme)?.scheme)
                .task { await model.load() }
                .onChange(of: phase) { _, p in
                    // back to the app: fresh charts if the hour has turned, and this device's changes to the account
                    guard p == .active else { return }
                    Task { await model.refreshIfStale(); await account.sync() }
                }
        }
    }
}

/// Dark by default, like tenner.stream; Settings → Appearance changes it
enum Theme: String, CaseIterable, Identifiable {
    case dark, light, system
    var id: String { rawValue }
    var label: String { switch self { case .dark: "Dark"; case .light: "Light"; case .system: "Automatic" } }
    var scheme: ColorScheme? { switch self { case .dark: .dark; case .light: .light; case .system: nil } }
}

/// The hourly data every screen shares: the charts, New this week, and the Browse catalogue (for search's suggestions
/// and the Tonight picker).
@MainActor @Observable
final class AppModel {
    var trending: Trending?
    var new: NewList?
    var catalogue: Catalogue?
    var failed = false
    private var loadedAt: Date?

    func load() async {
        async let t = try? API.trending()
        async let n = try? API.new()
        async let c = try? API.catalogue()
        let (tr, nw, ca) = await (t, n, c)
        if let tr { trending = tr }
        if let nw { new = nw }
        if let ca { catalogue = ca }
        failed = trending == nil
        loadedAt = Date()
    }

    func refreshIfStale() async {
        guard let at = loadedAt, Date().timeIntervalSince(at) > 30 * 60 else { return }
        await load()
    }

    /// Chart services: the subscriptions first, then Buy or rent and the shops
    var services: [Service] { trending?.services ?? [] }
    func label(for key: String) -> String { services.first { $0.key == key }?.label ?? key.capitalized }
}
