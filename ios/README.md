# Tenner for iPhone and iPad

The native app: SwiftUI, iOS 18 and later. Built with Xcode 26 its tab bar, sidebar, sheets and toolbars are
Liquid Glass with no extra code, and on iOS 18 they fall back to the system's own look.

## Open and run it (on a Mac)

1. Install Xcode 26 from the Mac App Store.
2. Open `ios/Tenner.xcodeproj`.
3. Select the **Tenner** target → **Signing & Capabilities** → choose your Team (your Apple ID works for running on
   your own iPhone; the App Store needs the Apple Developer Program).
4. Pick an iPhone simulator (or your iPhone, plugged in) and press ⌘R.

Every Swift file under `ios/Tenner/` is in the project automatically (Xcode's synchronised folder), so new files need
no project edits.

## What's in it

| Tab | What | Data |
| --- | --- | --- |
| Top 10 | The UK's chart or one service's, shows or films, with the No. 1's artwork full width, movement since yesterday, and the Tonight picker | `tenner.stream/data/trending.json` |
| New | What's arrived and what's coming, a day at a time | `data/new.json` |
| Watchlist | Saved titles, swipe to remove | on the phone, and the account |
| Settings | Your account, My services, theme (dark by default), ratings, links | |
| Search | Every show and film; before you type, what's popular on your services | the Worker's `/search`, `data/browse.json` |

Tapping any title opens its sheet: artwork, facts, Watchlist, trailer, Share (the same `/t/<key>/` link the website
shares) and where to watch it in the UK, from the Worker's `/title/<key>`. Each service opens in its own app where
Tenner knows the title's page there (the same rules as `site/links.js`; keep `Core/Links.swift` in step).

## How it shares the backend

Nothing new runs on the server. The app reads the same hourly files and calls the same Worker as the website:

- **Charts, New, Browse**: the static files GitHub Actions rebuilds every hour.
- **Search and title details**: `tenner-api` (the Worker). It only answers Tenner's own sites, so the app sends
  `Origin: https://tenner.stream`.
- **Accounts**: the same accounts. Email and password sign-in stretches the password on the phone exactly as the website
  does (PBKDF2-SHA256, 310,000 rounds, salted with the email), so one password works in both. The session token lives in
  the Keychain. The Watchlist, progress, My services and settings sync through `PUT /me/data` in the website's own
  shape, so the account merges the phone with your other devices item by item.

## Still to do

- **Passkeys and Sign in with Google.** Passkeys need the Apple Team ID in `site/.well-known/apple-app-site-association`
  (`webcredentials`) and the Associated Domains capability; Google needs an iOS OAuth client ID. Both are one-off setup.
- **Watchlist alerts as real notifications** (APNs), alongside the website's web push.
- Browse's collections and filters, Cast & Crew, Discover's swipe deck, where you're up to in a show.
- Universal links, so `tenner.stream/?t=<key>` opens the app.
- A home-screen widget for the No. 1 tonight.
