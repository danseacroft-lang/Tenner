import SwiftUI

/// Search every show and film (TMDB, through Tenner's search service). Before you type: what's most popular on your
/// services right now, from the Browse catalogue.
struct SearchView: View {
    @Environment(AppModel.self) private var model
    @Environment(Library.self) private var library
    @State private var query = ""
    @State private var results: [Title] = []
    @State private var searching = false
    @State private var selected: Title?

    private var popular: [Title] {
        guard let c = model.catalogue else { return [] }
        let mine = Set(library.myServices)
        return c.items.filter { mine.isEmpty || !Set($0.s ?? []).isDisjoint(with: mine) }
            .sorted { ($0.p ?? 0) > ($1.p ?? 0) }.prefix(30).map { $0.asTitle(imgBase: c.img) }
    }

    var body: some View {
        NavigationStack {
            List {
                if query.trimmingCharacters(in: .whitespaces).count < 2 {
                    Section(library.myServices.isEmpty ? "Popular right now" : "Popular on your services") {
                        ForEach(popular) { t in row(t) }
                    }
                } else if searching && results.isEmpty {
                    LoadingRows(count: 4).listRowInsets(EdgeInsets()).listRowSeparator(.hidden)
                } else if results.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    ForEach(results) { t in row(t) }
                }
            }
            .listStyle(.plain)
            .navigationTitle("Search")
            .searchable(text: $query, prompt: "Shows and films")
            .task(id: query) { await run() }
            .titleSheet(item: $selected)
        }
    }

    private func row(_ t: Title) -> some View {
        Button { selected = t } label: { TitleRow(title: t) }.buttonStyle(.plain)
    }

    /// Waits for a pause in typing, then searches (the service caches searches for a day)
    private func run() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { results = []; return }
        searching = true
        defer { searching = false }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled, let page = try? await API.search(q) else { return }
        guard !Task.isCancelled else { return }
        results = page.results.map { $0.asTitle(img: page.img) }
    }
}
