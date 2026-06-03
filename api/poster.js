// Railway Node.js API — TMDB + Elcinema
const TMDB_KEY = 'efef2b916f7e7c557a2528095210d8a6';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w780';

function cleanTitle(title) {
  return title
    .replace(/^(فيلم|مسلسل|برنامج|حفلة|حفلات|series|movie|film|show|TV show|concert)\s+/i, '')
    .trim();
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

async function httpsGet(url) {
  const https = require('https');
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
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
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'ar,en;q=0.9'
      }
    }, (res) => {
      // Handle redirects
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
    const imgData = await httpsGet(`https://api.themoviedb.org/3/${pick.type}/${pick.id}/images?api_key=${TMDB_KEY}`);
    
    // Use backdrops (landscape 16:9) instead of posters
    const backdrops = (imgData.backdrops || []).filter(b => b.file_path);
    if (backdrops.length) {
      const backdrop = backdrops[Math.floor(skip/candidates.length) % backdrops.length];
      return TMDB_IMG + backdrop.file_path;
    }
    return null;
  } catch(e) { return null; }
}

async function searchElcinema(title) {
  try {
    const q = encodeURIComponent(cleanTitle(title));
    const searchUrl = `https://elcinema.com/search/all/?q=${q}`;
    const html = await httpsGetHtml(searchUrl);
    if (!html) return null;

    // Extract first poster image
    const patterns = [
      /src="(https?:\/\/[^"]*elcinema[^"]*\.(?:jpg|jpeg|png|webp))"/i,
      /src="(https?:\/\/[^"]*\/media\/[^"]*\.(?:jpg|jpeg|png|webp))"/i,
      /<img[^>]+src="([^"]+\.(?:jpg|jpeg|png|webp))"[^>]*>/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const imgUrl = match[1].startsWith('http') ? match[1] : 'https://elcinema.com' + match[1];
        if (!imgUrl.includes('logo') && !imgUrl.includes('icon') && !imgUrl.includes('sprite')) {
          console.log('Elcinema found:', imgUrl);
          return imgUrl;
        }
      }
    }
    console.log('Elcinema: no poster found');
    return null;
  } catch(e) {
    console.log('Elcinema error:', e.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const { title, source='auto', skip='0', url: proxyUrl } = req.query;

  if (proxyUrl) {
    const dataUrl = await fetchImageAsBase64(proxyUrl);
    if (!dataUrl) return res.status(500).json({ error: 'failed' });
    return res.json({ dataUrl });
  }

  if (!title) return res.status(400).json({ error: 'title required' });

  try {
    let imgUrl = null;
    const s = parseInt(skip) || 0;

    if (source === 'tmdb') {
      imgUrl = await searchTMDB(title, s);
    } else if (source === 'elcinema') {
      imgUrl = await searchElcinema(title);
    } else {
      // Auto: TMDB first, then Elcinema
      imgUrl = await searchTMDB(title, s);
      if (!imgUrl) imgUrl = await searchElcinema(title);
    }

    if (!imgUrl) return res.json({ found: false });

    const dataUrl = await fetchImageAsBase64(imgUrl);
    if (dataUrl) return res.json({ found: true, dataUrl, source, imgUrl });
    return res.json({ found: true, imgUrl, source });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
