// Vercel serverless function — fetches poster from Shahid/OSN/WatchIt
export const config = { runtime: 'edge' };

const SOURCES = {
  shahid: async (title) => {
    const q = encodeURIComponent(title);
    const r = await fetch(`https://shahid.mbc.net/ar/search?q=${q}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ar' }
    });
    const html = await r.text();
    // extract og:image or first poster image
    const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);
    if (og) return og[1];
    const img = html.match(/https:\/\/[^"']+shahid[^"']+\.(jpg|jpeg|png|webp)/i);
    if (img) return img[0];
    return null;
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
    if (img) return img[0];
    return null;
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
    if (img) return img[0];
    return null;
  }
};

export default async function handler(req) {
  const url = new URL(req.url);
  const title = url.searchParams.get('title');
  const source = url.searchParams.get('source') || 'shahid';
  const proxyUrl = url.searchParams.get('url'); // proxy mode

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  // proxy mode: fetch image and return as base64
  if (proxyUrl) {
    try {
      const r = await fetch(proxyUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const buf = await r.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const ct = r.headers.get('content-type') || 'image/jpeg';
      return new Response(JSON.stringify({ dataUrl: `data:${ct};base64,${b64}` }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  if (!title) {
    return new Response(JSON.stringify({ error: 'title required' }), { status: 400, headers });
  }

  try {
    const fn = SOURCES[source];
    if (!fn) return new Response(JSON.stringify({ error: 'unknown source' }), { status: 400, headers });

    const imgUrl = await fn(title);
    if (!imgUrl) return new Response(JSON.stringify({ found: false }), { headers });

    // fetch image and convert to base64
    const imgRes = await fetch(imgUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const buf = await imgRes.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
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
