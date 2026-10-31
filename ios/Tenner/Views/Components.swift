import SwiftUI

// The pieces every screen shares, so each exists once (like shell.js on the website).

/// A poster with rounded corners; while it loads (or if there isn't one) a soft colour from the title, never a blank box
struct Poster: View {
    let url: URL?
    let title: String
    var width: CGFloat = 52
    var radius: CGFloat = 8

    var body: some View {
        AsyncImage(url: url, transaction: Transaction(animation: .smooth(duration: 0.25))) { phase in
            switch phase {
            case .success(let img): img.resizable().scaledToFill()
            default: placeholder
            }
        }
        .frame(width: width, height: width * 1.5)
        .clipShape(.rect(cornerRadius: radius, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(.white.opacity(0.08), lineWidth: 0.5) }
        .accessibilityHidden(true)
    }

    private var placeholder: some View {
        LinearGradient(colors: [Color(hue: hue, saturation: 0.45, brightness: 0.42), Color(hue: hue, saturation: 0.5, brightness: 0.26)],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
    }
    /// The same colour the website gives a title without artwork (shell.js `hue`)
    private var hue: Double {
        var h = 0
        for c in title.unicodeScalars { h = (h * 31 + Int(c.value)) % 360 }
        return Double(h) / 360
    }
}

/// The chart's neon number: Tenner's rainbow, glowing, drawn once and still (it never shimmers or turns colour)
struct Rank: View {
    let n: Int
    static let rainbow = LinearGradient(colors: [Color(red: 1, green: 0.216, blue: 0.373), Color(red: 1, green: 0.624, blue: 0.039),
                                                 Color(red: 1, green: 0.839, blue: 0.039), Color(red: 0.188, green: 0.82, blue: 0.345),
                                                 Color(red: 0.039, green: 0.518, blue: 1), Color(red: 0.749, green: 0.353, blue: 0.949)],
                                        startPoint: .topLeading, endPoint: .bottomTrailing)
    var body: some View {
        Text("\(n)")
            .font(.system(size: 30, weight: .heavy, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(Self.rainbow)
            .shadow(color: .pink.opacity(0.35), radius: 6)
            .frame(width: 40)
            .accessibilityLabel("Number \(n)")
    }
}

/// How far a title moved since yesterday: ▲3, ▼1, or New
struct Movement: View {
    let mv: Flex?
    var body: some View {
        if let s = mv?.string {
            if s == "new" {
                Text("New").font(.caption2.weight(.semibold)).foregroundStyle(.blue)
            } else if let n = Int(s), n != 0 {
                Label("\(abs(n))", systemImage: n > 0 ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill")
                    .labelStyle(.titleAndIcon)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(n > 0 ? Color.green : Color.secondary)
                    .accessibilityLabel(n > 0 ? "Up \(n)" : "Down \(-n)")
            }
        }
    }
}

/// One row of Tenner's list (the website's `.cl`): small poster, title, grey second line
struct TitleRow<Leading: View, Trailing: View>: View {
    let title: Title
    var detail: String?
    @ViewBuilder var leading: Leading
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 14) {
            leading
            Poster(url: title.poster, title: title.title)
            VStack(alignment: .leading, spacing: 3) {
                Text(title.title).font(.body.weight(.medium)).lineLimit(2)
                Text(detail ?? title.subtitle).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
            trailing
        }
        .padding(.vertical, 8)
        .contentShape(.rect)
    }
}

extension TitleRow where Leading == EmptyView, Trailing == EmptyView {
    init(title: Title, detail: String? = nil) {
        self.init(title: title, detail: detail, leading: { EmptyView() }, trailing: { EmptyView() })
    }
}

/// Artwork that melts into the page: no hard edge where the picture stops
struct FadedArt: View {
    let url: URL?
    var height: CGFloat = 300

    var body: some View {
        AsyncImage(url: url, transaction: Transaction(animation: .smooth(duration: 0.3))) { phase in
            if case .success(let img) = phase { img.resizable().scaledToFill() } else { Color.clear }
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .clipped()
        .mask(LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black, location: 0.55), .init(color: .clear, location: 1)],
                             startPoint: .top, endPoint: .bottom))
        .accessibilityHidden(true)
    }
}

/// A skeleton while the hourly files load: never a blank page
struct LoadingRows: View {
    var count = 6
    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<count, id: \.self) { _ in
                HStack(spacing: 14) {
                    RoundedRectangle(cornerRadius: 8, style: .continuous).fill(.quaternary).frame(width: 52, height: 78)
                    VStack(alignment: .leading, spacing: 8) {
                        Capsule().fill(.quaternary).frame(width: 160, height: 12)
                        Capsule().fill(.quaternary).frame(width: 100, height: 10)
                    }
                    Spacer()
                }
                .padding(.vertical, 8)
            }
        }
        .padding(.horizontal)
        .accessibilityLabel("Loading")
    }
}

/// Opens a title's sheet from any screen: `.titleSheet(item: $selected)`
extension View {
    func titleSheet(item: Binding<Title?>) -> some View {
        sheet(item: item) { t in
            TitleSheet(title: t)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
    }
}
