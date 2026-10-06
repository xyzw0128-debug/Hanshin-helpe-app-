import { HttpResponse } from '@capacitor/core';
import { HttpClient } from './httpClient';
import { LmsAuthService } from './lmsAuth';
import { debugLog, networkType } from './debugLog';

export const SSO_CLIENT_ID = '5f0869ab6c0f4178874754fbd6c5bf64';
export const SSO_BASE = 'https://sso2.hs.ac.kr';
export const HSCTIS_BASE = 'https://hsctis.hs.ac.kr';
export const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

export class HsctisAuthError extends Error {
  constructor(message = '종합정보시스템 인증에 실패했습니다.') {
    super(message);
    this.name = 'HsctisAuthError';
  }
}

function extractCookieValue(headers: any, key: string): string {
  if (!headers) return '';
  const setCookie = headers['Set-Cookie'] || headers['set-cookie'] || '';
  const cookies = Array.isArray(setCookie) ? setCookie : [String(setCookie)];
  for (const c of cookies) {
    const match = c.match(new RegExp(`${key}=([^;\\s]+)`));
    if (match) return match[1];
  }
  return '';
}

export class HsctisAuthService {
  private static loggedIn = false;
  private static loggedInUser = '';
  private static studentNo = '';
  private static studentName = '';
  private static currentAccessToken = '';
  private static jsessionId = '';

  public static async logout(): Promise<void> {
    this.loggedIn = false;
    this.loggedInUser = '';
    this.studentNo = '';
    this.studentName = '';
    this.currentAccessToken = '';
    this.jsessionId = '';
    await HttpClient.clearSession();
  }

