import Foundation

/// Everything the app fetches. Two places, both the website's own:
///   https://tenner.stream/data/…   the static files GitHub Actions rebuilds every hour (charts, New, Browse)
///   the search/accounts Worker      search, a title's details and where to watch, and accounts
enum API {
    static let site = URL(string: "https://tenner.stream")!
    static let worker = URL(string: "https://tenner-api.danseacroft.workers.dev")!

    static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.urlCache = .shared   // made roomy in TennerApp, so posters and the hourly files stay on the device
        c.requestCachePolicy = .useProtocolCachePolicy
        c.timeoutIntervalForRequest = 20
        // "iPhone" or "iPad" in here is how Your account → Devices names this one
        c.httpAdditionalHeaders = ["User-Agent": "Tenner/\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1") (\(device); iOS)"]
        return URLSession(configuration: c)
    }()

    /// "iPhone" or "iPad" (the hardware name, e.g. iPhone17,1, starts with it; the Simulator says arm64)
    private static var device: String {
        var u = utsname()
        uname(&u)
        let machine = withUnsafeBytes(of: &u.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
        return machine.hasPrefix("iPad") ? "iPad" : "iPhone"
    }

    struct Failure: LocalizedError {
        let status: Int
        let message: String
        var errorDescription: String? { message }
    }

    private static let decoder = JSONDecoder()

    // MARK: the hourly files

    static func trending() async throws -> Trending { try await data("trending.json") }
    static func new() async throws -> NewList { try await data("new.json") }
    static func catalogue() async throws -> Catalogue { try await data("browse.json") }

    private static func data<T: Decodable>(_ file: String) async throws -> T {
        var req = URLRequest(url: site.appending(path: "data/\(file)"))
        req.setValue("application/json", forHTTPHeaderField: "accept")
        let (d, r) = try await session.data(for: req)
        try check(r, d)
        return try decoder.decode(T.self, from: d)
    }

    // MARK: the Worker

    static func search(_ q: String, page: Int = 1) async throws -> SearchPage {
        try await call("GET", "/search", query: ["q": q, "page": String(page)])
    }

    static func details(_ key: String) async throws -> TitleDetails {
        try await call("GET", "/title/\(key)")
    }

    /// One call to the Worker. It only answers Tenner's own sites (CORS), so the app says it's from tenner.stream: a
    /// browser can't fake that header, but the check is there to stop other websites borrowing the service, not apps.
    static func call<T: Decodable>(_ method: String, _ path: String, query: [String: String] = [:], body: Encodable? = nil, token: String? = nil) async throws -> T {
        var u = URLComponents(url: worker.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { u.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        var req = URLRequest(url: u.url!)
        req.httpMethod = method
        req.setValue("https://tenner.stream", forHTTPHeaderField: "origin")
        req.setValue("application/json", forHTTPHeaderField: "accept")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        let (d, r) = try await session.data(for: req)
        try check(r, d)
        return try decoder.decode(T.self, from: d)
    }

    private static func check(_ r: URLResponse, _ d: Data) throws {
        guard let h = r as? HTTPURLResponse else { return }
        guard (200..<300).contains(h.statusCode) else {
            struct Body: Decodable { let error: String? }
            let msg = (try? JSONDecoder().decode(Body.self, from: d))?.error ?? "Something went wrong"
            throw Failure(status: h.statusCode, message: msg)
        }
    }
}
