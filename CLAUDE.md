# Tenner: how we build

Read this before changing anything. Every new page, feature and fix follows it.

## The design rule: Apple's aesthetic, always

Tenner should look and feel like software Apple would ship: calm, premium, fluid and native to Safari, iPhone and
Mac. When in doubt, ask "would this look at home in Apple TV, Apple Music or the App Store?" If not, it isn't done.

### The owner's references (start here)
- https://developer.apple.com/design/human-interface-guidelines
- https://developer.apple.com/design/resources/#macos-apps

**The three principles behind every decision:**
- **Clarity:** legible, precise and easy to understand. Text is readable at every size, icons are unmistakable,
  nothing is decoration for its own sake.
- **Deference:** the interface steps back so the content (the shows and films) is the star. Minimise clutter;
  if a page feels busy, take something away rather than add.
- **Depth:** visual layers and realistic motion show hierarchy (glass above content, sheets above the page,
  things moving the way physical objects would).

**The areas to check a design against:**
- **Navigation:** familiar, standard patterns (sidebar on computers, tab bar / menu on phones); people always know
  where they are and how to get back.
- **User interaction:** comfortable touch targets (44pt minimum), natural gestures (swipe, drag, pull), clear feedback
  for every tap (a press state, a change, a toast), and haptics where the device offers them.
- **System capabilities:** keyboard shortcuts (/ and ⌘K for search, arrow keys), drag and drop where it makes sense,
  the share sheet, Add to Home Screen, works across iPhone, iPad and Mac.
- **Visual design:** layout, colour, typography, iconography and imagery that are beautiful *and* accessible.
- **Modality:** use sheets and popups only to focus on one task, never to interrupt; always easy to dismiss.
- **Loading states:** never a blank or jumpy page; placeholders (skeletons) and gentle transitions while things load.
- **Haptics and feedback:** reinforce actions consistently (a save gets a visible confirmation, a swipe a small buzz).
- **Augmented reality:** not used by Tenner.

### Apple's Human Interface Guidelines (the source)
- Human Interface Guidelines: https://developer.apple.com/design/human-interface-guidelines
- Adopting Liquid Glass: https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass
- Materials (glass, depth, layering): https://developer.apple.com/design/human-interface-guidelines/materials
- Layout: https://developer.apple.com/design/human-interface-guidelines/layout
- Typography: https://developer.apple.com/design/human-interface-guidelines/typography
- Color: https://developer.apple.com/design/human-interface-guidelines/color
- Dark Mode: https://developer.apple.com/design/human-interface-guidelines/dark-mode
- Motion: https://developer.apple.com/design/human-interface-guidelines/motion
- Accessibility: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Writing: https://developer.apple.com/design/human-interface-guidelines/writing
- Buttons: https://developer.apple.com/design/human-interface-guidelines/buttons
- Lists and tables: https://developer.apple.com/design/human-interface-guidelines/lists-and-tables
- Sheets: https://developer.apple.com/design/human-interface-guidelines/sheets
- Tab bars: https://developer.apple.com/design/human-interface-guidelines/tab-bars
- Sidebars: https://developer.apple.com/design/human-interface-guidelines/sidebars
- Search fields: https://developer.apple.com/design/human-interface-guidelines/search-fields
- Apple Design Resources: https://developer.apple.com/design/resources/

### What that means here (Apple's principles, applied to the web)
- **Content first; glass is the controls layer.** Navigation, bars, buttons and pills float above the content in glass.
  Use glass sparingly: only for the important functional elements, never stacked glass on glass.
