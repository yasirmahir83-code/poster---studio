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

async function fetchImage(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const buf = await r.arrayBuffer();
  const b64 = arrayBufferToBase64(buf);
  const ct = r.headers.get('content-type') || 'image/jpeg';
  return `data:${ct};base64,${b64}`;
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
    if (!candidates.length) return null;
    const pick = candidates[skip % candidates.length];
    const imgRes = await fetch(`https://api.themoviedb.org/3/${pick.type}/${pick.id}/images?api_key=${TMDB_KEY}`);
    const imgData = await imgRes.json();
    const posters = imgData.posters || [];
    if (!posters.length) return null;
    const poster = posters[Math.floor(skip / candidates.length) % posters.length];
    return poster?.file_path ? TMDB_IMG + poster.file_path : null;
  },

  google: async (title, skip) => {
    skip = skip || 0;
    // Use Serper.dev for Google Images search — searches entire web
    const queries = [
      `${title} poster`,
      `${title} برنامج تلفزيوني صورة`,
      `${title} مسلسل فيلم poster`,
    ];
    const q = queries[skip % queries.length];
    
    const r = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: q,
        num: 10,
        gl: 'iq', // Iraq region for better Arabic results
        hl: 'ar'
      })
    });
    
    const d = await r.json();
    if (!d.images || !d.images.length) return null;
    
    // Filter portrait images (height > width) for poster quality
    const portrait = d.images.filter(img => {
      const w = parseInt(img.imageWidth || 0);
      const h = parseInt(img.imageHeight || 0);
      return h > w && w >= 300;
    });
    
    const items = portrait.length ? portrait : d.images;
    const idx = Math.floor(skip / queries.length) % items.length;
    return items[idx]?.imageUrl || null;
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

  if (proxyUrl) {
    try {
      const dataUrl = await fetchImage(proxyUrl);
      return new Response(JSON.stringify({ dataUrl }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  if (!title) return new Response(JSON.stringify({ error: 'title required' }), { status: 400, headers });

  try {
    const fn = SOURCES[source];
    if (!fn) return new Response(JSON.stringify({ error: 'unknown source' }), { status: 400, headers });

    const imgUrl = await fn(title, skip);
    if (!imgUrl) return new Response(JSON.stringify({ found: false }), { headers });

    const dataUrl = await fetchImage(imgUrl);
    return new Response(JSON.stringify({ found: true, dataUrl, source, imgUrl }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
