import Foundation
import Observation
import Security
import CommonCrypto

/// Your Tenner account: the same accounts as tenner.stream (worker/src/auth.js), so the Watchlist, progress, services and
/// settings follow you between the app and the website.
///
/// This first version signs in with email and password. The password is stretched on the phone exactly as the website
/// stretches it (PBKDF2-SHA256, 310,000 rounds, salted with the email), so the same password works in both and only the
/// stretched key is ever sent. Passkeys and Google come next: they need the app's Apple Team ID on tenner.stream
/// (apple-app-site-association) and an iOS client ID from Google, set up once.
@MainActor @Observable
final class Account {
    struct User: Codable, Equatable {
        var name: String?
        var picture: String?
        var hue: Double?
        var google: Bool?
        var email: String?
        var share_id: String?
    }
    private struct Session: Decodable { let token: String; let user: User }
    private struct Synced: Decodable { let data: LibraryData }
    private struct OK: Decodable {}

    private(set) var user: User?
    private(set) var syncing = false
    private(set) var lastSynced: Date?
    var signedIn: Bool { user != nil && Keychain.token != nil }

    private let library: Library
    @ObservationIgnored private var pending: Task<Void, Never>?

    init(library: Library) {
        self.library = library
        if let d = UserDefaults.standard.data(forKey: "account.user") { user = try? JSONDecoder().decode(User.self, from: d) }
        library.onChange = { [weak self] in self?.syncSoon() }
    }

    // MARK: signing in and out

    func signIn(email: String, password: String) async throws {
        let e = email.trimmingCharacters(in: .whitespaces)
        let s: Session = try await API.call("POST", "/auth/password/login", body: ["email": e, "key": await Self.key(password, email: e)])
        await begin(s)
    }

    func create(name: String, email: String, password: String) async throws {
        let e = email.trimmingCharacters(in: .whitespaces)
        let s: Session = try await API.call("POST", "/auth/password/signup",
                                            body: ["name": name.trimmingCharacters(in: .whitespaces), "email": e, "key": await Self.key(password, email: e)])
        await begin(s)
    }

    /// Emails a link to set a new password (it opens on the website)
    func forgot(email: String) async throws {
        let _: OK = try await API.call("POST", "/auth/password/forgot", body: ["email": email.trimmingCharacters(in: .whitespaces)])
    }

    func signOut(clearThisDevice: Bool) async {
        if let t = Keychain.token { _ = try? await API.call("POST", "/auth/logout", token: t) as OK }
        forget()
        if clearThisDevice { library.clear() }
    }

    private func begin(_ s: Session) async {
        Keychain.token = s.token
        setUser(s.user)
        await sync()
    }

    private func forget() {
        Keychain.token = nil
        setUser(nil)
    }

    private func setUser(_ u: User?) {
        user = u
        if let u, let d = try? JSONEncoder().encode(u) { UserDefaults.standard.set(d, forKey: "account.user") }
        else { UserDefaults.standard.removeObject(forKey: "account.user") }
    }

    // MARK: keeping devices in step

    /// Send this device's copy; take back the merged one (the website does the same on every change)
    func sync() async {
        guard let t = Keychain.token, !syncing else { return }
        syncing = true
        defer { syncing = false }
        do {
            let out: Synced = try await API.call("PUT", "/me/data", body: ["data": library.data], token: t)
            library.replace(with: out.data)
            lastSynced = Date()
        } catch let f as API.Failure where f.status == 401 {
            forget()   // signed out on another device, or the account was deleted
        } catch {}
    }

    private func syncSoon() {
        guard signedIn else { return }
        pending?.cancel()
        pending = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.2))
            guard !Task.isCancelled else { return }
            await self?.sync()
        }
    }

    // MARK: the password, stretched as the website does it (site/account.js `pwKey`)

    /// 310,000 rounds take a moment, so off the main thread
    nonisolated static func key(_ password: String, email: String) async -> String {
        await Task.detached(priority: .userInitiated) { stretch(password, email: email) }.value
    }

    nonisolated static func stretch(_ password: String, email: String) -> String {
        let pw = Array(password.precomposedStringWithCompatibilityMapping.utf8)   // NFKC, like the website
        let salt = Array("tenner.stream:\(email.trimmingCharacters(in: .whitespaces).lowercased())".utf8)
        var out = [UInt8](repeating: 0, count: 32)
        let status = pw.withUnsafeBufferPointer { p in
            p.withMemoryRebound(to: Int8.self) { pi in
                CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pi.baseAddress, pw.count, salt, salt.count,
                                     CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 310_000, &out, out.count)
            }
        }
        precondition(status == kCCSuccess, "PBKDF2 failed")
        return Data(out).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// The session token lives in the Keychain, never in plain storage
enum Keychain {
    private static let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "stream.tenner.session",
                                              kSecAttrAccount as String: "session"]
    static var token: String? {
        get {
            var q = base; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
            var out: AnyObject?
            guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
            return String(data: d, encoding: .utf8)
        }
        set {
            SecItemDelete(base as CFDictionary)
            guard let newValue else { return }
            var q = base
            q[kSecValueData as String] = Data(newValue.utf8)
            q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            SecItemAdd(q as CFDictionary, nil)
        }
    }
}
