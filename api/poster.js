// Railway Node.js API — Multi-source landscape poster search
// Sources: TMDB, Fanart.tv, TheTVDB, Trakt, TVMaze, last.fm, AniList, Kitsu, elcinema

const TMDB_KEY = 'efef2b916f7e7c557a2528095210d8a6';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w780';
const FANART_KEY = 'fc571ea54d207843806a1f1af9efdf1f';
const TVDB_KEY = '511d8a7f-c126-4678-8547-26457be3f8a4';
const TRAKT_CLIENT_ID = '8578c2984a8d6811ab1e5125a1ee0aa8ad25f08e88163b5ca37717772654cba3';
const LASTFM_KEY = '6d8a3284c675bac7eac748da1e239545';

function cleanTitle(title) {
  return title
    .replace(/^(فيلم|مسلسل|برنامج|حفلة|حفلات|series|movie|film|show|TV show|concert)\s+/i, '')
    .trim();
}

function isLandscape(w, h) {
  return w > 0 && h > 0 && w > h;
}

async function fetchImageAsBase64(url) {
  try {
    const { default: client } = await import(url.startsWith('https') ? 'https' : 'http');
    return new Promise((resolve) => {
      const req = client.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://google.com', 'Accept': 'image/*' },
        timeout: 10000
      }, (res) => {
        if (res.statusCode >= 300) { resolve(null); return; }
        const ct = res.headers['content-type'] || 'image/jpeg';
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (buf.length < 500) { resolve(null); return; }
          resolve(`data:${ct};base64,${buf.toString('base64')}`);
        });
        res.on('error', () => resolve(null));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  } catch(e) { return null; }
}

async function httpsGet(url, headers = {}) {
  const https = require('https');
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers } }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve({}); } });
    }).on('error', () => resolve({}));
  });
}

async function httpsGetHtml(url) {
  const https = require('https');
  return new Promise((resolve) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html', 'Accept-Language': 'ar,en;q=0.9' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGetHtml(res.headers.location).then(resolve);
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
      res.on('error', () => resolve(''));
    }).on('error', () => resolve(''));
  });
}

// ── TMDB ─────────────────────────────────────────────
async function searchTMDB(title, skip) {
  skip = skip || 0;
  try {
    const q = encodeURIComponent(cleanTitle(title));
    const [m1, t1, m2, t2] = await Promise.all([
      httpsGet(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${q}&language=ar`),
      httpsGet(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${q}&language=ar`),
      httpsGet(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${q}`),
      httpsGet(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${q}`),
    ]);
    const seen = new Set(); const candidates = [];
    for (const [type, data] of [['movie',m1],['tv',t1],['movie',m2],['tv',t2]]) {
      for (const r of (data.results||[])) {
        if (!seen.has(r.id)) { seen.add(r.id); candidates.push({id:r.id,type}); }
      }
    }
    if (!candidates.length) return null;
    const pick = candidates[skip % candidates.length];
    const imgData = await httpsGet(`https://api.themoviedb.org/3/${pick.type}/${pick.id}/images?api_key=${TMDB_KEY}&include_image_language=en,null`);
    // Backdrops are landscape
    const backdrops = (imgData.backdrops || []).filter(b => b.file_path && isLandscape(b.width, b.height));
    if (backdrops.length) {
      const idx = Math.floor(skip / candidates.length) % backdrops.length;
      return 'https://image.tmdb.org/t/p/w1280' + backdrops[idx].file_path;
    }
    return null;
  } catch(e) { return null; }
}

