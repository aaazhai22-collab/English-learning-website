/** Worker handler shared by the production bundle and the local development server. */
export function createSiteHandler(assets, speechChunks, readingAPI = null) {
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      if (readingAPI) {
        const result = await readingAPI.fetch(request, env);
        if (result) return result;
      }
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      if (url.pathname === '/api/tts') {
        // Only integer identifiers into the bundled public reference catalog are
        // accepted. User text, URLs, search terms, and profile data are never sent.
        if ([...url.searchParams.keys()].some(key => !['entry', 'lang', 'chunk'].includes(key))) return new Response('Invalid parameters', { status: 400 });
        const entry = url.searchParams.get('entry') || '';
        const chunk = url.searchParams.get('chunk') || '0';
        const lang = url.searchParams.get('lang') || 'en-US';
        if (!/^\d+$/.test(entry) || !/^\d+$/.test(chunk) || !['en-US', 'en-GB'].includes(lang)) return new Response('Invalid speech identifier', { status: 400 });
        const text = speechChunks[Number(entry)]?.[Number(chunk)];
        if (!text) return new Response('Public entry not found', { status: 404 });
        const upstreamUrl = new URL('https://translate.google.com/translate_tts');
        upstreamUrl.search = new URLSearchParams({ ie: 'UTF-8', client: 'tw-ob', tl: lang, q: text }).toString();
        try {
          const upstream = await fetch(upstreamUrl, { signal: AbortSignal.timeout(12000) });
          if (!upstream.ok || !upstream.headers.get('content-type')?.startsWith('audio/')) return new Response('Speech service unavailable', { status: 502 });
          const audio = await upstream.arrayBuffer();
          if (!audio.byteLength || audio.byteLength > 2_000_000) return new Response('Invalid speech audio', { status: 502 });
          return new Response(request.method === 'HEAD' ? null : audio, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.byteLength), 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
        } catch {
          return new Response('Speech service unavailable', { status: 502 });
        }
      }
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { return new Response('Invalid path', { status: 400 }); }
      const asset = assets[pathname === '/' ? '/reading.html' : pathname];
      if (!asset) return new Response('Not found', { status: 404 });
      const bytes = Uint8Array.from(atob(asset.body), char => char.charCodeAt(0));
      return new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'Content-Type': asset.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' } });
    },
  };
}
