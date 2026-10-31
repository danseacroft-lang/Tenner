import Foundation

/// Where each service's Watch button goes. A port of site/links.js, so the app and the website send people to the same
/// places: the title itself where Wikidata knows its id on that service (these open the service's app), else the
/// service's own search with the title filled in, else its home page. Keep the two in step.
enum Links {
    private static let names: [String: String] = [
        "Disney Plus": "Disney+", "Amazon Prime Video": "Prime Video", "Amazon Prime Video Free": "Prime Video", "Paramount Plus": "Paramount+",
        "Apple TV Plus": "Apple TV", "Apple TV+": "Apple TV", "Channel 4 Plus": "Channel 4", "Apple TV Store": "Apple TV",
        "Amazon Video": "Prime Video Store", "Now TV": "NOW", "Now TV Cinema": "NOW", "NOW TV Cinema": "NOW", "Netflix Kids": "Netflix",
    ]

    /// One name per service: TMDB lists plans and channels separately ("Netflix Standard with Ads", "Paramount+ Amazon Channel")
    static func brand(_ raw: String) -> String {
        var b = raw
        b = b.replacingOccurrences(of: #"\s+(Standard|Basic|Premium)?\s*with Ads$"#, with: "", options: [.regularExpression, .caseInsensitive])
        b = b.replacingOccurrences(of: #"\s+(Amazon|Apple TV|Roku Premium)\s+Channel$"#, with: "", options: [.regularExpression, .caseInsensitive])
        b = b.replacingOccurrences(of: #"\s+(Premium|Kids|Basic|Standard|Essential)$"#, with: "", options: [.regularExpression, .caseInsensitive])
        if b == "Paramount+" { b = "Paramount Plus" }
        b = b.trimmingCharacters(in: .whitespaces)
        return names[b] ?? b
    }

    private static func q(_ t: String) -> String { t.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&+=?#"))) ?? t }

    private static func direct(_ b: String, _ l: [String: Flex]) -> String? {
        func id(_ k: String) -> String? { l[k]?.string }
        switch b {
        case "Netflix": return id("nf").map { "https://www.netflix.com/title/\($0)" }
        case "Disney+": return id("dp").map { "https://www.disneyplus.com/\($0)" }
        case "Prime Video", "Prime Video Store": return id("pv").map { "https://www.primevideo.com/detail/\($0)" }
        case "HBO Max": return id("hb").map { "https://play.hbomax.com/\($0)" }
        case "Apple TV", "Apple TV+": return id("ap").map { "https://tv.apple.com/gb/\($0)" }
        default: return nil
        }
    }

    private static func search(_ b: String, _ t: String) -> String? {
        let apple = "https://tv.apple.com/gb/search?term=\(q(t))", amazon = "https://www.amazon.co.uk/s?k=\(q(t))&i=instant-video"
        let youtube = "https://www.youtube.com/results?search_query=\(q(t))"
        switch b {
        case "Apple TV", "Apple TV+": return apple
        case "Prime Video", "Prime Video Store", "Amazon MX Player": return amazon
        case "Google Play Movies": return "https://play.google.com/store/search?q=\(q(t))&c=movies"
        case "YouTube", "YouTube Free": return youtube
        case "Netflix": return "https://www.netflix.com/search?q=\(q(t))"
        case "Sky Store": return "https://www.skystore.com/search?q=\(q(t))"
        case "NOW": return "https://www.nowtv.com/watch/search?q=\(q(t))"
        case "Rakuten TV": return "https://www.rakuten.tv/uk/search?q=\(q(t))"
        case "BBC iPlayer": return "https://www.bbc.co.uk/iplayer/search?q=\(q(t))"
        case "ITVX": return "https://www.itv.com/watch/search?q=\(q(t))"
        case "5": return "https://www.channel5.com/search?q=\(q(t))"
        case "UKTV Play": return "https://u.co.uk/search?q=\(q(t))"
        case "STV Player": return "https://player.stv.tv/search?q=\(q(t))"
        case "Paramount+": return "https://www.paramountplus.com/gb/search/?q=\(q(t))"
        case "HBO Max": return "https://play.hbomax.com/search?q=\(q(t))"
        case "MUBI": return "https://mubi.com/en/gb/search/films?query=\(q(t))"
        case "Tubi TV": return "https://tubitv.com/search/\(q(t))"
        case "Crunchyroll": return "https://www.crunchyroll.com/search?q=\(q(t))"
        case "BFI Player": return "https://player.bfi.org.uk/search?q=\(q(t))"
        case "Plex": return "https://watch.plex.tv/search?q=\(q(t))"
        case "Hayu": return "https://www.hayu.com/search?q=\(q(t))"
        default: return nil
        }
    }

    private static let home: [String: String] = [
        "Disney+": "https://www.disneyplus.com/", "Channel 4": "https://www.channel4.com/", "Sky Go": "https://www.sky.com/watch/sky-go",
        "Curzon Home Cinema": "https://www.curzon.com/home-cinema/", "Discovery+": "https://www.discoveryplus.com/gb", "Pluto TV": "https://pluto.tv/",
        "Shudder": "https://www.shudder.com/",
    ]

    static func link(raw: String, title: String, ids: [String: Flex]) -> URL? {
        let b = brand(raw)
        let channel: String? = raw.range(of: "amazon channel$", options: [.regularExpression, .caseInsensitive]) != nil
            ? "https://www.amazon.co.uk/s?k=\(q(title))&i=instant-video"
            : raw.range(of: "apple tv channel$", options: [.regularExpression, .caseInsensitive]) != nil ? "https://tv.apple.com/gb/search?term=\(q(title))" : nil
        let s = direct(b, ids) ?? channel ?? search(b, title) ?? home[b]
        return s.flatMap(URL.init(string:))
    }
}
