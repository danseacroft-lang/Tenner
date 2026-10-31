import Foundation

// The shapes of the files tenner.stream already publishes (site/data/*.json, rebuilt hourly) and of the search
// service's answers (worker/src/index.js). The app reads exactly what the website reads, so nothing new is needed on
// the server for the charts, New, Browse or a title's details.

/// A value that's a number in some files and a string in others (TMDB ids, a chart's movement, links' ids).
struct Flex: Codable, Hashable, Sendable {
    let string: String
    init(_ s: String) { string = s }
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let i = try? c.decode(Int.self) { string = String(i) }
        else if let d = try? c.decode(Double.self) { string = String(d) }
        else { string = try c.decode(String.self) }
    }
    func encode(to encoder: Encoder) throws { var c = encoder.singleValueContainer(); try c.encode(string) }
    var int: Int? { Int(string) }
}

/// Any JSON, kept as it came (the web app's settings travel through the account untouched).
enum JSONValue: Codable, Hashable, Sendable {
    case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): if n == n.rounded(), abs(n) < 1e15 { try c.encode(Int64(n)) } else { try c.encode(n) }
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
    var bool: Bool? { if case .bool(let b) = self { return b }; return nil }
}

func imageURL(_ s: String?) -> URL? {
    guard let s, !s.isEmpty else { return nil }
    return URL(string: s)
}

// MARK: - The one shape every screen shows: a show or a film

/// What a row, a poster or the title sheet needs. Every source (charts, Browse, search, New, the Watchlist) becomes one.
struct Title: Identifiable, Hashable, Sendable {
    /// Tenner's key: "m" or "t" and the TMDB id (m550 is Fight Club). Nil for a title TMDB doesn't know.
    var key: String?
    var type: String   // "movie" or "tv"
    var title: String
    var year: String?
    var overview: String?
    var rating: Double?
    var poster: URL?
    var backdrop: URL?
    var id: String { key ?? "\(type):\(title)" }
    var isFilm: Bool { type == "movie" }
    var kindLabel: String { isFilm ? "Film" : "Series" }
    /// "Series · 2024 · ★ 8.1"
    var subtitle: String { [kindLabel, year, rating.map { String(format: "★ %.1f", $0) }].compactMap { $0 }.joined(separator: " · ") }
    var shareURL: URL? { key.flatMap { URL(string: "https://tenner.stream/t/\($0)/") } }
}

// MARK: - data/trending.json: the charts

struct Trending: Decodable {
    let generatedAt: String?
    let services: [Service]
    let overall: Lists?
}

struct Lists: Decodable {
    let tv: [ChartItem]
    let movie: [ChartItem]
}

struct Service: Decodable, Identifiable {
    let key: String
    let label: String
    let logo: String?
    let store: Bool?
    let shop: Bool?
    let tv: [ChartItem]
    let movie: [ChartItem]
    var id: String { key }
    /// A subscription service (not "Buy or rent" or a shop like Sky Store)
    var isSubscription: Bool { store != true && shop != true }
}

struct ChartItem: Decodable, Hashable {
    let rawID: Flex
    let type: String
    let title: String
    let year: Int?
    let overview: String?
    let rating: Double?
    let poster: String?
    let backdrop: String?
    /// Places moved since yesterday: a number (up is positive) or "new"
    let mv: Flex?
    let on: [String]?
    enum CodingKeys: String, CodingKey { case rawID = "id", type, title, year, overview, rating, poster, backdrop, mv, on }

    var asTitle: Title {
        Title(key: rawID.int.map { (type == "movie" ? "m" : "t") + String($0) }, type: type, title: title,
              year: year.map(String.init), overview: overview, rating: rating, poster: imageURL(poster), backdrop: imageURL(backdrop))
    }
}

// MARK: - data/browse.json: every service's most popular titles (Browse, and the Tonight picker)

struct Catalogue: Decodable {
    let img: String?
    let genres: [String: String]?
    let items: [CatItem]
}

struct CatItem: Decodable, Hashable {
    let i: Int
    let t: String
    let n: String
    let d: String?
    let r: Double?
    let v: Double?
    let p: Double?
    let img: String?
    let g: [Int]?
    let s: [String]?