// ── Fanart.tv ─────────────────────────────────────────
async function searchFanart(title, skip) {
  skip = skip || 0;
  try {
    const q = encodeURIComponent(cleanTitle(title));
    // Search TMDB first to get ID for Fanart
    const tmdbSearch = await httpsGet(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${q}`);
    const results = tmdbSearch.results || [];
    if (!results.length) return null;
    const item = results[skip % results.length];
    const type = item.media_type === 'movie' ? 'movies' : 'tv';
    const fanartData = await httpsGet(`https://webservice.fanart.tv/v3/${type}/${item.id}?api_key=${FANART_KEY}`);
    
    // Get landscape images (moviebackground, showbackground, moviethumb, tvthumb)
    const landscapeKeys = ['moviebackground', 'showbackground', 'moviethumb', 'tvthumb', 'seasonthumb'];
    for (const key of landscapeKeys) {
      const imgs = fanartData[key];
      if (imgs && imgs.length) {
        return imgs[0].url;
      }
    }
    return null;
  } catch(e) { return null; }
}

// ── TheTVDB ───────────────────────────────────────────
let tvdbToken = null;
async function getTVDBToken() {
  if (tvdbToken) return tvdbToken;
  try {
    const https = require('https');
    const data = JSON.stringify({ apikey: TVDB_KEY });
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api4.thetvdb.com',
        path: '/v4/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const d = JSON.parse(body);
            tvdbToken = d.data?.token || null;
            resolve(tvdbToken);
          } catch(e) { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.write(data);
      req.end();
    });
  } catch(e) { return null; }
}

async function searchTVDB(title, skip) {
  skip = skip || 0;
  try {
    const token = await getTVDBToken();
    if (!token) return null;
    const q = encodeURIComponent(cleanTitle(title));
    const searchData = await httpsGet(
      `https://api4.thetvdb.com/v4/search?query=${q}&limit=5`,
      { Authorization: `Bearer ${token}` }
    );
    const results = (searchData.data || []);
    if (!results.length) return null;
    const item = results[skip % results.length];
    const id = item.tvdb_id || item.id;
    const type = item.type === 'movie' ? 'movies' : 'series';
    const detail = await httpsGet(
      `https://api4.thetvdb.com/v4/${type}/${id}/artworks`,
      { Authorization: `Bearer ${token}` }
    );
    const artworks = (detail.data || []).filter(a => {
      // Type 3 = background (landscape)
      return a.type === 3 && a.image;
    });
    if (artworks.length) return artworks[0].image;
    return null;
  } catch(e) { return null; }
}

// ── Trakt ─────────────────────────────────────────────
async function searchTrakt(title, skip) {
  skip = skip || 0;
  try {
    const q = encodeURIComponent(cleanTitle(title));
    const results = await httpsGet(
      `https://api.trakt.tv/search/movie,show?query=${q}&limit=5`,
      { 'trakt-api-key': TRAKT_CLIENT_ID, 'trakt-api-version': '2', 'Content-Type': 'application/json' }
    );
    if (!Array.isArray(results) || !results.length) return null;
    const item = results[skip % results.length];
    const tmdbId = item.movie?.ids?.tmdb || item.show?.ids?.tmdb;
    if (!tmdbId) return null;
    const type = item.type === 'movie' ? 'movie' : 'tv';
    const imgData = await httpsGet(`https://api.themoviedb.org/3/${type}/${tmdbId}/images?api_key=${TMDB_KEY}&include_image_language=en,null`);
    const backdrops = (imgData.backdrops || []).filter(b => b.file_path && isLandscape(b.width, b.height));
    if (backdrops.length) return 'https://image.tmdb.org/t/p/w1280' + backdrops[0].file_path;
    return null;
  } catch(e) { return null; }
}

// ── TVMaze ────────────────────────────────────────────
async function searchTVMaze(title, skip) {
  skip = skip || 0;
  try {
    const q = encodeURIComponent(cleanTitle(title));
    const results = await httpsGet(`https://api.tvmaze.com/search/shows?q=${q}`);
    if (!Array.isArray(results) || !results.length) return null;
    const item = results[skip % results.length];
    const showId = item.show?.id;
    if (!showId) return null;
    const images = await httpsGet(`https://api.tvmaze.com/shows/${showId}/images`);
    if (!Array.isArray(images)) return null;
    const backgrounds = images.filter(i => i.type === 'background' && i.resolutions?.original?.url);
    if (backgrounds.length) return backgrounds[0].resolutions.original.url;
    return null;
  } catch(e) { return null; }
}

