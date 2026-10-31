import SwiftUI

/// "What should I watch tonight?": three taps (how long, the mood, who's watching), then three picks from your
/// services. The same questions and the same scoring as the website (site/app.js `tonightPicks`).
struct TonightView: View {
    @Environment(AppModel.self) private var model
    @Environment(Library.self) private var library
    @Environment(\.dismiss) private var dismiss
    @State private var step = 0
    @State private var len = "any"
    @State private var mood = ""
    @State private var who = ""
    @State private var seen = Set<String>()
    @State private var picks: [CatItem] = []
    @State private var selected: Title?

    private struct Option: Identifiable { let id: String; let label: String; let sub: String; let symbol: String; let colours: [Color] }

    private static let lengths = [
        Option(id: "tv", label: "An episode or two", sub: "Shows", symbol: "tv", colours: [.cyan, .blue]),
        Option(id: "movie", label: "A film", sub: "Films", symbol: "film", colours: [.orange, .pink]),
        Option(id: "any", label: "Either", sub: "Surprise me", symbol: "shuffle", colours: [.purple, .indigo]),
    ]
    private static let moods = [
        Option(id: "laugh", label: "A laugh", sub: "Comedy, sitcoms, animation", symbol: "face.smiling", colours: [.yellow, .orange]),
        Option(id: "edge", label: "Edge of my seat", sub: "Thrillers, crime, action", symbol: "bolt.fill", colours: [.orange, .red]),
        Option(id: "feel", label: "Something feel-good", sub: "Family, romance, heart-warming", symbol: "heart.fill", colours: [.pink, .red]),
        Option(id: "mind", label: "Mind-bending", sub: "Sci-fi, fantasy, mystery", symbol: "circle.hexagongrid.fill", colours: [.purple, .indigo]),
        Option(id: "real", label: "Something real", sub: "Documentaries and true stories", symbol: "globe.europe.africa.fill", colours: [.green, .teal]),
        Option(id: "scare", label: "A scare", sub: "Horror", symbol: "moon.stars.fill", colours: [.indigo, Color(red: 0.23, green: 0.18, blue: 0.56)]),
    ]
    private static let whos = [
        Option(id: "me", label: "Just me", sub: "All yours", symbol: "person.fill", colours: [.cyan, .blue]),
        Option(id: "two", label: "Me and someone else", sub: "Something you'll both like", symbol: "person.2.fill", colours: [.pink, .purple]),
        Option(id: "family", label: "The family", sub: "Nothing too scary or grown-up", symbol: "house.fill", colours: [.yellow, .orange]),
    ]
    private static let genres: [String: Set<Int>] = [
        "laugh": [35, 16], "edge": [53, 80, 28, 10759, 9648], "feel": [10751, 10749, 10762, 35],
        "mind": [878, 10765, 14, 9648], "real": [99, 36, 10764], "scare": [27],
    ]
    private static let dark: Set<Int> = [27, 80, 53, 10752]   // left out when the family's watching

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if step < 3 {
                        Text("\(step + 1) of 3").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                        ProgressView(value: Double(step + 1), total: 3).tint(.pink)
                    }
                    switch step {
                    case 0: question("How long have you got?", Self.lengths) { len = $0 }
                    case 1: question("What are you in the mood for?", Self.moods) { mood = $0 }
                    case 2: question("Who's watching?", Self.whos) { who = $0; pick() }
                    default: results
                    }
                }
                .padding()
                .animation(.smooth, value: step)
            }
            .navigationTitle("Tonight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if step > 0 && step < 3 { Button("Back") { step -= 1 } }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .sensoryFeedback(.selection, trigger: step)
            .titleSheet(item: $selected)
        }
    }

    private func question(_ q: String, _ options: [Option], choose: @escaping (String) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(q).font(.largeTitle.bold()).padding(.bottom, 4)
            ForEach(options) { o in
                Button { choose(o.id); step += 1 } label: {
                    HStack(spacing: 14) {
                        Image(systemName: o.symbol).font(.title3).foregroundStyle(.white)
                            .frame(width: 46, height: 46)
                            .background(LinearGradient(colors: o.colours, startPoint: .topLeading, endPoint: .bottomTrailing), in: .rect(cornerRadius: 12, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(o.label).font(.headline)
                            Text(o.sub).font(.subheadline).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                    }
                    .padding(12)
                    .frame(minHeight: 70)
                    .background(.thinMaterial, in: .rect(cornerRadius: 20, style: .continuous))
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
        }
        .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
    }

    @ViewBuilder private var results: some View {
        if picks.isEmpty {
            ContentUnavailableView {
                Label(seen.isEmpty ? "Nothing quite fits" : "That's all for those answers", systemImage: "popcorn")
            } description: {
                Text("Try a different mood\(library.myServices.isEmpty ? "" : ", or add more of your services in Settings").")
            } actions: {
                Button("Start again") { again() }.buttonStyle(.borderedProminent)
            }
        } else {
            Text(forWho).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
            Text("Tonight, try…").font(.largeTitle.bold())
            ForEach(picks, id: \.key) { x in
                let t = x.asTitle(imgBase: model.catalogue?.img)
                Button { selected = t } label: {
                    TitleRow(title: t, detail: "On " + (x.s ?? []).filter { want.contains($0) }.map { model.label(for: $0) }.joined(separator: ", ")) {
                        EmptyView()
                    } trailing: {
                        Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                    }
                    .padding(.horizontal, 12)
                    .background(.thinMaterial, in: .rect(cornerRadius: 20, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            HStack {
                Button("Start again") { again() }.buttonStyle(.bordered)
                Spacer()
                Button("Show me others") { pick() }.buttonStyle(.borderedProminent)
            }
            .buttonBorderShape(.capsule)
            .padding(.top, 8)
        }
    }

    private var forWho: String {
        let w = who == "family" ? "the family" : who == "two" ? "the two of you" : "you"
        let m = Self.moods.first { $0.id == mood }?.label.lowercased() ?? "something good"
        return "For \(w), in the mood for \(m)"
    }

    private var want: Set<String> {
        let mine = library.myServices
        return Set(mine.isEmpty ? model.services.filter(\.isSubscription).map(\.key) : mine)
    }

    private func again() { step = 0; seen = []; picks = [] }

    /// The best-rated, most-watched matches; three from different parts of the best thirty, so the very best usually
    /// shows and the others vary
    private func pick() {
        guard let cat = model.catalogue else { picks = []; return }
        let g = Self.genres[mood] ?? [], w = self.want
        let pool = cat.items.filter { x in
            (len == "any" || x.t == len) && !Set(x.s ?? []).isDisjoint(with: w) && !Set(x.g ?? []).isDisjoint(with: g)
                && (who != "family" || Set(x.g ?? []).isDisjoint(with: Self.dark)) && (x.r ?? 0) >= 6.4 && (x.v ?? 0) >= 40
        }
        .map { x in (x: x, score: (x.r ?? 0) * log10(10 + (x.v ?? 0)) + log10(1 + (x.p ?? 0))) }
        .sorted { $0.score > $1.score }.prefix(30).map { $0.x }.filter { !seen.contains($0.key) }
        var bag = pool, out: [CatItem] = []
        while out.count < 3 && !bag.isEmpty {
            let i = Int(pow(Double.random(in: 0..<1), 1.6) * Double(bag.count))
            out.append(bag.remove(at: min(i, bag.count - 1)))
        }
        out.forEach { seen.insert($0.key) }
        withAnimation(.smooth) { picks = out }
    }
}
