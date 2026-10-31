import SwiftUI

/// New: what's arrived on the services in the last week and what's coming in the next, a day at a time
struct NewView: View {
    @Environment(AppModel.self) private var model
    @State private var selected: Title?

    private struct Day: Identifiable {
        let day: String
        var items: [NewItem]
        var id: String { day }
    }

    private var days: [Day] {
        let items = (model.new?.items ?? []).sorted { $0.date > $1.date }
        var out: [Day] = []
        for it in items {
            if out.last?.day == it.date { out[out.count - 1].items.append(it) } else { out.append(Day(day: it.date, items: [it])) }
        }
        return out
    }

    var body: some View {
        NavigationStack {
            List {
                if model.new == nil {
                    LoadingRows().listRowInsets(EdgeInsets()).listRowSeparator(.hidden)
                } else if days.isEmpty {
                    ContentUnavailableView("Nothing new yet", systemImage: "sparkles", description: Text("Check back later today."))
                }
                ForEach(days) { d in
                    Section(header(d.day)) {
                        ForEach(d.items) { it in
                            let t = Title(key: nil, type: it.type, title: it.title, year: nil, overview: nil, rating: nil, poster: imageURL(it.poster), backdrop: nil)
                            Button { selected = t } label: { TitleRow(title: t, detail: detail(it)) }
                                .buttonStyle(.plain)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle("New")
            .refreshable { await model.load() }
            .titleSheet(item: $selected)
        }
    }

    private func detail(_ it: NewItem) -> String {
        var bits = [model.label(for: it.service)]
        if let s = it.season, it.type == "tv" { bits.append(s == 1 ? "New series" : "Series \(s)") } else { bits.append(it.type == "movie" ? "Film" : "Series") }
        if it.original == true { bits.append("Original") }
        return bits.joined(separator: " · ")
    }

    /// "Today", "Tomorrow", "Yesterday", "Friday 31 October"
    private func header(_ iso: String) -> String {
        guard let d = ISO8601DateFormatter.day.date(from: iso) else { return iso }
        let cal = Calendar.current
        if cal.isDateInToday(d) { return "Today" }
        if cal.isDateInTomorrow(d) { return "Tomorrow" }
        if cal.isDateInYesterday(d) { return "Yesterday" }
        return d.formatted(.dateTime.weekday(.wide).day().month(.wide))
    }
}
