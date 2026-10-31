import SwiftUI

/// A title's sheet: its artwork fading into the sheet, what it is, the Watchlist and Share, and where to watch it in the
/// UK (each service opens straight in its app where Tenner knows the title's page there).
struct TitleSheet: View {
    @State var title: Title
    @Environment(Library.self) private var library
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var details: TitleDetails?
    @State private var loading = true
    @State private var savedTick = 0

    private var extra: TitleExtra? { details?.extra }
    private var showRatings: Bool { library.flag("ratings", default: true) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ZStack(alignment: .bottomLeading) {
                    FadedArt(url: title.backdrop ?? title.poster, height: 280)
                    HStack(alignment: .bottom, spacing: 14) {
                        Poster(url: title.poster, title: title.title, width: 96, radius: 12)
                            .shadow(color: .black.opacity(0.35), radius: 12, y: 6)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(title.title).font(.title2.bold()).lineLimit(3)
                            Text(facts).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.horizontal)
                    .offset(y: 30)
                }
                .padding(.bottom, 30)

                actions.padding(.horizontal)

                if let tl = extra?.tl { Text(tl).font(.headline).padding(.horizontal) }
                if let o = title.overview, !o.isEmpty { Text(o).font(.body).foregroundStyle(.secondary).padding(.horizontal) }
                if let nx = nextEpisode { Label(nx, systemImage: "calendar").font(.subheadline).padding(.horizontal) }

                whereToWatch
            }
            .padding(.bottom, 32)
        }
        .ignoresSafeArea(edges: .top)
        .overlay(alignment: .topTrailing) {
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.body.weight(.semibold)).frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .background(.ultraThinMaterial, in: .circle)
            .padding(16)
            .accessibilityLabel("Close")
        }
        .sensoryFeedback(.success, trigger: savedTick)
        .task { await load() }
    }

    // "Film · 2024 · 15 · 2h 9m · ★ 7.9"
    private var facts: String {
        var bits: [String] = [title.kindLabel]
        if let y = title.year { bits.append(y) }
        if let c = extra?.c { bits.append(c) }
        if let rt = extra?.rt, title.isFilm { bits.append(rt >= 60 ? "\(rt / 60)h \(rt % 60)m" : "\(rt)m") }
        if let se = extra?.se, !title.isFilm { bits.append(se == 1 ? "1 season" : "\(se) seasons") }
        if showRatings, let r = title.rating { bits.append(String(format: "★ %.1f", r)) }
        return bits.joined(separator: " · ")
    }

    private var nextEpisode: String? {
        guard let nx = extra?.nx, nx.count == 3, let d = ISO8601DateFormatter.day.date(from: nx[0].string) else { return nil }
        let when = d.formatted(.dateTime.weekday(.wide).day().month(.wide))
        return "Series \(nx[1].string), episode \(nx[2].string) out \(when)"
    }

    private var actions: some View {
        HStack(spacing: 10) {
            let on = library.has(title.key)
            Button {
                library.toggle(title); savedTick += 1
            } label: {
                Label(on ? "On your Watchlist" : "Watchlist", systemImage: on ? "checkmark" : "plus")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
            .disabled(title.key == nil)

            if let tr = extra?.tr, let u = URL(string: "https://www.youtube.com/watch?v=\(tr)") {
                Button { openURL(u) } label: { Image(systemName: "play.fill").frame(width: 44, height: 44) }
                    .buttonStyle(.bordered).buttonBorderShape(.circle)
                    .accessibilityLabel("Watch the trailer")
            }
            if let u = title.shareURL {
                ShareLink(item: u, subject: Text(title.title)) { Image(systemName: "square.and.arrow.up").frame(width: 44, height: 44) }
                    .buttonStyle(.bordered).buttonBorderShape(.circle)
                    .accessibilityLabel("Share")
            }
        }
    }

    @ViewBuilder private var whereToWatch: some View {
        let groups = details?.offers(for: title.title) ?? []
        VStack(alignment: .leading, spacing: 10) {
            Text("Where to watch").font(.title3.bold())
            if loading && groups.isEmpty {
                ProgressView().frame(maxWidth: .infinity, minHeight: 60)
            } else if groups.isEmpty {
                Text("Not on a UK service right now.").foregroundStyle(.secondary)
            } else {
                ForEach(groups) { g in
                    VStack(alignment: .leading, spacing: 0) {
                        Text(g.group.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.bottom, 4)
                        ForEach(g.providers) { p in
                            Button { if let u = p.link { openURL(u) } } label: {
                                HStack(spacing: 12) {
                                    AsyncImage(url: p.logo) { $0.resizable().scaledToFit() } placeholder: { Color.secondary.opacity(0.2) }
                                        .frame(width: 36, height: 36).clipShape(.rect(cornerRadius: 9, style: .continuous))
                                    Text(p.name).font(.body.weight(.medium))
                                    Spacer()
                                    Image(systemName: "arrow.up.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                                }
                                .frame(minHeight: 48).contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Watch on \(p.name)")
                            if p != g.providers.last { Divider().padding(.leading, 48) }
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(.thinMaterial, in: .rect(cornerRadius: 18, style: .continuous))
                }
            }
            Text("Where-to-watch data from JustWatch, via TMDB.").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(.horizontal)
    }

    private func load() async {
        defer { loading = false }
        // New this week's titles come without a TMDB id: find it by name first
        if title.key == nil, let hit = try? await API.search(title.title).results.first(where: { $0.type == title.type }) {
            let found = hit.asTitle(img: nil)
            title.key = found.key
            if title.poster == nil { title.poster = found.poster }
            title.backdrop = title.backdrop ?? found.backdrop
            title.overview = title.overview ?? found.overview
            title.year = title.year ?? found.year
        }
        guard let k = title.key, let d = try? await API.details(k) else { return }
        details = d
        if let i = d.info {
            if title.overview?.isEmpty ?? true { title.overview = i.overview }
            title.backdrop = title.backdrop ?? imageURL(i.backdrop)
            title.poster = title.poster ?? imageURL(i.poster)
            title.rating = title.rating ?? i.rating
            title.year = title.year ?? i.year
        }
    }
}

extension ISO8601DateFormatter {
    /// "2026-10-31"
    static let day: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withFullDate]
        f.timeZone = TimeZone(identifier: "Europe/London")
        return f
    }()
}
