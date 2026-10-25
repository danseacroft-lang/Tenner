// Where each streaming service's link goes (used by the title sheet). Every address was
// opened in a browser to check it works (October 2026): the title itself where Wikidata knows its ID on that service,
// else the service's own search with the title filled in, else its home page, else the title's TMDB watch page.
(() => {
  // one entry per service: TMDB lists plans and channels separately ("Netflix Standard with Ads", "Paramount+ Amazon
  // Channel", "Paramount Plus Premium"); they're all the same place to watch, so they fold into the service's own name
  const NAMES = { 'Disney Plus': 'Disney+', 'Amazon Prime Video': 'Prime Video', 'Amazon Prime Video Free': 'Prime Video', 'Paramount Plus': 'Paramount+', 'Apple TV Plus': 'Apple TV', 'Apple TV+': 'Apple TV', 'Channel 4 Plus': 'Channel 4',
    'Apple TV Store': 'Apple TV', 'Amazon Video': 'Prime Video Store', 'Now TV': 'NOW', 'Now TV Cinema': 'NOW', 'NOW TV Cinema': 'NOW', 'Netflix Kids': 'Netflix' };
  const brand = (n) => {
    const b = n.replace(/\s+(Standard|Basic|Premium)?\s*with Ads$/i, '').replace(/\s+(Amazon|Apple TV|Roku Premium)\s+Channel$/i, '')
      .replace(/\s+(Premium|Kids|Basic|Standard|Essential)$/i, '').replace(/^Paramount\+$/, 'Paramount Plus').trim();
    return NAMES[b] || b;
  };
  // ---------- every service links somewhere that works (each address tested in a browser, October 2026) ----------
  // 1. the title itself, where Wikidata knows its ID on that service (titles.json `ln`); on phones these open the app
  const DIRECT = {
    'Netflix': (l) => l.nf && `https://www.netflix.com/title/${l.nf}`, 'Disney+': (l) => l.dp && `https://www.disneyplus.com/${l.dp}`,
    'Prime Video': (l) => l.pv && `https://www.primevideo.com/detail/${l.pv}`, 'Prime Video Store': (l) => l.pv && `https://www.primevideo.com/detail/${l.pv}`,
    'HBO Max': (l) => l.hb && `https://play.hbomax.com/${l.hb}`, 'Apple TV': (l) => l.ap && `https://tv.apple.com/gb/${l.ap}`, 'Apple TV+': (l) => l.ap && `https://tv.apple.com/gb/${l.ap}`,
  };
  // 2. the service's own search, with the title filled in
  const q = (t) => encodeURIComponent(t);
  const apple = (t) => `https://tv.apple.com/gb/search?term=${q(t)}`, amazon = (t) => `https://www.amazon.co.uk/s?k=${q(t)}&i=instant-video`;
  const youtube = (t) => `https://www.youtube.com/results?search_query=${q(t)}`;
  const SEARCH = {
    'Apple TV': apple, 'Apple TV+': apple, 'Prime Video': amazon, 'Prime Video Store': amazon, 'Amazon MX Player': amazon,
    'Google Play Movies': (t) => `https://play.google.com/store/search?q=${q(t)}&c=movies`, 'YouTube': youtube, 'YouTube Free': youtube,
    'Netflix': (t) => `https://www.netflix.com/search?q=${q(t)}`, 'Sky Store': (t) => `https://www.skystore.com/search?q=${q(t)}`,
    'NOW': (t) => `https://www.nowtv.com/watch/search?q=${q(t)}`, 'Rakuten TV': (t) => `https://www.rakuten.tv/uk/search?q=${q(t)}`,
    'BBC iPlayer': (t) => `https://www.bbc.co.uk/iplayer/search?q=${q(t)}`, 'ITVX': (t) => `https://www.itv.com/watch/search?q=${q(t)}`,
    '5': (t) => `https://www.channel5.com/search?q=${q(t)}`, 'UKTV Play': (t) => `https://u.co.uk/search?q=${q(t)}`, 'STV Player': (t) => `https://player.stv.tv/search?q=${q(t)}`,
    'Paramount+': (t) => `https://www.paramountplus.com/gb/search/?q=${q(t)}`, 'HBO Max': (t) => `https://play.hbomax.com/search?q=${q(t)}`,
    'MUBI': (t) => `https://mubi.com/en/gb/search/films?query=${q(t)}`, 'Tubi TV': (t) => `https://tubitv.com/search/${q(t)}`,
    'Crunchyroll': (t) => `https://www.crunchyroll.com/search?q=${q(t)}`, 'BFI Player': (t) => `https://player.bfi.org.uk/search?q=${q(t)}`,
    'Plex': (t) => `https://watch.plex.tv/search?q=${q(t)}`, 'Hayu': (t) => `https://www.hayu.com/search?q=${q(t)}`,
  };
  // 3. services with no search page that opens from a link: their home page
  const HOME = {
    'Disney+': 'https://www.disneyplus.com/', 'Channel 4': 'https://www.channel4.com/', 'Sky Go': 'https://www.sky.com/watch/sky-go',
    'Curzon Home Cinema': 'https://www.curzon.com/home-cinema/', 'Discovery+': 'https://www.discoveryplus.com/gb', 'Pluto TV': 'https://pluto.tv/',
    'Shudder': 'https://www.shudder.com/',
  };
  // channels you watch inside Prime Video or the Apple TV app open that app's search
  const link = (raw, title, ln, info) => {
    const b = brand(raw);
    return DIRECT[b]?.(ln) || (b === 'Netflix' && info.netflix)
      || (/amazon channel$/i.test(raw) ? amazon(title) : /apple tv channel$/i.test(raw) ? apple(title) : null)
      || SEARCH[b]?.(title) || HOME[b] || info.watch;   // 4. otherwise the title's TMDB page, which lists every service
  };
  window.tnLinks = { brand, link };
})();
