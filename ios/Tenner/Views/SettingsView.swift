import SwiftUI

/// Settings, laid out like the iPhone's own: your account at the top, then grouped lists with coloured tiles
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(Library.self) private var library
    @Environment(Account.self) private var account
    @AppStorage("theme") private var theme = Theme.dark.rawValue

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    NavigationLink { AccountView() } label: { accountCard }
                }

                Section {
                    NavigationLink { MyServicesView() } label: {
                        row("My services", "play.tv.fill", .pink, value: library.myServices.isEmpty ? "All" : "\(library.myServices.count)")
                    }
                } footer: {
                    Text("Pick the services you pay for, and search starts with what's on them.")
                }

                Section("Appearance") {
                    Picker(selection: $theme) {
                        ForEach(Theme.allCases) { Text($0.label).tag($0.rawValue) }
                    } label: { row("Theme", "circle.lefthalf.filled", .indigo) }
                    Toggle(isOn: Binding(get: { library.flag("ratings", default: true) }, set: { library.setFlag("ratings", $0) })) {
                        row("Show ratings", "star.fill", .orange)
                    }
                    Toggle(isOn: Binding(get: { library.flag("no18", default: false) }, set: { library.setFlag("no18", $0) })) {
                        row("Leave out 18s in picks", "hand.raised.fill", .red)
                    }
                }

                Section("Tenner") {
                    link("tenner.stream", "globe", .blue, "https://tenner.stream/")
                    link("TV Guide", "tv", .purple, "https://tv.tenner.stream/")
                    link("Contact", "envelope.fill", .green, "https://tenner.stream/contact.html")
                    link("Privacy Policy", "lock.fill", .gray, "https://tenner.stream/legal.html#privacy")
                    link("Terms of Service", "doc.text.fill", .gray, "https://tenner.stream/legal.html#terms")
                }

                Section {
                } footer: {
                    VStack(spacing: 6) {
                        Text("Tenner \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
                        Text("This product uses the TMDB API but is not endorsed or certified by TMDB. Where to watch from JustWatch.")
                    }
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                }
            }
            .navigationTitle("Settings")
        }
    }

    private var accountCard: some View {
        HStack(spacing: 14) {
            Avatar(user: account.user, size: 56)
            VStack(alignment: .leading, spacing: 2) {
                Text(account.user?.name ?? (account.signedIn ? "You" : "Sign in")).font(.title3.weight(.semibold))
                Text(account.signedIn ? "Your account, synced with tenner.stream" : "Keep your Watchlist on every device")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 6)
    }

    private func row(_ title: String, _ icon: String, _ tint: Color, value: String? = nil) -> some View {
        HStack(spacing: 12) {
            SettingsIcon(symbol: icon, tint: tint)
            Text(title)
            if let value { Spacer(); Text(value).foregroundStyle(.secondary) }
        }
    }

    private func link(_ title: String, _ icon: String, _ tint: Color, _ url: String) -> some View {
        Link(destination: URL(string: url)!) {
            HStack {
                row(title, icon, tint)
                Spacer()
                Image(systemName: "arrow.up.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }
        .foregroundStyle(.primary)
    }
}

/// The coloured tile beside a setting, like the iPhone's Settings
struct SettingsIcon: View {
    let symbol: String
    let tint: Color
    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 29, height: 29)
            .background(tint.gradient, in: .rect(cornerRadius: 7, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// Your picture, or your initial on your colour (the same colour as on the website)
struct Avatar: View {
    let user: Account.User?
    var size: CGFloat = 40
    var body: some View {
        Group {
            if let p = user?.picture, let u = URL(string: p) {
                AsyncImage(url: u) { $0.resizable().scaledToFill() } placeholder: { Color.secondary.opacity(0.2) }
            } else {
                ZStack {
                    Color(hue: (user?.hue ?? 210) / 360, saturation: 0.72, brightness: 0.85).opacity(user == nil ? 0.25 : 1)
                    if let n = user?.name?.trimmingCharacters(in: .whitespaces).first {
                        Text(String(n).uppercased()).font(.system(size: size * 0.45, weight: .semibold, design: .rounded)).foregroundStyle(.white)
                    } else {
                        Image(systemName: "person.fill").font(.system(size: size * 0.45)).foregroundStyle(.white)
                    }
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
        .accessibilityHidden(true)
    }
}

/// My services: a switch for each one. Empty means all of them.
struct MyServicesView: View {
    @Environment(AppModel.self) private var model
    @Environment(Library.self) private var library

    var body: some View {
        Form {
            Section {
                ForEach(model.services.filter(\.isSubscription)) { s in
                    Toggle(s.label, isOn: Binding(
                        get: { library.myServices.contains(s.key) },
                        set: { on in
                            var l = library.myServices.filter { $0 != s.key }
                            if on { l.append(s.key) }
                            library.setServices(l)
                        }))
                }
            } footer: {
                Text("Leave them all off to see every service.")
            }
        }
        .navigationTitle("My services")
        .navigationBarTitleDisplayMode(.inline)
    }
}
