// Railway Node.js API — TMDB + Shahid via ScrapingBee
const TMDB_KEY = 'efef2b916f7e7c557a2528095210d8a6';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w780';
const SCRAPINGBEE_KEY = process.env.SCRAPINGBEE_KEY || '';

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

async function scrapingBeeGet(targetUrl) {
  try {
    const https = require('https');
    const apiUrl = `https://app.scrapingbee.com/api/v1/?api_key=${SCRAPINGBEE_KEY}&url=${encodeURIComponent(targetUrl)}&render_js=true&wait=3000&premium_proxy=true`;
    return new Promise((resolve) => {
      https.get(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(body));
        res.on('error', () => resolve(''));
      }).on('error', () => resolve(''));
    });
  } catch(e) { return ''; }
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

async function searchShahid(title) {
  try {
    const searchUrl = `https://shahid.mbc.net/ar/search?q=${encodeURIComponent(cleanTitle(title))}`;
    console.log('ScrapingBee fetching:', searchUrl);
    
    const html = await scrapingBeeGet(searchUrl);
    if (!html) return null;
    
    // Extract image URLs from HTML
    const imgMatches = html.match(/https?:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp)[^"'\s]*/gi) || [];
    console.log('Found imgs:', imgMatches.length);
    console.log('First 10 imgs:', imgMatches.slice(0,10).join('\n'));
    
    // Filter for poster-like images (exclude logos, icons, brand images)
    const posters = imgMatches.filter(url => 
      !url.includes('logo') && 
      !url.includes('icon') && 
      !url.includes('avatar') &&
      !url.includes('mbc-shahid') &&
      !url.includes('staticFiles') &&
      !url.includes('brand') &&
      (url.includes('poster') || url.includes('thumb') || url.includes('cover') || url.includes('program') || url.includes('series') || url.includes('show'))
    );
    
    if (posters.length) {
      console.log('Shahid poster found:', posters[0]);
      return posters[0];
    }
    
    // Try any large image URL
    if (imgMatches.length) return imgMatches[0];
    return null;
  } catch(e) {
    console.log('Shahid ScrapingBee error:', e.message);
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