// ── last.fm (concerts/artists) ────────────────────────
async function searchLastFM(title, skip) {
  skip = skip || 0;
  try {
    const isConcert = /حفل|concert|حفلة/i.test(title);
    const artist = cleanTitle(title).replace(/حفل|حفلة|concert/gi, '').trim();
    const q = encodeURIComponent(artist);
    const data = await httpsGet(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${q}&api_key=${LASTFM_KEY}&format=json`);
    const images = data.artist?.image || [];
    // Get largest image
    const large = images.filter(i => i['#text'] && (i.size === 'extralarge' || i.size === 'large' || i.size === 'mega'));
    if (large.length) return large[large.length - 1]['#text'];
    return null;
  } catch(e) { return null; }
}

// ── AniList (anime/cartoon) ───────────────────────────
async function searchAniList(title, skip) {
  skip = skip || 0;
  try {
    const query = `query($search:String){Media(search:$search,type:ANIME){bannerImage coverImage{extraLarge}}}`;
    const https = require('https');
    const body = JSON.stringify({ query, variables: { search: cleanTitle(title) } });
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'graphql.anilist.co',
        path: '/',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const d = JSON.parse(data);
            // bannerImage is landscape
            const banner = d.data?.Media?.bannerImage;
            if (banner) { resolve(banner); return; }
            resolve(null);
          } catch(e) { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.write(body);
      req.end();
    });
  } catch(e) { return null; }
}

// ── Kitsu (anime) ─────────────────────────────────────
async function searchKitsu(title, skip) {
  skip = skip || 0;
  try {
    const q = encodeURIComponent(cleanTitle(title));
    const data = await httpsGet(`https://kitsu.app/api/edge/anime?filter[text]=${q}&page[limit]=5`);
    const results = data.data || [];
    if (!results.length) return null;
    const item = results[skip % results.length];
    const cover = item.attributes?.coverImage?.large || item.attributes?.coverImage?.original;
    return cover || null;
  } catch(e) { return null; }
}

// ── elcinema ──────────────────────────────────────────
async function searchElcinema(title) {
  try {
    const q = encodeURIComponent(cleanTitle(title));
    const html = await httpsGetHtml(`https://elcinema.com/search/all/?q=${q}`);
    if (!html) return null;
    const patterns = [
      /src="(https?:\/\/[^"]*elcinema[^"]*\.(?:jpg|jpeg|png|webp))"/i,
      /src="(https?:\/\/[^"]*\/media\/[^"]*\.(?:jpg|jpeg|png|webp))"/i,
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1] && !match[1].includes('logo') && !match[1].includes('icon')) {
        return match[1].startsWith('http') ? match[1] : 'https://elcinema.com' + match[1];
      }
    }
    return null;
  } catch(e) { return null; }
}

// ── MyDramaList ───────────────────────────────────────
async function searchMyDramaList(title, skip) {
  skip = skip || 0;
  try {
    const q = encodeURIComponent(cleanTitle(title));
    const html = await httpsGetHtml(`https://mydramalist.com/search?q=${q}`);
    if (!html) return null;
    const linkMatch = html.match(/href="(\/\d+[^"]+)"/);
    if (!linkMatch) return null;
    const detailHtml = await httpsGetHtml(`https://mydramalist.com${linkMatch[1]}`);
    if (!detailHtml) return null;
    const imgMatch = detailHtml.match(/property="og:image"\s+content="([^"]+)"/i);
    if (imgMatch && imgMatch[1] && !imgMatch[1].includes('logo')) return imgMatch[1];
    return null;
  } catch(e) { return null; }
}

// ── Simkl ─────────────────────────────────────────────
async function searchSimkl(title, skip) {
  skip = skip || 0;
  try {
    const q = encodeURIComponent(cleanTitle(title));
    const results = await httpsGet(`https://api.simkl.com/search/multi?q=${q}&client_id=d6c44f3e8b5a4a9f3b8c1d2e9f0a7b6c`);
    if (!Array.isArray(results) || !results.length) return null;
    const item = results[skip % results.length];
    const imgs = item.poster ? [`https://simkl.in/posters/${item.poster}_ca.jpg`] : [];
    // Try fanart (landscape)
    const fanart = item.fanart ? `https://simkl.in/fanart/${item.fanart}_fa.jpg` : null;
    if (fanart) return fanart;
    return null;
  } catch(e) { return null; }
}