  private static async getLoginIp(): Promise<string> {
    try {
      const resp = await HttpClient.get({
        url: `${SSO_BASE}/`,
        headers: { 'User-Agent': USER_AGENT },
      });
      const match = String(resp.data).match(/id="loginIp"\s+value="([^"]*)"/);
      return match ? match[1] : '';
    } catch (e) {
      console.warn('Failed to extract loginIp for hsctis', e);
      return '';
    }
  }

  public static async login(userId: string, userPw: string, force = false): Promise<boolean> {
    if (!userId || !userPw) {
      throw new HsctisAuthError('아이디와 비밀번호를 입력해주세요.');
    }

    if (this.loggedIn && this.loggedInUser === userId && !force) {
      return true;
    }

    // 종합정보도 같은 SSO로 로그인하므로, LMS 세션이 이 직후 끊기는지 확인할 수 있게 시점을 기록
    debugLog('auth', `종합정보 SSO 로그인 수행 (force=${force})`, { net: networkType() });
    const clientIp = await this.getLoginIp();

    if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
      throw new HsctisAuthError('보안 난수 생성(Web Crypto API)을 지원하지 않는 환경입니다.');
    }
    const stateNonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), b =>
      b.toString(16).padStart(2, '0')
    ).join('');

    // 1단계: SSO 1단계 인증 코드(code) 발급
    const authParams = new URLSearchParams({
      response_type: 'code',
      client_id: SSO_CLIENT_ID,
      state: stateNonce,
      scope: 'http://sso.hs.ac.kr',
      redirect_uri: 'https://sso.hs.ac.kr/sso/loginSuccess.jsp',
      user_id: userId,
      user_pwd: userPw,
      client_ip: clientIp,
    });

    let authResp: HttpResponse;
    try {
      authResp = await HttpClient.post({
        url: `${SSO_BASE}/oauth2/authoriza.do`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
          Origin: SSO_BASE,
          Referer: `${SSO_BASE}/`,
        },
        data: authParams.toString(),
      });
    } catch (e: any) {
      throw new HsctisAuthError('SSO 포털 서버에 연결할 수 없습니다. 네트워크 연결을 확인해주세요.');
    }

    let authData = authResp.data;
    if (typeof authData === 'string') {
      try {
        authData = JSON.parse(authData);
      } catch {
        throw new HsctisAuthError('SSO 포털 서버 응답을 처리할 수 없습니다.');
      }
    }

    if (authData?.error !== '0000') {
      throw new HsctisAuthError('아이디 또는 비밀번호가 올바르지 않습니다.');
    }

    const code = authData.code;
    if (!code) {
      throw new HsctisAuthError('SSO 인증 코드를 발급받지 못했습니다.');
    }

    // 2단계: 종합정보시스템(hsctis.hs.ac.kr) 대상 access_token 발급
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: SSO_CLIENT_ID,
      code: code,
      scope: 'http://sso.hs.ac.kr',
      client_ip: clientIp,
      redirect_uri: `${HSCTIS_BASE}/`,
    });

    let tokenResp: HttpResponse;
    try {
      tokenResp = await HttpClient.post({
        url: `${SSO_BASE}/oauth2/token2.do`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
          Origin: SSO_BASE,
          Referer: `${SSO_BASE}/`,
        },
        data: tokenParams.toString(),
      });
    } catch (e: any) {
      throw new HsctisAuthError('액세스 토큰 발급 중 네트워크 오류가 발생했습니다.');
    }

    const tokenHtml = typeof tokenResp.data === 'string' ? tokenResp.data : JSON.stringify(tokenResp.data);
    const tokenMatch =
      tokenHtml.match(/name=["']access_token["']\s+value=["']([^"']+)["']/) ||
      tokenHtml.match(/value=["']([^"']+)["']\s+name=["']access_token["']/);
    let accessToken = tokenMatch ? tokenMatch[1] : '';

    if (!accessToken && typeof tokenResp.data === 'object' && tokenResp.data?.access_token) {
      accessToken = tokenResp.data.access_token;
    }

    if (!accessToken) {
      throw new HsctisAuthError('종합정보시스템 access_token 추출에 실패했습니다.');
    }

    // 3단계: 종합정보시스템 세션 쿠키(JSESSIONID, access_token) 확립
    let capturedJsessionId = '';
    try {
      const rootResp = await HttpClient.post({
        url: `${HSCTIS_BASE}/`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
          Referer: `${SSO_BASE}/`,
          Cookie: `access_token=${accessToken}`,
        },
        data: new URLSearchParams({ access_token: accessToken }).toString(),
      });

      const rootJsId = extractCookieValue(rootResp.headers, 'JSESSIONID');
      if (rootJsId) capturedJsessionId = rootJsId;

      // 넥사크로 기본 HTML 진입하여 JSESSIONID 확립
      const nexaResp = await HttpClient.get({
        url: `${HSCTIS_BASE}/app-nexa/index.html`,
        headers: {
          'User-Agent': USER_AGENT,
          Referer: `${HSCTIS_BASE}/`,
          Cookie: [
            `access_token=${accessToken}`,
            capturedJsessionId ? `JSESSIONID=${capturedJsessionId}` : '',
          ].filter(Boolean).join('; '),
        },
      });

      const nexaJsId = extractCookieValue(nexaResp.headers, 'JSESSIONID');
      if (nexaJsId) capturedJsessionId = nexaJsId;
    } catch (e: any) {
      throw new HsctisAuthError('종합정보시스템 세션 쿠키 수립 중 네트워크 오류가 발생했습니다.');
    }

    this.jsessionId = capturedJsessionId;

    // 4단계: 넥사크로 세션 프리체크(selectWnrdntcn) 및 실제 학번(USER_ID) 조회
    const lmsUserNo = LmsAuthService.getUserNo();
    let resolvedStudentNo = lmsUserNo || userId;
    let resolvedStudentName = LmsAuthService.getUserName() || '';
    const RS = '\x1e';

    const hsctisCookies = [
      `access_token=${accessToken}`,
      this.jsessionId ? `JSESSIONID=${this.jsessionId}` : '',
    ].filter(Boolean).join('; ');

    try {
      // 4-1. pre-check (/cs/check/pre)
      const prePayload = `SSV:utf-8${RS}TRANS_INFO=[{"id":"selectWnrdntcn","recvDataset":"gds_preCheck","sqlId":"kr.co.codefarm.svcm.cs.check.selectWnrdntcn","fileOptions":null}]${RS}SYSTEM_MENU_CD=undefined${RS}SYSTEM_LOGGING=Y${RS}SYSTEM_CHECK_SCHE=N${RS}`;
      await HttpClient.post({
        url: `${HSCTIS_BASE}/cs/check/pre`,
        headers: {
          'Content-Type': 'text/xml',
          'User-Agent': USER_AGENT,
          Referer: `${HSCTIS_BASE}/app-nexa/index.html`,
          Cookie: hsctisCookies,
        },
        data: prePayload,
      });

      // 4-2. user info (/cs/init/user)
      const userPayload = `SSV:utf-8${RS}TRANS_INFO=[{"id":"selectUser","recvDataset":"gds_sessionScope","sqlId":"kr.co.codefarm.svcm.cs.init.selectUser","fileOptions":null}]${RS}SYSTEM_MENU_CD=undefined${RS}SYSTEM_LOGGING=N${RS}SYSTEM_CHECK_SCHE=N${RS}`;
      const userResp = await HttpClient.post({
        url: `${HSCTIS_BASE}/cs/init/user`,
        headers: {
          'Content-Type': 'text/xml',
          'User-Agent': USER_AGENT,
          Referer: `${HSCTIS_BASE}/app-nexa/index.html`,
          Cookie: hsctisCookies,
        },
        data: userPayload,
      });

      const userJsId = extractCookieValue(userResp.headers, 'JSESSIONID');
      if (userJsId) this.jsessionId = userJsId;

      const userRaw = typeof userResp.data === 'string' ? userResp.data : JSON.stringify(userResp.data);
      const mUser =
        userRaw.match(/<Col id="USER_ID">([^<]+)<\/Col>/) ||
        userRaw.match(/"USER_ID":"([^"]+)"/) ||
        userRaw.match(/"SYSTEM_CID":"([^"]+)"/) ||
        userRaw.match(/"SYSTEM_ID":"([^"]+)"/);
      const mName =
        userRaw.match(/<Col id="USER_NM">([^<]+)<\/Col>/) ||
        userRaw.match(/"USER_NM":"([^"]+)"/);

      if (mUser && mUser[1]) {
        resolvedStudentNo = mUser[1].trim();
      }
      if (mName && mName[1]) {
        resolvedStudentName = mName[1].trim();
      }
    } catch (e) {
      console.warn('Hsctis pre-check / user init fallback note', e);
    }

    if (!resolvedStudentNo || !/^\d+$/.test(resolvedStudentNo)) {
      if (lmsUserNo && /^\d+$/.test(lmsUserNo)) {
        resolvedStudentNo = lmsUserNo;
      }
    }

    this.loggedIn = true;
    this.loggedInUser = userId;
    this.studentNo = resolvedStudentNo;
    this.studentName = resolvedStudentName;
    this.currentAccessToken = accessToken;
    debugLog('auth', '종합정보 SSO 로그인 완료');
    return true;
  }

  public static isLoggedIn(): boolean {
    return this.loggedIn;
  }

  public static getAccessToken(): string {
    return this.currentAccessToken;
  }

  public static getJsessionId(): string {
    return this.jsessionId;
  }

  public static getLoggedInUser(): string {
    return this.loggedInUser;
  }

  public static getStudentNo(): string {
    if (this.studentNo && /^\d+$/.test(this.studentNo)) {
      return this.studentNo;
    }
    const lmsUser = LmsAuthService.getUserNo();
    if (lmsUser && /^\d+$/.test(lmsUser)) {
      return lmsUser;
    }
    return this.studentNo || this.loggedInUser;
  }

  public static getStudentName(): string {
    return this.studentName || LmsAuthService.getUserName();
  }
}
