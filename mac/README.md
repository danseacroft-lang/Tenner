# Tenner Layout (Mac app)

A small Mac app for trying out new layouts of tenner.stream by dragging things about, at computer and phone sizes.
It never changes the site or its code: moves happen only inside the app's window, and it writes them down as plain
instructions you paste to Claude, who makes the real change.

## Get it running

**Build it yourself (recommended, about a minute):**

1. Open Terminal. If you've never built anything on this Mac, run `xcode-select --install` once and click Install.
2. Get the folder: `git clone https://github.com/danseacroft-lang/Tenner.git` (or `git pull` in your existing copy).
3. Run `Tenner/mac/build.sh --install`. Tenner Layout opens and stays in your Applications folder (and Launchpad).

**Or download it ready-made:** on GitHub, Actions → "Tenner Layout (Mac app)" → the latest run → Artifacts →
Tenner-Layout. Unzip it and move it to Applications. The first time, macOS says it can't check the developer: open
System Settings → Privacy & Security and click **Open Anyway** (it's built by GitHub from this folder, not signed by Apple).

Needs macOS 13 Ventura or later.

## Using it

- **Computer / Phone** (top left, or ⌘1 / ⌘2): the site at 1280px wide or as an iPhone (390px). Each size keeps its own moves.
- **Arrange** switch: on, you drag things about; off, the site works normally so you can open menus or go to other pages.
- **Click** anything to select it (blue outline). **Bigger** (↑) selects the box around it, **Smaller** (↓) goes back.
- **Drag** it: a blue line shows where it will land. Let go to drop it. Moved things get a faint green edge.
- **Undo** (⌘Z) puts the last move back. **Start again** clears every move on both sizes.
- Moves are remembered per page while the app is open, so you can visit other pages and come back.
- **Copy for Claude** (⇧⌘C) copies the list, with any notes you add, ready to paste into a Claude chat.
  **Save as file** saves the same text as a `.md` file.

The address bar takes any tenner.stream page (e.g. `/browse.html`) or a local copy (e.g. `http://localhost:8000`).

## What Claude gets

```
Tenner layout changes (made in Tenner Layout). Please apply these to tenner.stream, only at the sizes listed, following CLAUDE.md.

Phone (390px wide, iPhone):
Page / (home):
1. Move the "Most popular" section (`#bxRows > section.bx-sec:nth-child(1)`) to just before the "Top of the charts" section (`#bxHero`).
```

## Files

- `TennerLayout.swift`: the app (window, sizes, changes list, copying).
- `layout.js`: the drag-and-drop layer the app puts over the page.
- `build.sh`, `Info.plist`: how it's put together. `.github/workflows/mac.yml` checks it still builds on every change.
