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
  } catch(e) { return null; }
}

async function searchSerper(query) {
  try {
    const r = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 10 })
    });
    const d = await r.json();
    return d.images || [];
  } catch(e) { return []; }
}

function getBestImage(images) {
  if (!images.length) return null;
  // Prefer portrait (height > width)
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
  // Try multiple query variations
  const queries = [
    `${title} poster`,
    `${title} TV show poster`,
    `${title}`,
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
  } catch(e) { return null; }
}

export default async function handler(req) {
  const url = new URL(req.url);
  const title = url.searchParams.get('title');
  const source = url.searchParams.get('source') || 'auto';
  const skip = parseInt(url.searchParams.get('skip') || '0');
  const proxyUrl = url.searchParams.get('url');

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };

  if (proxyUrl) {
    const dataUrl = await fetchImageAsBase64(proxyUrl);
    if (!dataUrl) return new Response(JSON.stringify({ error: 'failed' }), { status: 500, headers });
    return new Response(JSON.stringify({ dataUrl }), { headers });
  }

  if (!title) return new Response(JSON.stringify({ error: 'title required' }), { status: 400, headers });

  try {
    let imgUrl = null;

    if (source === 'tmdb') {
      imgUrl = await searchTMDB(title, skip);
    } else if (source === 'google') {
      imgUrl = await searchGoogle(title, skip);
    } else {
      // auto: try TMDB first, then Google
      imgUrl = await searchTMDB(title, skip);
      if (!imgUrl) imgUrl = await searchGoogle(title, skip);
    }

    if (!imgUrl) return new Response(JSON.stringify({ found: false }), { headers });

    const dataUrl = await fetchImageAsBase64(imgUrl);
    if (dataUrl) {
      return new Response(JSON.stringify({ found: true, dataUrl, source, imgUrl }), { headers });
    } else {
      return new Response(JSON.stringify({ found: true, imgUrl, source }), { headers });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
