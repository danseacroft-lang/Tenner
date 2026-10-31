import SwiftUI

/// The tabs: a floating tab bar on iPhone and a sidebar on iPad, with search on its own (iOS's standard pattern).
/// Built with Xcode 26, the bar and sidebar are Liquid Glass with no extra work.
struct RootView: View {
    enum Page: String, Hashable { case top, new, watchlist, settings, search }
    @SceneStorage("page") private var page: Page = .top

    var body: some View {
        TabView(selection: $page) {
            Tab("Top 10", systemImage: "chart.bar.fill", value: .top) { ChartView() }
            Tab("New", systemImage: "sparkles", value: .new) { NewView() }
            Tab("Watchlist", systemImage: "bookmark.fill", value: .watchlist) { WatchlistView() }
            Tab("Settings", systemImage: "gearshape.fill", value: .settings) { SettingsView() }
            Tab("Search", systemImage: "magnifyingglass", value: .search, role: .search) { SearchView() }
        }
        .tabViewStyle(.sidebarAdaptable)
    }
}