- **Blend, never cut off.** Artwork and backgrounds melt into the page with soft masks and fades. No straight hard
  edges where an image or panel stops. Hero artwork runs the full width beside the sidebar, and the sidebar picks up
  its colours underneath (Apple's "background extension"). Scroll boxes fade at their edges.
- **Rounded and concentric.** Corners echo their container (a card's corner inside a sheet is a little tighter than the
  sheet's). No square corners on cards, tiles or hovers, and no boxy hover states.
- **Fluid motion.** Spring easing, things that grow and glide rather than snap. Prefer native, off-main-thread motion
  (CSS transitions, View Transitions, scroll-driven animations). Only when Settings → Animations is on, and never when
  the device asks for Reduce Motion. Motion must never pull content away from an edge (e.g. a top image leaving a gap).
- **Generous, legible lists.** Room to breathe, hairline separators, title-style headings.
- **Respect the device's settings:** Dark Mode and light (test both), Reduce Motion, Reduce Transparency
  (`prefers-reduced-transparency`: glass becomes solid), larger text, keyboard and VoiceOver (labels on every icon).
- **Native first.** Use what Safari and iOS provide: `<select>` menus, `<dialog>` for sheets and alerts, the iOS switch
  (`<input type="checkbox" switch>` with a drawn fallback), the share sheet (`navigator.share`), passkeys, web push,
  `position: sticky`, `backdrop-filter`, scroll snap. Don't rebuild what the platform already does well.

### Tenner's house style (learned the hard way: these are rules, not suggestions)
- **One list design everywhere:** the homepage's chart list (`.cl` in styles.css): small poster, title, grey second
  line, hairline separators, frosted hover, two columns on computers, one on phones. New This Week, Watchlist,
  Cast & Crew Top 10 and Browse's list view all use it. Rows of posters use `.nr`.
- **Glass tokens:** `--gl-fill`, `--gl-rim`, `--gl-hover` (defined for light, auto-dark and forced dark).
- **Buttons and pills:** glass, regular weight (500) with font smoothing, never bold.
- **Shows / Films / Both** is a native dropdown (`.dd` with a `<select>`) except where a segmented switch was approved
  (Browse's search bar).
- **The chart numbers never shine:** no rainbow sweep, colour turn (`hue-rotate`) or any other moving effect on the neon
  ranks, on hover or otherwise. It was removed twice because it slowed the site; the glow is drawn once and stays still.
- **Selected states** (e.g. Browse collections) get Tenner's rainbow underline.
- **Popups** look like iOS alerts or sheets: centred glass, blurred backdrop, one clear primary button, tap outside to close.
- **Colour:** premium and restrained. No muddy greens or browns; Apple system colours (blue `#0a84ff`, pink `#ff375f`,
  green `#30d158`, purple `#bf5af2`) and artwork colours, blurred.
- **Type:** one text font everywhere (`--font`: San Francisco on Apple devices, Inter elsewhere), the owner's favourite (the About
  page's lede). The display font (`--font-display`) is only for big headlines, 30px and up. Sentence case for buttons and labels.
- **Nothing off the page:** no element may run past the edge of the screen (check 320, 375, 390, 430, 768, 1100, 1440px).
- **Writing:** plain British English, short and friendly, no jargon.
- **Before shipping anything visual:** screenshot it on phone and computer, light and dark, and look at it critically.

## How we work
- Merge and push without asking. Always `git pull --rebase` first (the site is also edited from another device).
- Bump the version with every update: patch for fixes, minor for features, with sed over `site/*.html site/shell.js site/sw.js`.
- After each update: a quick code check, and remove any code that's no longer used.
- Test what you change (Playwright on phone and computer sizes, both themes); run the worker's auth tests after touching accounts.

## Runs by itself (keep it that way)
- **Hourly** (`update.yml`): charts, Browse, New, cinema and title details rebuilt and deployed; keeps its own schedule alive.
  It also writes a small page per title (`site/t/<key>/`, not in git) whose tags give shared links that title's artwork and
  name; the sheet's Share uses it, and it sends people on to `/?t=<key>`.
- **On every push**: the site (`update.yml`), the search/accounts Worker (`api.yml`) and Tenner TV (`tv.yml`) deploy themselves.
  Tenner TV runs `node tv/test.mjs` first; a failing test stops the deploy, so what's live keeps working.
- **Tenner TV** (`tv/`, tv.tenner.stream): listings from the open Freeview EPG feed, built every 3 hours by
  `scripts/fetch-tv.mjs` into compact day files (only the fields a programme has; Sky pictures as just their id), TVmaze
  only for a day the feed doesn't cover, and the last good copy served if a source is down. Its own logos in `tv/public/logos`
  (sized for where they're shown). A service worker (`tv/public/sw.js`) keeps the page on the device: it opens instantly
  and works offline. Bump its `?v=` with every Tenner TV update (sed over `tv/public/index.html tv/public/sw.js`).
- **Alerts and the Sunday email** (the search/accounts Worker's hourly cron): Watchlist alerts for arrivals each hour; from
  9am UK time a morning pass for new episodes out today, titles leaving within three days, Watchlist titles on Freeview
  later that day and ones that got cheaper to rent or buy (`push.js`); on Sunday mornings
  the opt-in Sunday email through Resend, with a signed unsubscribe link (`digest.js`).
- **On TV this week**: `scripts/fetch-tv.mjs` also writes `onair.json` (title → next showings); tenner.stream's title sheet
  reads it from tenner-tv's workers.dev address at `/api/onair` (the Worker adds the cross-site header; a file in `public/` is served without the Worker running), and the line opens Tenner TV's search with `?q=`.
- **Watchdog** (`watchdog.yml`, every 3 hours): checks the site, the charts' age, the search service and Tenner TV; re-runs
  whatever's behind, re-checks after 7 minutes, and only then fails (GitHub emails the owner). It also checks the Watch live
  links still open. tv.tenner.stream is behind Cloudflare's bot check, so it checks Tenner TV at its workers.dev address.
- Anything new should follow the same pattern: no step that needs a person, a fallback when a source is down, and a check
  in the watchdog.

## Security
- Never post API keys or tokens in chat.
- The owner's personal email address must never appear on the site or in the code.
- Secrets live in GitHub Secrets only: TMDB_TOKEN, WATCHMODE_API_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
  SUPPORT_EMAIL, RESEND_API_KEY. Public IDs (the Google client ID) are fine in code.
- Escape every outside value before it goes into HTML (`esc`). Email links point at https://tenner.stream only.
- Keep third-party GitHub Actions pinned to exact commits.
