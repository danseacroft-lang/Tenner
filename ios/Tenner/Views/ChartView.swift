import SwiftUI

/// The Top 10: the UK's chart, or one service's, for shows or films. The No. 1's artwork runs full width at the top and
/// fades into the page; then the Tonight picker; then the ten (two columns on iPad, one on iPhone).
struct ChartView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("chart.kind") private var kind = "tv"
    @AppStorage("chart.service") private var service = "all"
    @State private var selected: Title?
    @State private var tonight = false
    @Environment(\.horizontalSizeClass) private var size

    private var items: [ChartItem] {
        guard let t = model.trending else { return [] }
        let lists: Lists? = service == "all" ? t.overall : t.services.first { $0.key == service }.map { Lists(tv: $0.tv, movie: $0.movie) }
        return Array((kind == "movie" ? lists?.movie : lists?.tv)?.prefix(10) ?? [])
    }

    private var place: String { service == "all" ? "the UK" : model.label(for: service) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if model.trending == nil {
                        if model.failed { unavailable } else { LoadingRows(count: 8).padding(.top, 120) }
                    } else {
                        hero
                        services.padding(.top, -24)
                        if service != "store" { tonightCard.padding(.horizontal).padding(.top, 20) }
                        Text(kind == "movie" ? "Top 10 films in \(place)" : "Top 10 shows in \(place)")
                            .font(.title2.bold())
                            .padding(.horizontal).padding(.top, 28).padding(.bottom, 4)
                        if items.isEmpty {
                            Text(kind == "movie" ? "No films in this chart right now." : "No shows in this chart right now. Try Films.")
                                .foregroundStyle(.secondary).padding(.horizontal).padding(.top, 8)
                        } else {
                            list
                        }
                    }
                }
                .padding(.bottom, 24)
            }
            .ignoresSafeArea(edges: .top)
            .refreshable { await model.load() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Picker("Shows or films", selection: $kind) {
                        Text("Shows").tag("tv")
                        Text("Films").tag("movie")
                    }
                    .pickerStyle(.menu)
                }
            }
            .titleSheet(item: $selected)
            .sheet(isPresented: $tonight) { TonightView().presentationDragIndicator(.visible) }
        }
    }

    // MARK: the No. 1, big, melting into the page

    @ViewBuilder private var hero: some View {
        if let top = items.first?.asTitle {
            Button { selected = top } label: {
                ZStack(alignment: .bottomLeading) {
                    FadedArt(url: top.backdrop ?? top.poster, height: size == .regular ? 460 : 380)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("No. 1 in \(place)").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                        Text(top.title).font(.system(size: 34, weight: .bold)).lineLimit(2).multilineTextAlignment(.leading)
                        if let o = top.overview, !o.isEmpty { Text(o).font(.subheadline).foregroundStyle(.secondary).lineLimit(2) }
                    }
                    .padding(.horizontal).padding(.bottom, 40)
                }
            }
            .buttonStyle(.plain)
            .accessibilityHint("Shows where to watch it")
        } else {
            Color.clear.frame(height: 120)
        }
    }

    // MARK: the services: the UK, then each one

    private var services: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("all", "UK")
                ForEach(model.services) { s in chip(s.key, s.label) }
            }
            .padding(.horizontal)
        }
        .scrollClipDisabled()
    }

    private func chip(_ key: String, _ label: String) -> some View {
        let on = service == key
        return Button { withAnimation(.snappy) { service = key } } label: {
            Text(label)
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 14).frame(minHeight: 36)
                .background(on ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(Material.thinMaterial), in: .capsule)
                .foregroundStyle(on ? Color.white : Color.primary)
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: on)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: "What should I watch tonight?"

    private var tonightCard: some View {
        HStack(spacing: 14) {
            Image(systemName: "popcorn.fill")
                .font(.title2).foregroundStyle(.white)
                .frame(width: 52, height: 52)
                .background(LinearGradient(colors: [Color(red: 1, green: 0.42, blue: 0.42), Color(red: 1, green: 0.216, blue: 0.373)],
                                           startPoint: .topLeading, endPoint: .bottomTrailing), in: .rect(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text("What should I watch tonight?").font(.headline)
                Text("Three quick taps and Tenner picks.").font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Button("Choose") { tonight = true }
                .buttonStyle(.bordered).buttonBorderShape(.capsule)
        }
        .padding(14)
        .background(.thinMaterial, in: .rect(cornerRadius: 22, style: .continuous))
    }

    // MARK: the ten

    private var list: some View {
        let cols = size == .regular ? [GridItem(.flexible(), spacing: 28), GridItem(.flexible(), spacing: 28)] : [GridItem(.flexible())]
        return LazyVGrid(columns: cols, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { i, it in
                let t = it.asTitle
                Button { selected = t } label: {
                    TitleRow(title: t) { Rank(n: i + 1) } trailing: { Movement(mv: it.mv) }
                }
                .buttonStyle(.plain)
                .overlay(alignment: .bottom) { Divider().padding(.leading, 120) }
            }
        }
        .padding(.horizontal)
    }

    private var unavailable: some View {
        ContentUnavailableView {
            Label("Can’t load the charts", systemImage: "wifi.exclamationmark")
        } description: {
            Text("Check your connection, then pull down to try again.")
        } actions: {
            Button("Try again") { Task { await model.load() } }.buttonStyle(.borderedProminent)
        }
        .padding(.top, 140)
    }
}
