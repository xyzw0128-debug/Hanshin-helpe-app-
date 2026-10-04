import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function lmsDevProxyPlugin(): Plugin {
  // 도메인/호스트별 쿠키 격리 저장: host -> { cookieName: cookieValue }
  let cookieStore: Record<string, Record<string, string>> = {};

  function saveCookies(targetUrl: URL, headers: Headers) {
    const raw = (headers as any).getSetCookie ? (headers as any).getSetCookie() : [headers.get('set-cookie') || ''];
    raw.forEach((header: string) => {
      if (!header) return;
      // Set-Cookie 형식: <name>=<value>; <attr1>=<val1>; <attr2>...
      // 첫 번째 세미콜론 이전만 쿠키 이름과 값
      const [cookiePair, ...attrParts] = header.split(';');
      const eqIdx = cookiePair.indexOf('=');
      if (eqIdx <= 0) return;
      const k = cookiePair.substring(0, eqIdx).trim();
      const v = cookiePair.substring(eqIdx + 1).trim();

      // Domain 속성 확인 (없으면 요청한 targetUrl.hostname 사용)
      let domain = targetUrl.hostname;
      for (const attr of attrParts) {
        const trimmed = attr.trim();
        const aEq = trimmed.indexOf('=');
        if (aEq > 0) {
          const aKey = trimmed.substring(0, aEq).trim().toLowerCase();
          if (aKey === 'domain') {
            const aVal = trimmed.substring(aEq + 1).trim().replace(/^\./, '');
            if (aVal) domain = aVal;
          }
        }
      }

      if (!cookieStore[domain]) {
        cookieStore[domain] = {};
      }
      cookieStore[domain][k] = v;
    });
  }

  function getCookieHeader(targetUrl: URL) {
    const host = targetUrl.hostname;
    const applicable: Record<string, string> = {};

    // 1. 해당 호스트 및 상위 도메인 쿠키 병합
    for (const [domain, cMap] of Object.entries(cookieStore)) {
      if (host === domain || host.endsWith('.' + domain)) {
        Object.assign(applicable, cMap);
      }
    }

    return Object.entries(applicable)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  return {
    name: 'lms-dev-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/api/proxy' || req.method !== 'POST') {
          return next();
        }

        let body = '';
        req.on('data', chunk => {
          body += chunk;
        });

        req.on('end', async () => {
          try {
            const parsed = JSON.parse(body);
            if (parsed.action === 'clear') {
              cookieStore = {};
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true }));
              return;
            }

            const { url, method, headers = {}, data } = parsed;

            // SSRF & Open Proxy 방어: 허용된 한신대학교 공식 도메인 및 HTTPS 프로토콜만 프록시 허용
            const targetUrl = new URL(url);
            const ALLOWED_HOSTS = ['sso2.hs.ac.kr', 'lms.hs.ac.kr', 'sso.hs.ac.kr', 'hsctis.hs.ac.kr'];
            if (!ALLOWED_HOSTS.includes(targetUrl.hostname) || targetUrl.protocol !== 'https:') {
              res.statusCode = 403;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'SSRF 방어: 허용되지 않은 도메인 접근입니다.' }));
              return;
            }

            // Start of a brand new SSO login flow -> clear only SSO cookies
            if (url === 'https://sso2.hs.ac.kr/' || url === 'https://sso2.hs.ac.kr') {
              delete cookieStore['sso2.hs.ac.kr'];
            }

            const reqHeaders: Record<string, string> = {
              ...headers,
              'User-Agent':
                'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            };

            const callerCookie = headers['Cookie'] || headers['cookie'] || '';
            const storeCookie = getCookieHeader(targetUrl);
            const mergedCookies: Record<string, string> = {};

            if (storeCookie) {
              for (const part of storeCookie.split(';')) {
                const eqIdx = part.indexOf('=');
                if (eqIdx > 0) {
                  mergedCookies[part.substring(0, eqIdx).trim()] = part.substring(eqIdx + 1).trim();
                }
              }
            }

            if (callerCookie) {
              for (const part of callerCookie.split(';')) {
                const eqIdx = part.indexOf('=');
                if (eqIdx > 0) {
                  mergedCookies[part.substring(0, eqIdx).trim()] = part.substring(eqIdx + 1).trim();
                }
              }
            }

            const finalCookie = Object.entries(mergedCookies)
              .map(([k, v]) => `${k}=${v}`)
              .join('; ');
            if (finalCookie) {
              reqHeaders['Cookie'] = finalCookie;
            }

            const fetchOpts: RequestInit = {
              method: method || 'GET',
              headers: reqHeaders,
            };

            if (data && method !== 'GET') {
              fetchOpts.body = typeof data === 'string' ? data : JSON.stringify(data);
            }

            const upstreamRes = await fetch(url, fetchOpts);
            saveCookies(targetUrl, upstreamRes.headers);

            const contentType = upstreamRes.headers.get('content-type') || '';
            const text = await upstreamRes.text();
            let parsedData: any = text;
            if (contentType.includes('application/json')) {
              try {
                parsedData = JSON.parse(text);
              } catch {}
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                status: upstreamRes.status,
                data: parsedData,
                headers: Object.fromEntries(upstreamRes.headers.entries()),
              })
            );
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message || 'Internal proxy error' }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), lmsDevProxyPlugin()],
  server: {
    port: 3000,
  },
});
