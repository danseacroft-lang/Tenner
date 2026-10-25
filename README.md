# Tenner

Your top ten, every hour.

The top 10 shows and films right now in the UK on Netflix, Disney+, Prime Video, HBO Max and Paramount+. Clean, Apple-style design with light and dark mode, rebuilt every hour on GitHub Pages.

## How it works

```
GitHub Actions (every hour)
  └─ scripts/fetch-data.mjs
       ├─ TMDB: most popular titles on each service in the UK  → site/data/trending.json
       ├─ TMDB: ~100 shows and films per service, for Browse       → site/data/browse.json
       └─ Watchmode: new releases, at most once a day           → site/data/new.json
  └─ deploys site/ to GitHub Pages
```

Your API keys live only in GitHub Secrets. The browser just reads static JSON, so nothing secret is ever exposed.

## Set it up (about 10 minutes)

1. **Get a TMDB key.** Sign up at themoviedb.org, then Settings → API. Copy the **API Read Access Token** (the long one).
2. **Optional: get a Watchmode key** at api.watchmode.com/requestApiKey (powers the "New this week" page, P200).
3. **Create a GitHub repo** and upload everything in this folder (including the hidden `.github` folder).
4. In the repo go to **Settings → Secrets and variables → Actions → New repository secret**:
   - `TMDB_TOKEN`: your TMDB token
   - `WATCHMODE_API_KEY`: your Watchmode key (optional)
5. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
6. **Actions tab → Update and deploy → Run workflow.** Your site appears at `https://<you>.github.io/<repo>/`.

After that it rebuilds every hour on its own.

## Pages

| Tab | What |
| --- | --- |
| Top 10 (`./`) | Highlights, the neon top 10 row, the ten at a glance, and new this week. Pick Shows or Films, and a service (`#netflix`, `#disney`, `#prime`, `#hbomax`, `#paramount`, `#appletv`; Films also has `#store` for buy or rent) |
| New (`#new`) | Releases from the last and next seven days |
| Browse (`browse.html`) | Search, collections and filters over each service's most popular titles |
| About (`about.html`) | About Tenner and FAQs |
| Privacy & Terms (`legal.html`) | Privacy Policy (with Cookies) and Terms of Service, each in its own scrolling box |
| Contact (`contact.html`) | A compose sheet that opens your email app; the address is set once in `shell.js` (`contact`) |

To add a service, add a line to `SERVICES` at the top of `scripts/fetch-data.mjs`.

## Run locally

```bash
node scripts/fetch-data.mjs --sample          # fake data, no keys needed
TMDB_TOKEN=xxx node scripts/fetch-data.mjs    # real data
npx serve site                                # then open http://localhost:3000
```

## Things to know

- **"Popular" means TMDB popularity**, filtered to what's on each service in the UK. It isn't official viewing figures. For official Top 10s, look at FlixPatrol's paid API later.
- **Provider names change.** If a service shows "No data yet", open `data/providers.json` on your live site to see what matched, and tweak the regex for that service in `SERVICES` at the top of `scripts/fetch-data.mjs`.
- **Watchmode's free plan has a monthly credit limit.** The script calls it at most once a day (about 30 credits a month) by reusing the copy already on your site.
- **GitHub pauses scheduled workflows** in public repos after 60 days with no commits. Push any small change, or re-enable it in the Actions tab, if updates stop.
- **Attribution:** keep the TMDB notice in the footer. TMDB's terms require it.
