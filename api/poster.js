export const config = { runtime: 'edge' };

const TMDB_KEY = 'efef2b916f7e7c557a2528095210d8a6';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

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

// Extract best image URL from HTML
function extractImageFromHtml(html, domain) {
  // try JSON-LD structured data first
  const jsonLd = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (jsonLd) {
    for (const block of jsonLd) {
      try {
        const json = JSON.parse(block.replace(/<[^>]+>/g, ''));
        const img = json.image || json.thumbnail || json.thumbnailUrl;
        if (img && typeof img === 'string' && img.startsWith('http')) return img;
        if (img && img.url) return img.url;
      } catch(e) {}
    }
  }
  // try og:image
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (og && og[1].startsWith('http')) return og[1];
  // try twitter:image
  const tw = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  if (tw && tw[1].startsWith('http')) return tw[1];
  // try any large image from domain
  const imgs = [...html.matchAll(/https?:\/\/[^"'\s]+\.(jpg|jpeg|png|webp)/gi)];
  for (const m of imgs) {
    if (m[0].includes('poster') || m[0].includes('cover') || m[0].includes('thumb')) return m[0];
  }
  return null;
}

const SOURCES = {
  shahid: async (title) => {
    const q = encodeURIComponent(title);
    // Try Shahid search API endpoint
    const searchUrls = [
      `https://shahid.mbc.net/ar/search?q=${q}`,
      `https://shahid.mbc.net/api/v2/search?q=${q}&type=movie,series`,
    ];
    for (const url of searchUrls) {
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Language': 'ar,en' }
        });
        const text = await r.text();
        // try JSON response
        try {
          const json = JSON.parse(text);
          const items = json.data?.items || json.results || json.items || [];
          for (const item of items) {
            const img = item.image || item.poster || item.thumbnail || item.coverImage;
            if (img && typeof img === 'string') return img;
            if (img && img.url) return img.url;
          }
        } catch(e) {}
        const img = extractImageFromHtml(text, 'shahid');
        if (img) return img;
      } catch(e) {}
    }
    return null;
  },

  osn: async (title) => {
    const q = encodeURIComponent(title);
    const urls = [
      `https://www.osn.com/en/search?q=${q}`,
      `https://api.osn.com/api/search?q=${q}`,
    ];
    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,application/json' } });
        const text = await r.text();
        try {
          const json = JSON.parse(text);
          const items = json.data || json.results || json.items || [];
          for (const item of (Array.isArray(items) ? items : [])) {
            const img = item.image || item.poster || item.thumbnail;
            if (img && typeof img === 'string') return img;
          }
        } catch(e) {}
        const img = extractImageFromHtml(text, 'osn');
        if (img) return img;
      } catch(e) {}
    }
    return null;
  },

  watchit: async (title) => {
    const q = encodeURIComponent(title);
    const urls = [
      `https://watchit.ae/search?query=${q}`,
      `https://www.watchit.ae/api/search?q=${q}`,
    ];
    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const text = await r.text();
        try {
          const json = JSON.parse(text);
          const items = json.data || json.results || [];
          for (const item of (Array.isArray(items) ? items : [])) {
            const img = item.image || item.poster || item.thumbnail;
            if (img && typeof img === 'string') return img;
          }
        } catch(e) {}
        const img = extractImageFromHtml(text, 'watchit');
        if (img) return img;
      } catch(e) {}
    }
    return null;
  },

  rotana: async (title) => {
    const q = encodeURIComponent(title);
    const urls = [
      `https://rotana.net/search?q=${q}`,
      `https://www.rotana.net/search/${q}`,
    ];
    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ar' } });
        const text = await r.text();
        const img = extractImageFromHtml(text, 'rotana');
        if (img) return img;
      } catch(e) {}
    }
    return null;
  },

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
