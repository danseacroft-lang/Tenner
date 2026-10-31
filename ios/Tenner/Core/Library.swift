import Foundation
import Observation

/// One title on your Watchlist, exactly as the website keeps it: { k, type, title, year, poster, at }
struct Saved: Codable, Hashable, Identifiable {
    var k: String
    var type: String
    var title: String
    var year: String?
    var poster: String?
    var at: Double   // when it was added (ms since 1970, like the website)
    var id: String { k }

    init(k: String, type: String, title: String, year: String?, poster: String?, at: Double) {
        self.k = k; self.type = type; self.title = title; self.year = year; self.poster = poster; self.at = at
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        k = try c.decode(String.self, forKey: .k)
        type = (try? c.decode(String.self, forKey: .type)) ?? (k.hasPrefix("m") ? "movie" : "tv")
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        year = (try? c.decodeIfPresent(Flex.self, forKey: .year))?.string   // a number on the website, a string from the account
        poster = try? c.decodeIfPresent(String.self, forKey: .poster)
        at = (try? c.decode(Double.self, forKey: .at)) ?? 0
    }

    var asTitle: Title { Title(key: k, type: type, title: title, year: year, overview: nil, rating: nil, poster: imageURL(poster), backdrop: nil) }
}

/// Everything you keep, in the same shape as the website's account data (worker/src/auth.js `merge`), so the account
/// merges your phone with your other devices item by item, newest change wins.
struct LibraryData: Codable {
    var watchlist: [Saved] = []
    var removed: [String: Double] = [:]      // titles taken off the Watchlist, and when (so other devices take them off too)
    var progress: [String: [Int]] = [:]      // where you're up to in a show: [season, episode]
    var pat: [String: Double] = [:]          // when each progress changed
    var stars: [String: [Double]] = [:]      // [1 or 0, when]
    var services: [String] = []              // My services; empty means all of them
    var sat: Double = 0
    var settings: [String: JSONValue] = [:]  // the website's settings, kept as they are
    var pfat: Double = 0

    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        watchlist = (try? c.decodeIfPresent([Saved].self, forKey: .watchlist)) ?? []
        removed = (try? c.decodeIfPresent([String: Double].self, forKey: .removed)) ?? [:]
        progress = ((try? c.decodeIfPresent([String: [Int]?].self, forKey: .progress)) ?? [:]).compactMapValues { $0 }
        pat = (try? c.decodeIfPresent([String: Double].self, forKey: .pat)) ?? [:]
        stars = (try? c.decodeIfPresent([String: [Double]].self, forKey: .stars)) ?? [:]
        services = (try? c.decodeIfPresent([String].self, forKey: .services)) ?? []
        sat = (try? c.decodeIfPresent(Double.self, forKey: .sat)) ?? 0
        settings = (try? c.decodeIfPresent([String: JSONValue].self, forKey: .settings)) ?? [:]
        pfat = (try? c.decodeIfPresent(Double.self, forKey: .pfat)) ?? 0
    }
}

private func nowMS() -> Double { (Date().timeIntervalSince1970 * 1000).rounded() }

@MainActor @Observable
final class Library {
    private(set) var data = LibraryData()
    /// Called after every change you make, so the account can sync (set by Account)
    @ObservationIgnored var onChange: (@MainActor () -> Void)?

    private let file: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appending(path: "library.json")
    }()

    init() {
        if let d = try? Data(contentsOf: file), let l = try? JSONDecoder().decode(LibraryData.self, from: d) { data = l }
    }

    private func save(changed: Bool = true) {
        if let d = try? JSONEncoder().encode(data) { try? d.write(to: file, options: .atomic) }
        if changed { onChange?() }
    }

    /// The account's merged copy replaces this device's (it already includes everything this device sent)
    func replace(with merged: LibraryData) { data = merged; save(changed: false) }
    func clear() { data = LibraryData(); save(changed: false) }

    // MARK: Watchlist

    var watchlist: [Saved] { data.watchlist }
    func has(_ key: String?) -> Bool { key.map { k in data.watchlist.contains { $0.k == k } } ?? false }

    @discardableResult
    func toggle(_ t: Title) -> Bool {
        guard let k = t.key else { return false }
        if has(k) { remove(k); return false }
        let poster = t.poster?.absoluteString.replacingOccurrences(of: #"/t/p/w\d+/"#, with: "/t/p/w342/", options: .regularExpression)
        data.watchlist.insert(Saved(k: k, type: t.type, title: t.title, year: t.year, poster: poster, at: nowMS()), at: 0)
        if data.watchlist.count > 500 { data.watchlist.removeLast(data.watchlist.count - 500) }
        save()
        return true
    }

    func remove(_ k: String) {
        data.watchlist.removeAll { $0.k == k }
        data.removed[k] = nowMS()
        save()
    }

    // MARK: Where you're up to in a show

    func progress(_ k: String) -> (season: Int, episode: Int)? {
        guard let p = data.progress[k], p.count == 2 else { return nil }
        return (p[0], p[1])
    }
    func setProgress(_ k: String, _ p: (season: Int, episode: Int)?) {
        if let p { data.progress[k] = [p.season, p.episode] } else { data.progress.removeValue(forKey: k) }
        data.pat[k] = nowMS()
        save()
    }

    // MARK: My services

    var myServices: [String] { data.services }
    func setServices(_ s: [String]) { data.services = s; data.sat = nowMS(); save() }

    // MARK: Settings shared with the website (Settings → on every device)

    func flag(_ key: String, default def: Bool) -> Bool { data.settings[key]?.bool ?? def }
    func setFlag(_ key: String, _ on: Bool) { data.settings[key] = .bool(on); data.pfat = nowMS(); save() }
}