const YOUTUBE_KEY = 'AIzaSyCpVo5qasCyTvpcqFFuecIHb8Gek8x9VjE';

// قاموس القنوات — اسم القناة → Channel ID على يوتيوب
const YOUTUBE_CHANNELS = {
  // القنوات العراقية
  'الشرقية': 'UC4wI0bNpRBauwbKgRaQyTVQ',
  'alsharqiya': 'UC4wI0bNpRBauwbKgRaQyTVQ',
  'السومرية': 'UCWhdSvXarykqCL4fqS3rm1Q',
  'alsumaria': 'UCWhdSvXarykqCL4fqS3rm1Q',
  'العراقية': 'UC5h9SokuzgNiebEOzU2BHoA',
  'aliraqia': 'UC5h9SokuzgNiebEOzU2BHoA',
  'دجلة': 'UCQmFb4GrIxTRxMNwkWyGpuQ',
  'dijlah': 'UCQmFb4GrIxTRxMNwkWyGpuQ',
  'الفرات': 'UCYwkEsqOSoK7xj1JDNM9E8A',
  'alfurat': 'UCYwkEsqOSoK7xj1JDNM9E8A',
  'الرابعة': 'UC_ALRABIA',
  'alrabia': 'UC_ALRABIA',
  // القنوات السعودية والخليجية
  'mbc': 'UCsLMJtJSsUmCf5NDm2BQSYQ',
  'mbc1': 'UCsLMJtJSsUmCf5NDm2BQSYQ',
  'mbc2': 'UCsLMJtJSsUmCf5NDm2BQSYQ',
  'mbc3': 'UCsLMJtJSsUmCf5NDm2BQSYQ',
  'mbc4': 'UCsLMJtJSsUmCf5NDm2BQSYQ',
  'روتانا': 'UCx4i3cC6AZQT_j6c_hGwrPg',
  'rotana': 'UCx4i3cC6AZQT_j6c_hGwrPg',
  'السعودية': 'UCNabhOHOnkv3INjYRqGkYrw',
  'saudi': 'UCNabhOHOnkv3INjYRqGkYrw',
  'الكويتية': 'UCZtLv9bPKBia5HBwIpQVpfg',
  'kuwait tv': 'UCZtLv9bPKBia5HBwIpQVpfg',
  // القنوات المصرية
  'mbc مصر': 'UCkP9ANYCXR7E01D7EgCy6tQ',
  'mbc masr': 'UCkP9ANYCXR7E01D7EgCy6tQ',
  'cbc': 'UCr3TiCODLFhvGJlVH-fteVQ',
  'dmc': 'UCeRmKPR9IXFYOW1Yd4BKLOQ',
  'on': 'UCy3SVMM8EqnGCOSbAFjiqmA',
  'الحياة': 'UCgMJGgbmECIFpBKe5I3Bkrg',
  'alhayat': 'UCgMJGgbmECIFpBKe5I3Bkrg',
  'النهار': 'UCEbzqkj76TSTMjMJHIWkCMQ',
  'alnahar': 'UCEbzqkj76TSTMjMJHIWkCMQ',
  'ten': 'UC_TEN_CHANNEL',
  'extra': 'UC_EXTRA',
  // قنوات الأخبار
  'الجزيرة': 'UCSls-6JSmFB4KCDCmTsJmFQ',
  'aljazeera': 'UCSls-6JSmFB4KCDCmTsJmFQ',
  'العربية': 'UCVQdpXqVUHHjJRaVKmFNObA',
  'alarabiya': 'UCVQdpXqVUHHjJRaVKmFNObA',
  'سكاي نيوز': 'UCblL3SjePIUGLWKg1SjWFRg',
  'sky news arabic': 'UCblL3SjePIUGLWKg1SjWFRg',
  // القنوات الأردنية
  'رؤيا': 'UCmqycBPhA1LKJkHCHGbM0PA',
  'roya': 'UCmqycBPhA1LKJkHCHGbM0PA',
  'الأردنية': 'UCmPSZCKBGPFUQMiELwHZksg',
  'jordan tv': 'UCmPSZCKBGPFUQMiELwHZksg',
};

