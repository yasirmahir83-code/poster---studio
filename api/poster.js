const TMDB_KEY = 'efef2b916f7e7c557a2528095210d8a6';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w780';
const SERPER_KEY = 'b98a37191b7263635742b763e55b1a85a2f37abef';

async function fetchImageAsBase64(url) {
  const https = require('https');
  const http = require('http');
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://google.com',
        'Accept': 'image/*'
      },
      timeout: 10000
    }, (res) => {
      if (res.statusCode !== 200) { resolve(null); return; }
      const ct = res.headers['content-type'] || 'image/jpeg';
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 100) { resolve(null); return; }
        resolve(`data:${ct};base64,${buf.toString('base64')}`);
      });
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function searchSerper(query) {
  try {
    const res = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 10 })
    });
    const d = await res.json();
    return d.images || [];
  } catch(e) { return []; }
}

function getBestImage(images) {
  if (!images.length) return null;
  const portrait = images.filter(img => {
    const w = parseInt(img.imageWidth || 0);
    const h = parseInt(img.imageHeight || 0);
    return h > w && w >= 200;
  });
  const list = portrait.length ? portrait : images;
  return list[0]?.imageUrl || null;
}

async function searchGoogle(title, skip) {
  skip = skip || 0;
  const queries = [
    `${title} poster`,
    `${title}`,
    `${title} TV show`,
  ];
  for (let i = 0; i < queries.length; i++) {
    const q = queries[(skip + i) % queries.length];
    const images = await searchSerper(q);
    const url = getBestImage(images);
    if (url) return url;
  }
  return null;
}

async function searchTMDB(title, skip) {
  skip = skip || 0;
  try {
    const q = encodeURIComponent(title);
    const [m1, t1, m2, t2] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${q}&language=ar`).then(r=>r.json()),
      fetch(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${q}&language=ar`).then(r=>r.json()),
      fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${q}`).then(r=>r.json()),
      fetch(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${q}`).then(r=>r.json()),
    ]);
    const seen = new Set(); const candidates = [];
    for (const [type, data] of [['movie',m1],['tv',t1],['movie',m2],['tv',t2]]) {
      for (const r of (data.results||[])) {
        if (!seen.has(r.id)) { seen.add(r.id); candidates.push({id:r.id,type}); }
      }
    }
    if (!candidates.length) return null;
    const pick = candidates[skip % candidates.length];
    const imgData = await fetch(`https://api.themoviedb.org/3/${pick.type}/${pick.id}/images?api_key=${TMDB_KEY}`).then(r=>r.json());
    const posters = imgData.posters || [];
    if (!posters.length) return null;
    const poster = posters[Math.floor(skip/candidates.length) % posters.length];
    return poster?.file_path ? TMDB_IMG + poster.file_path : null;
  } catch(e) { return null; }
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
    } else if (source === 'google') {
      imgUrl = await searchGoogle(title, s);
    } else {
      imgUrl = await searchTMDB(title, s);
      if (!imgUrl) imgUrl = await searchGoogle(title, s);
    }

    if (!imgUrl) return res.json({ found: false });

    const dataUrl = await fetchImageAsBase64(imgUrl);
    if (dataUrl) return res.json({ found: true, dataUrl, source, imgUrl });
    return res.json({ found: true, imgUrl, source });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
