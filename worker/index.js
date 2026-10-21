/** Worker handler shared by the production bundle and the local development server. */
export function createSiteHandler(assets, speechChunks, readingAPI = null, remoteAssets = {}) {
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
      // Only these build-time pinned public OCR files can use remote delivery.
      // Images and request headers are never forwarded to an upstream service.
      const remote = Object.hasOwn(remoteAssets, pathname) ? remoteAssets[pathname] : null;
      if (remote) {
        const unavailable = () => new Response('OCR resource temporarily unavailable. Please retry.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '5', 'X-Content-Type-Options': 'nosniff' },
        });
        try {
          const upstreamURL = new URL(remote.url);
          if (upstreamURL.protocol !== 'https:' || upstreamURL.username || upstreamURL.password || !/^[a-f0-9]{64}$/.test(remote.sha256) || !Number.isSafeInteger(remote.size) || remote.size <= 0 || remote.size > 8 * 1024 * 1024) return unavailable();
          const cacheKey = new Request(`${url.origin}${pathname}?sha256=${remote.sha256}`);
          const cache = globalThis.caches?.default;
          let cached;
          try { cached = await cache?.match(cacheKey); } catch { /* Caching is optional. */ }
          if (cached && cached.headers.get('ETag') === `"${remote.sha256}"`) {
            return request.method === 'HEAD' ? new Response(null, { status: 200, headers: cached.headers }) : cached;
          }
          const upstream = await fetch(upstreamURL.href, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000) });
          if (!upstream.ok || !upstream.body || Number(upstream.headers.get('Content-Length')) > 8 * 1024 * 1024) return unavailable();
          const reader = upstream.body.getReader();
          const chunks = [];
          let length = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > remote.size || length > 8 * 1024 * 1024) { await reader.cancel(); return unavailable(); }
            chunks.push(value);
          }
          if (length !== remote.size) return unavailable();
          const bytes = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
          if (hash !== remote.sha256) return unavailable();
          const response = new Response(bytes, { headers: {
            'Content-Type': remote.type,
            'Content-Length': String(length),
            'Cache-Control': 'public, max-age=31536000, immutable',
            'ETag': `"${remote.sha256}"`,
            'X-Content-Type-Options': 'nosniff',
          } });
          try { await cache?.put(cacheKey, response.clone()); } catch { /* A valid response remains usable without a cache. */ }
          return request.method === 'HEAD' ? new Response(null, { status: 200, headers: response.headers }) : response;
        } catch { return unavailable(); }
      }
      const asset = assets[pathname === '/' ? '/reading.html' : pathname];
      if (!asset) return new Response('Not found', { status: 404 });
      const bytes = Uint8Array.from(atob(asset.body), char => char.charCodeAt(0));
      return new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'Content-Type': asset.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' } });
    },
  };
}
