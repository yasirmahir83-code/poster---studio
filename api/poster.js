// Railway Node.js API — TMDB + Shahid (Puppeteer with login)
const TMDB_KEY = 'efef2b916f7e7c557a2528095210d8a6';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w780';
const SHAHID_EMAIL = process.env.SHAHID_EMAIL || '';
const SHAHID_PASSWORD = process.env.SHAHID_PASSWORD || '';

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

function cleanTitle(title) {
  return title.replace(/^(فيلم|مسلسل|برنامج|حفلة|حفلات|series|movie|film|show|TV show|concert)\s+/i, '').trim();
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
    const posters = imgData.posters || [];
    if (!posters.length) return null;
    const poster = posters[Math.floor(skip/candidates.length) % posters.length];
    return poster?.file_path ? TMDB_IMG + poster.file_path : null;
  } catch(e) { return null; }
}

let browserInstance = null;
let isLoggedInShahid = false;

async function getBrowser() {
  if (browserInstance) {
    try { await browserInstance.version(); return browserInstance; } catch(e) { browserInstance = null; }
  }
  const puppeteer = require('puppeteer');
  browserInstance = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });
  isLoggedInShahid = false;
  return browserInstance;
}

async function loginShahid(page) {
  try {
    await page.goto('https://shahid.mbc.net/ar/auth/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000));
    const emailInput = await page.$('input[type="email"], input[name="email"], input[placeholder*="mail"]');
    const passInput = await page.$('input[type="password"]');
    if (emailInput && passInput) {
      await emailInput.click({ clickCount: 3 });
      await emailInput.type(SHAHID_EMAIL);
      await passInput.click({ clickCount: 3 });
      await passInput.type(SHAHID_PASSWORD);
      await passInput.press('Enter');
      await new Promise(r => setTimeout(r, 4000));
      isLoggedInShahid = true;
      console.log('Shahid login done');
    }
  } catch(e) { console.log('Shahid login error:', e.message); }
}

async function searchShahid(title) {
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

    // Login if needed
    if (SHAHID_EMAIL && SHAHID_PASSWORD && !isLoggedInShahid) {
      await loginShahid(page);
    }

    // Search
    const searchUrl = `https://shahid.mbc.net/ar/search?q=${encodeURIComponent(cleanTitle(title))}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 3000));

    // Find program page link
    const programUrl = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      for (const a of links) {
        const h = a.href || '';
        if (h.includes('/ar/series/') || h.includes('/ar/movies/') || h.includes('/ar/shows/') || h.includes('/ar/program/')) {
          return h;
        }
      }
      return null;
    });

    console.log('Shahid program URL:', programUrl);

    if (programUrl) {
      await page.goto(programUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await new Promise(r => setTimeout(r, 3000));
    }

    // Get poster
    const imgUrl = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const portraits = imgs.filter(img => {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        const src = img.src || '';
        return src && w >= 200 && h > w * 1.2 && !src.includes('logo') && !src.includes('icon') && !src.includes('avatar');
      });
      if (portraits.length) return portraits[0].src;
      for (const img of imgs) {
        const ds = img.getAttribute('data-src') || '';
        if (ds && ds.startsWith('http') && !ds.includes('logo')) return ds;
      }
      return null;
    });

    await page.close();
    console.log('Shahid poster:', imgUrl ? 'found' : 'not found');
    return imgUrl;
  } catch(e) {
    console.log('Shahid error:', e.message);
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
    const isShahid = /شاهد|shahid/i.test(title) || /شاهد|shahid/i.test(channel);

    if (source === 'tmdb') {
      imgUrl = await searchTMDB(title, s);
    } else if (source === 'shahid') {
      imgUrl = await searchShahid(title);
    } else {
      // Auto: TMDB first, then Shahid if requested
      imgUrl = await searchTMDB(title, s);
      if (!imgUrl && isShahid) {
        imgUrl = await searchShahid(title);
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
