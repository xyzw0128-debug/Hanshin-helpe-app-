import { Capacitor, CapacitorHttp, CapacitorCookies, HttpOptions, HttpResponse } from '@capacitor/core';

export class HttpClient {
  public static async get(options: HttpOptions): Promise<HttpResponse> {
    if (Capacitor.isNativePlatform()) {
      return CapacitorHttp.get(options);
    }
    return this.webRequest('GET', options);
  }

  public static async post(options: HttpOptions): Promise<HttpResponse> {
    if (Capacitor.isNativePlatform()) {
      return CapacitorHttp.post(options);
    }
    return this.webRequest('POST', options);
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