    var key: String { (t == "movie" ? "m" : "t") + String(i) }
    func asTitle(imgBase: String?) -> Title {
        let poster: URL? = {
            guard let img, !img.isEmpty else { return nil }
            return img.hasPrefix("/") ? URL(string: (imgBase ?? "https://image.tmdb.org/t/p/w342") + img) : URL(string: img)
        }()
        return Title(key: key, type: t, title: n, year: d.map { String($0.prefix(4)) }, overview: nil, rating: r, poster: poster, backdrop: nil)
    }
}

// MARK: - data/new.json: new this week

struct NewList: Decodable {
    let items: [NewItem]
}

struct NewItem: Decodable, Hashable, Identifiable {
    let title: String
    let type: String
    let season: Int?
    let date: String
    let service: String
    let original: Bool?
    let poster: String?
    let url: String?
    var id: String { "\(service):\(title):\(season ?? 0):\(date)" }
}

// MARK: - the search service: GET /search?q= and GET /title/m123

struct SearchPage: Decodable {
    let img: String?
    let page: Int
    let pages: Int
    let results: [SearchHit]
}

struct SearchHit: Decodable, Hashable {
    let k: String
    let type: String
    let title: String
    let year: String?
    let rating: Double?
    let poster: String?
    let backdrop: String?
    let overview: String?
    func asTitle(img: String?) -> Title {
        Title(key: k, type: type, title: title, year: year, overview: overview, rating: rating,
              poster: poster.flatMap { URL(string: (img ?? "https://image.tmdb.org/t/p/w342") + $0) },
              backdrop: backdrop.flatMap { URL(string: "https://image.tmdb.org/t/p/w780" + $0) })
    }
}

/// One title's details and where to watch it in the UK (the same shape as data/titles.json, for one title).
struct TitleDetails: Decodable {
    let logo: String?
    let providers: [String: [String]]
    let items: [String: TitleExtra]
    let info: TitleInfo?

    struct TitleInfo: Decodable {
        let k: String
        let type: String
        let title: String
        let year: String?
        let rating: Double?
        let overview: String?
        let poster: String?
        let backdrop: String?
    }

    var extra: TitleExtra? { info.flatMap { items[$0.k] } ?? items.values.first }

    /// Where to watch, grouped the way the website's sheet groups them
    func offers(for title: String) -> [OfferGroup] {
        guard let x = extra else { return [] }
        let make: ([Int]?) -> [Provider] = { ids in
            var seen = Set<String>()
            return (ids ?? []).compactMap { (id: Int) -> Provider? in
                guard let p = providers[String(id)], let raw = p.first else { return nil }
                let name = Links.brand(raw)
                guard seen.insert(name).inserted else { return nil }   // plans and channels fold into one service
                let icon = p.count > 1 && !p[1].isEmpty ? URL(string: (self.logo ?? "https://image.tmdb.org/t/p/w92") + p[1]) : nil
                return Provider(name: name, logo: icon, link: Links.link(raw: raw, title: title, ids: x.ln ?? [:]))
            }
        }
        let all = [OfferGroup(group: "Stream", providers: make(x.f)), OfferGroup(group: "Free", providers: make(x.fr)),
                   OfferGroup(group: "Rent", providers: make(x.re)), OfferGroup(group: "Buy", providers: make(x.bu))]
        return all.filter { !$0.providers.isEmpty }
    }
}

struct TitleExtra: Decodable {
    let rt: Int?          // runtime, minutes
    let se: Int?          // seasons
    let c: String?        // UK certificate
    let g: [String]?      // genres
    let tl: String?       // tagline
    let f: [Int]?         // stream (flat rate)
    let fr: [Int]?        // free, or free with ads
    let re: [Int]?        // rent
    let bu: [Int]?        // buy
    let tr: String?       // YouTube trailer
    let sz: [Int]?        // episodes in each season
    let nx: [Flex]?       // next episode: [date, season, episode]
    let en: Int?          // 1 when the show has ended
    let ln: [String: Flex]?   // the title's own id on each service (Wikidata)
}

struct OfferGroup: Identifiable {
    let group: String
    let providers: [Provider]
    var id: String { group }
}

struct Provider: Hashable, Identifiable {
    let name: String
    let logo: URL?
    let link: URL?
    var id: String { name }
}