async function searchYouTube(title, channel) {
  try {
    const cleanQ = cleanTitle(title);
    const query = channel ? `${cleanQ} ${channel}` : cleanQ;
    const q = encodeURIComponent(query);
    const data = await httpsGet(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&type=video&maxResults=5&key=${YOUTUBE_KEY}`);
    const items = data.items || [];
    for (const item of items) {
      const thumbs = item.snippet?.thumbnails;
      const img = thumbs?.maxres?.url || thumbs?.standard?.url || thumbs?.high?.url;
      if (img) return img;
    }
    return null;
  } catch(e) { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const { title, source='auto', skip='0', url: proxyUrl, channel='' } = req.query;

  if (proxyUrl) {
    const dataUrl = await fetchImageAsBase64(proxyUrl);
    if (!dataUrl) return res.status(500).json({ error: 'failed' });
    return res.json({ dataUrl });
  }

  if (!title) return res.status(400).json({ error: 'title required' });

  try {
    let imgUrl = null;
    const s = parseInt(skip) || 0;
    const isAnime = /أنمي|انمي|anime|كارتون|cartoon/i.test(title);
    const isConcert = /حفل|حفلة|concert/i.test(title);
    const isArabic = /[\u0600-\u06FF]/.test(title);

    if (source !== 'auto') {
      // Specific source
      if (source === 'tmdb') imgUrl = await searchTMDB(title, s);
      else if (source === 'fanart') imgUrl = await searchFanart(title, s);
      else if (source === 'tvdb') imgUrl = await searchTVDB(title, s);
      else if (source === 'trakt') imgUrl = await searchTrakt(title, s);
      else if (source === 'tvmaze') imgUrl = await searchTVMaze(title, s);
      else if (source === 'lastfm') imgUrl = await searchLastFM(title, s);
      else if (source === 'anilist') imgUrl = await searchAniList(title, s);
      else if (source === 'kitsu') imgUrl = await searchKitsu(title, s);
      else if (source === 'elcinema') imgUrl = await searchElcinema(title);
    } else {
      // Auto: try sources in order based on content type
      if (isConcert) {
        imgUrl = await searchLastFM(title, s);
        if (!imgUrl) imgUrl = await searchTMDB(title, s);
        if (!imgUrl) imgUrl = await searchYouTube(title, channel);
      } else if (isAnime) {
        imgUrl = await searchAniList(title, s);
        if (!imgUrl) imgUrl = await searchKitsu(title, s);
        if (!imgUrl) imgUrl = await searchTMDB(title, s);
        if (!imgUrl) imgUrl = await searchFanart(title, s);
        if (!imgUrl) imgUrl = await searchYouTube(title, channel);
      } else if (isArabic) {
        imgUrl = await searchTMDB(title, s);
        if (!imgUrl) imgUrl = await searchElcinema(title);
        if (!imgUrl) imgUrl = await searchFanart(title, s);
        if (!imgUrl) imgUrl = await searchTVDB(title, s);
        if (!imgUrl) imgUrl = await searchYouTube(title, channel);
      } else {
        imgUrl = await searchTMDB(title, s);
        if (!imgUrl) imgUrl = await searchFanart(title, s);
        if (!imgUrl) imgUrl = await searchTVDB(title, s);
        if (!imgUrl) imgUrl = await searchTrakt(title, s);
        if (!imgUrl) imgUrl = await searchTVMaze(title, s);
        if (!imgUrl) imgUrl = await searchMyDramaList(title, s);
        if (!imgUrl) imgUrl = await searchSimkl(title, s);
        if (!imgUrl) imgUrl = await searchYouTube(title, channel);
      }
    }

    if (!imgUrl) return res.json({ found: false });

    const dataUrl = await fetchImageAsBase64(imgUrl);
    if (dataUrl) return res.json({ found: true, dataUrl, source, imgUrl });
    return res.json({ found: true, imgUrl, source });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
