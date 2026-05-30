// Vercel serverless function — TMDB + Google Custom Search
export const config = { runtime: 'edge' };

const TMDB_KEY = 'efef2b916f7e7c557a2528095210d8a6';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const GOOGLE_API_KEY = 'AIzaSyDldDNQl0hZVzaJwwzxcJ_960yM5HdxS-M';
const GOOGLE_CX = '67643cfdf6f0643d4';

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
    const start = Math.min((skip * 1) + 1, 91); // max 100 results
    const q = encodeURIComponent(`${title} poster`);
    const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${q}&searchType=image&imgSize=xlarge&imgType=photo&num=10&start=${start}&safe=active`;
    const r = await fetch(url);
    const d = await r.json();
    if (!d.items || !d.items.length) return null;
    // prefer portrait images (height > width) for poster quality
    const portrait = d.items.filter(item => {
      const w = parseInt(item.image?.width || 0);
      const h = parseInt(item.image?.height || 0);
      return h > w && w >= 300;
    });
    const pick = portrait[skip % Math.max(portrait.length, 1)] || d.items[skip % d.items.length];
    return pick?.link || null;
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
