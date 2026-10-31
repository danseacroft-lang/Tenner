import SwiftUI

/// Your Watchlist: kept on the phone, and in your account (so it's the same on tenner.stream) if you sign in
struct WatchlistView: View {
    @Environment(Library.self) private var library
    @Environment(Account.self) private var account
    @State private var selected: Title?

    var body: some View {
        NavigationStack {
            Group {
                if library.watchlist.isEmpty {
                    ContentUnavailableView {
                        Label("Nothing saved yet", systemImage: "bookmark")
                    } description: {
                        Text(account.signedIn ? "Tap Watchlist on any show or film to keep it here."
                             : "Tap Watchlist on any show or film to keep it here. Sign in under Settings to bring over the one on tenner.stream.")
                    }
                } else {
                    List {
                        ForEach(library.watchlist) { s in
                            Button { selected = s.asTitle } label: { TitleRow(title: s.asTitle) }
                                .buttonStyle(.plain)
                                .swipeActions {
                                    Button("Remove", role: .destructive) { withAnimation { library.remove(s.k) } }
                                }
                        }
                    }
                    .listStyle(.plain)
                    .refreshable { await account.sync() }
                }
            }
            .navigationTitle("Watchlist")
            .titleSheet(item: $selected)
            .sensoryFeedback(.impact(weight: .light), trigger: library.watchlist.count)
        }
    }
}
