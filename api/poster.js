// Vercel serverless function — TMDB + Serper.dev Google Images
export const config = { runtime: 'edge' };

const TMDB_KEY = 'efef2b916f7e7c557a2528095210d8a6';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w780';
const SERPER_KEY = 'b98a37191b7263635742b763e55b1a85a2f37abef';

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function fetchImageAsBase64(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://google.com' },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const b64 = arrayBufferToBase64(buf);
    const ct = r.headers.get('content-type') || 'image/jpeg';
    return `data:${ct};base64,${b64}`;
  } catch(e) {
    return null;
  }
}

const SOURCES = {
  tmdb: async (title, skip) => {
    skip = skip || 0;
    const q = encodeURIComponent(title);
    const [mRes, tRes, mRes2, tRes2] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${q}&language=ar`),
      fetch(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${q}&language=ar`),
      fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${q}`),
      fetch(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${q}`)
    ]);
    const [mData, tData, mData2, tData2] = await Promise.all([mRes.json(), tRes.json(), mRes2.json(), tRes2.json()]);
    const seen = new Set(); const candidates = [];
    for (const [type, data] of [['movie', mData], ['tv', tData], ['movie', mData2], ['tv', tData2]]) {
      for (const r of (data.results || [])) {
        if (!seen.has(r.id)) { seen.add(r.id); candidates.push({ id: r.id, type }); }
      }
    }
    if (!candidates.length) return { url: null };
    const pick = candidates[skip % candidates.length];
    const imgRes = await fetch(`https://api.themoviedb.org/3/${pick.type}/${pick.id}/images?api_key=${TMDB_KEY}`);
    const imgData = await imgRes.json();
    const posters = imgData.posters || [];
    if (!posters.length) return { url: null };
    const poster = posters[Math.floor(skip / candidates.length) % posters.length];
    return { url: poster?.file_path ? TMDB_IMG + poster.file_path : null };
  },

  google: async (title, skip) => {
    skip = skip || 0;
    const queries = [
      `${title}`,
      `${title} poster`,
      `${title} مسلسل فيلم برنامج`,
    ];
    const q = queries[skip % queries.length];
    
    const r = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q, num: 10, gl: 'iq', hl: 'ar' })
    });
    
    const d = await r.json();
    if (!d.images || !d.images.length) return { url: null };
    
    // Prefer portrait images
    const portrait = d.images.filter(img => {
      const w = parseInt(img.imageWidth || 0);
      const h = parseInt(img.imageHeight || 0);
      return h > w;
    });
    
    const items = portrait.length ? portrait : d.images;
    // Try multiple images if first fails
    for (let i = 0; i < Math.min(items.length, 5); i++) {
      const imgUrl = items[(Math.floor(skip / 3) + i) % items.length]?.imageUrl;
      if (imgUrl) return { url: imgUrl };
    }
    return { url: null };
  }
};

export default async function handler(req) {
  const url = new URL(req.url);
  const title = url.searchParams.get('title');
  const source = url.searchParams.get('source') || 'tmdb';
  const skip = parseInt(url.searchParams.get('skip') || '0');
  const proxyUrl = url.searchParams.get('url');

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };

  // Proxy endpoint — fetch image as base64
  if (proxyUrl) {
    try {
      const dataUrl = await fetchImageAsBase64(proxyUrl);
      if (!dataUrl) return new Response(JSON.stringify({ error: 'failed' }), { status: 500, headers });
      return new Response(JSON.stringify({ dataUrl }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  if (!title) return new Response(JSON.stringify({ error: 'title required' }), { status: 400, headers });

  try {
    const fn = SOURCES[source];
    if (!fn) return new Response(JSON.stringify({ error: 'unknown source' }), { status: 400, headers });

    const { url: imgUrl } = await fn(title, skip);
    if (!imgUrl) return new Response(JSON.stringify({ found: false }), { headers });

    // Try to fetch image as base64
    const dataUrl = await fetchImageAsBase64(imgUrl);
    if (!dataUrl) {
      // Return URL directly if base64 fails — let client handle it
      return new Response(JSON.stringify({ found: true, imgUrl, source }), { headers });
    }
    return new Response(JSON.stringify({ found: true, dataUrl, source, imgUrl }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
