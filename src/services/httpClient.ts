import { Capacitor, CapacitorHttp, CapacitorCookies, HttpOptions, HttpResponse } from '@capacitor/core';
import { isKickedResponse, markKicked } from './sessionGuard';

export class HttpClient {
  public static async get(options: HttpOptions): Promise<HttpResponse> {
    const resp = Capacitor.isNativePlatform() ? await CapacitorHttp.get(options) : await this.webRequest('GET', options);
    return this.inspect(options, resp);
  }

  public static async post(options: HttpOptions): Promise<HttpResponse> {
    const resp = Capacitor.isNativePlatform() ? await CapacitorHttp.post(options) : await this.webRequest('POST', options);
    return this.inspect(options, resp);
  }

  /** 다른 곳 로그인으로 끊긴 LMS 세션의 1회성 안내 응답은 어느 요청에서 받든 기록 */
  private static inspect(options: HttpOptions, resp: HttpResponse): HttpResponse {
    if (options.url.includes('lms.hs.ac.kr') && isKickedResponse(resp?.data)) {
      markKicked(options.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]);
    }
    return resp;
  }

  public static async clearSession(): Promise<void> {
    // 1. CWE-613: 네이티브 안드로이드/iOS WebView 및 CookieManager의 세션 쿠키(JSESSIONID) 완전 파기
    try {
      await CapacitorCookies.clearAllCookies();
    } catch (e) {
      console.warn('Failed to clear native cookies via CapacitorCookies', e);
    }

    // 2. 웹 개발 프록시 쿠키 캐시 파기
    if (!Capacitor.isNativePlatform()) {
      try {
        await fetch('/api/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'clear' }),
        });
      } catch (e) {
        console.warn('Failed to clear proxy session', e);
      }
    }
  }

  private static async webRequest(method: string, options: HttpOptions): Promise<HttpResponse> {
    let finalUrl = options.url;
    if (options.params) {
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(options.params)) {
        if (v !== undefined && v !== null) searchParams.append(k, String(v));
      }
      const qs = searchParams.toString();
      if (qs) {
        finalUrl += (finalUrl.includes('?') ? '&' : '?') + qs;
      }
    }

    if (finalUrl.includes('hs.ac.kr')) {
      const proxyResp = await fetch('/api/proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: finalUrl,
          method,
          headers: options.headers || {},
          data: options.data,
        }),
      });

      const resJson = await proxyResp.json();
      if (!proxyResp.ok || resJson.error) {
        throw new Error(resJson.error || '네트워크 프록시 요청에 실패했습니다.');
      }
      return {
        data: resJson.data,
        status: resJson.status,
        headers: resJson.headers || {},
        url: finalUrl,
      };
    }

    return method === 'POST' ? CapacitorHttp.post(options) : CapacitorHttp.get(options);
  }
}
