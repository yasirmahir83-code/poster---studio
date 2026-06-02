// Railway Node.js API
const TMDB_KEY = 'efef2b916f7e7c557a2528095210d8a6';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w780';
const SERPER_KEY = 'ad8046eaea2913626cd49174a5aa371e578d3983';

async function fetchImageAsBase64(url) {
  try {
    const { default: https } = await import(url.startsWith('https') ? 'https' : 'http');
    return new Promise((resolve) => {
      const req = https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://google.com',
          'Accept': 'image/webp,image/*,*/*;q=0.8'
        },
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

async function searchSerper(query) {
  try {
    const https = require('https');
    const data = JSON.stringify({ q: query, num: 10 });
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'google.serper.dev',
        path: '/images',
        method: 'POST',
        headers: {
          'X-API-KEY': SERPER_KEY,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const d = JSON.parse(body);
            resolve(d.images || []);
          } catch(e) { resolve([]); }
        });
      });
      req.on('error', () => resolve([]));
      req.write(data);
      req.end();
    });
  } catch(e) { return []; }
}

function getBestImage(images) {
  if (!images.length) return null;
  const hqPortrait = images.filter(img => {
    const w = parseInt(img.imageWidth || 0);
    const h = parseInt(img.imageHeight || 0);
    return h > w && w >= 500;
  });
  if (hqPortrait.length) return hqPortrait[0].imageUrl;
  const portrait = images.filter(img => {
    const w = parseInt(img.imageWidth || 0);
    const h = parseInt(img.imageHeight || 0);
    return h > w && w >= 300;
  });
  if (portrait.length) return portrait[0].imageUrl;
  const anyPortrait = images.filter(img => {
    const w = parseInt(img.imageWidth || 0);
    const h = parseInt(img.imageHeight || 0);
    return h > w;
  });
  if (anyPortrait.length) return anyPortrait[0].imageUrl;
  return images[0]?.imageUrl || null;
}

const CHANNEL_MAP = {
  'alsharqiya': 'alsharqiya', 'الشرقية': 'alsharqiya',
  'alsumaria': 'alsumaria', 'السومرية': 'alsumaria',
  'dijlah': 'dijlah', 'دجلة': 'dijlah',
  'aliraqia': 'aliraqia', 'العراقية': 'aliraqia',
  'aliraqi24': 'aliraqi24', 'العراق 24': 'aliraqi24',
  'alfurat': 'alfurat', 'الفرات': 'alfurat',
  'alfalouja': 'alfalouja', 'الفلوجة': 'alfalouja',
  'karbala': 'karbala', 'كربلاء': 'karbala',
  'alahad': 'alahad', 'العهد': 'alahad',
  'alshabab': 'alshabab', 'الشباب': 'alshabab',
  'alrabiaa': 'alrabiaa', 'الرابعة': 'alrabiaa',
  'alrasheed': 'alrasheed', 'الرشيد': 'alrasheed',
  'mbc': 'mbc', 'aljazeera': 'aljazeera', 'الجزيرة': 'aljazeera',
  'abudhabi': 'abudhabi', 'أبو ظبي': 'abudhabi',
  'dubai': 'dubai', 'دبي': 'dubai',
  'alhayat': 'alhayat', 'الحياة': 'alhayat',
  'cbc': 'cbc', 'dmc': 'dmc', 'on': 'on',
  'super': 'super', 'mbc masr': 'mbc masr',
  'alkhaleejieh': 'alkhaleejieh', 'الخليجية': 'alkhaleejieh',
  'ktv': 'ktv', 'kuwait tv': 'kuwait tv',
};

function getChannelKeyword(channel) {
  if (!channel) return null;
  const lower = channel.toLowerCase().trim();
  for (const [key, val] of Object.entries(CHANNEL_MAP)) {
    if (lower.includes(key.toLowerCase())) return val;
  }
  return channel;
}

function buildQueries(title, skip, channel) {
  const isConcert = /حفل/.test(title);
  const isKids = /أطفال|اطفال|kids|cartoon|كارتون/i.test(title);
  const channelKeyword = getChannelKeyword(channel);
  const queries = [title, `${title} poster`];
  if (isConcert) queries.push(`${title} concert poster`);
  if (isKids) queries.push(`${title} kids cartoon TV show poster`);
  if (channelKeyword) queries.push(`${title} ${channelKeyword}`);
  queries.push(`${title} official poster`, `${title} HD`, `${title} 2024`);
  return queries;
}

async function searchGoogle(title, skip, channel) {
  skip = skip || 0;
  const queries = buildQueries(title, skip, channel);
  const startIdx = skip % queries.length;
  for (let i = 0; i < queries.length; i++) {
    const q = queries[(startIdx + i) % queries.length];
    const images = await searchSerper(q);
    const url = getBestImage(images);
    if (url) return url;
  }
  return null;
}

async function httpsGet(url) {
  const https = require('https');
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch(e) { resolve({}); }
      });
    }).on('error', () => resolve({}));
  });
}

function cleanTitleForTMDB(title) {
  return title
    .replace(/^(فيلم|مسلسل|برنامج|حفلة|حفلات|series|movie|film|show|TV show|concert)\s+/i, '')
    .trim();
}

async function searchTMDB(title, skip) {
  skip = skip || 0;
  try {
    const cleanTitle = cleanTitleForTMDB(title);
    const q = encodeURIComponent(cleanTitle);
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
    const posters = imgData.posters || [];
    if (!posters.length) return null;
    const poster = posters[Math.floor(skip/candidates.length) % posters.length];
    return poster?.file_path ? TMDB_IMG + poster.file_path : null;
  } catch(e) { return null; }
}

async function searchWithPuppeteer(title, site) {
  try {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    let imgUrl = null;
    if (site === 'shahid') {
      const searchUrl = `https://shahid.mbc.net/ar/search?q=${encodeURIComponent(title)}`;
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      imgUrl = await page.evaluate(() => {
        const imgs = document.querySelectorAll('img[src*="shahid"], img[src*="mbc"]');
        for (const img of imgs) {
          const w = img.naturalWidth || parseInt(img.getAttribute('width') || 0);
          const h = img.naturalHeight || parseInt(img.getAttribute('height') || 0);
          if (w >= 200 && h > w) return img.src;
          if (w >= 200) return img.src;
        }
        const allImgs = document.querySelectorAll('img');
        for (const img of allImgs) {
          if (img.src && (img.src.includes('poster') || img.src.includes('thumb') || img.src.includes('cover'))) {
            return img.src;
          }
        }
        return null;
      });
    }
    await browser.close();
    return imgUrl;
  } catch(e) {
    console.log('Puppeteer error:', e.message);
    return null;
  }
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

    if (source === 'tmdb') {
      imgUrl = await searchTMDB(title, s);
    } else if (source === 'google') {
      imgUrl = await searchGoogle(title, s, channel);
    } else {
      const isShahid = /شاهد|shahid/i.test(title) || /شاهد|shahid/i.test(channel);
      if (isShahid) {
        const cleanTitle = title.replace(/شاهد|shahid/gi, '').trim();
        imgUrl = await searchWithPuppeteer(cleanTitle, 'shahid');
      }
      if (!imgUrl) imgUrl = await searchTMDB(title, s);
      if (!imgUrl) imgUrl = await searchGoogle(title, s, channel);
    }

    if (!imgUrl) return res.json({ found: false });

    const dataUrl = await fetchImageAsBase64(imgUrl);
    if (dataUrl) return res.json({ found: true, dataUrl, source, imgUrl });
    return res.json({ found: true, imgUrl, source });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
