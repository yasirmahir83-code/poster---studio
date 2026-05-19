// Vercel serverless function — fetches poster from Shahid/OSN/WatchIt/TMDB
export const config = { runtime: 'edge' };

const TMDB_KEY = 'efef2b916f7e7c557a2528095210d8a6';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

async function fetchTmdbPoster(title, skip = 0) {
  const q = encodeURIComponent(title);
  const [mRes, tRes, mRes2, tRes2] = await Promise.all([
    fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${q}&language=ar`),
    fetch(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${q}&language=ar`),
    fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${q}`),
    fetch(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${q}`)
  ]);
  const [mData, tData, mData2, tData2] = await Promise.all([mRes.json(), tRes.json(), mRes2.json(), tRes2.json()]);

  const seen = new Set();
  const candidates = [];
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
}

const SOURCES = {
  tmdb: async (title, skip) => fetchTmdbPoster(title, skip || 0),
  shahid: async (title) => {
    const q = encodeURIComponent(title);
    const r = await fetch(`https://shahid.mbc.net/ar/search?q=${q}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ar' }
    });
    const html = await r.text();
    const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);
    if (og) return og[1];
    const img = html.match(/https:\/\/[^"']+shahid[^"']+\.(jpg|jpeg|png|webp)/i);
    return img ? img[0] : null;
  },
  osn: async (title) => {
    const q = encodeURIComponent(title);
    const r = await fetch(`https://www.osn.com/en/search?q=${q}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await r.text();
    const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);
    if (og) return og[1];
    const img = html.match(/https:\/\/[^"']+osn[^"']+\.(jpg|jpeg|png|webp)/i);
    return img ? img[0] : null;
  },
  watchit: async (title) => {
    const q = encodeURIComponent(title);
    const r = await fetch(`https://watchit.ae/search?query=${q}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await r.text();
    const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);
    if (og) return og[1];
    const img = html.match(/https:\/\/[^"']+watchit[^"']+\.(jpg|jpeg|png|webp)/i);
    return img ? img[0] : null;
  }
};

// convert ArrayBuffer to base64 safely
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default async function handler(req) {
  const url = new URL(req.url);
  const title = url.searchParams.get('title');
  const source = url.searchParams.get('source') || 'tmdb';
  const skip = parseInt(url.searchParams.get('skip') || '0');
  const proxyUrl = url.searchParams.get('url');

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  // proxy mode
  if (proxyUrl) {
    try {
      const r = await fetch(proxyUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const buf = await r.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);
      const ct = r.headers.get('content-type') || 'image/jpeg';
      return new Response(JSON.stringify({ dataUrl: `data:${ct};base64,${b64}` }), { headers });
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

    const imgRes = await fetch(imgUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const buf = await imgRes.arrayBuffer();
    const b64 = arrayBufferToBase64(buf);
    const ct = imgRes.headers.get('content-type') || 'image/jpeg';

    return new Response(JSON.stringify({
      found: true,
      dataUrl: `data:${ct};base64,${b64}`,
      source,
      imgUrl
    }), { headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}

