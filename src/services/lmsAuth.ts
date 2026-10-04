import { HttpResponse } from '@capacitor/core';
import { HttpClient } from './httpClient';
import { debugLog } from './debugLog';

export const SSO_CLIENT_ID = '5f0869ab6c0f4178874754fbd6c5bf64';
export const SSO_BASE = 'https://sso2.hs.ac.kr';
export const LMS_BASE = 'https://lms.hs.ac.kr';
export const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

export class LmsAuthCredentialsError extends Error {
  constructor(message = '아이디 또는 비밀번호가 올바르지 않습니다. 계정 잠김 방지를 위해 자동 동기화를 일시 정지합니다.') {
    super(message);
    this.name = 'LmsAuthCredentialsError';
  }
}

export class LmsAuthService {
  private static loggedIn = false;
  private static loggedInUser = '';
  private static userNo = '';
  private static userName = '';
  private static deptName = '';
  private static cachedMainViewHtml = '';

  public static async logout(): Promise<void> {
    this.loggedIn = false;
    this.loggedInUser = '';
    this.userNo = '';
    this.userName = '';
    this.deptName = '';
    this.cachedMainViewHtml = '';
    await HttpClient.clearSession();
  }

  private static async getLoginIp(): Promise<string> {
    try {
      const resp = await HttpClient.get({
        url: `${SSO_BASE}/`,
        headers: { 'User-Agent': USER_AGENT },
      });
      const match = resp.data.match(/id="loginIp"\s+value="([^"]*)"/);
      return match ? match[1] : '';
    } catch (e) {
      console.warn('Failed to extract loginIp', e);
      return '';
    }
  }

  public static async isSessionValid(): Promise<boolean> {
    try {
      const sessionResp = await HttpClient.post({
        url: `${LMS_BASE}/lms/common/select/getSessionInfo.dunet`,
        headers: {
          'User-Agent': USER_AGENT,
          Referer: `${LMS_BASE}/main/MainView.dunet`,
        },
      });
      let sData = sessionResp.data;
      if (typeof sData === 'string') {
        try {
          sData = JSON.parse(sData);
        } catch {
          this.loggedIn = false;
          return false;
        }
      }
      if (sData?.data?.user_no && String(sData.data.user_no).trim().length > 0) {
        this.loggedIn = true;
        this.userNo = String(sData.data.user_no).trim();
        if (sData?.data?.user_name) {
          this.userName = String(sData.data.user_name).trim();
        }
        if (sData?.data?.dept_nm) {
          this.deptName = String(sData.data.dept_nm).trim();
        }
        return true;
      }
      this.loggedIn = false;
      return false;
    } catch {
      this.loggedIn = false;
      return false;
    }
  }

  public static invalidateSession(): void {
    this.loggedIn = false;
  }

  public static async login(userId: string, userPw: string, force = false): Promise<boolean> {
    if (!userId || !userPw) {
      throw new Error('아이디와 비밀번호를 입력해주세요.');
    }

    if (!force) {
      // 세션 쿠키가 이미 유효한 경우 불필요한 SSO 재로그인을 방지하여 PC 세션 보호
      const valid = await this.isSessionValid();
      if (valid && (!this.loggedInUser || this.loggedInUser === userId)) {
        this.loggedIn = true;
        this.loggedInUser = userId;
        debugLog('auth', '기존 LMS 세션 재사용 (SSO 로그인 생략)');
        return true;
      }
    }

    // SSO 로그인은 PC의 LMS 세션을 끊을 수 있으므로 호출 시점을 기록
    debugLog('auth', `SSO 로그인 수행 (force=${force})`);

    const clientIp = await this.getLoginIp();

    // SEC-05: 하드코딩된 정적 state('123456789') 대신 암호학적으로 안전한 무작위 난수 사용
    if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
      throw new Error('이 기기는 보안 난수 생성(Web Crypto API)을 지원하지 않습니다. 앱을 업데이트해주세요.');
    }
    const stateNonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

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

    // 1단계: 인증 코드(code) 발급
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
      throw new Error('LMS 서버에 연결할 수 없습니다. 인터넷 네트워크 연결을 확인해주세요.');
    }

    let authData = authResp.data;
    if (typeof authData === 'string') {
      try {
        authData = JSON.parse(authData);
      } catch {
        throw new Error('포털 서버 응답을 처리할 수 없습니다. 잠시 후 다시 시도해주세요.');
      }
    }

    if (authData?.error !== '0000') {
      debugLog('auth', 'SSO 인증 실패 (아이디/비밀번호 오류)', { error: authData?.error });
      throw new LmsAuthCredentialsError();
    }

    const code = authData.code;
    if (!code) {
      throw new Error('SSO 인증 코드를 발급받지 못했습니다.');
    }

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: SSO_CLIENT_ID,
      code: code,
      scope: 'http://sso.hs.ac.kr',
      client_ip: clientIp,
      redirect_uri: `${LMS_BASE}/main/MainView.dunet`,
    });

    // 2단계: 액세스 토큰(access_token) 발급
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
      throw new Error('액세스 토큰 발급 중 네트워크 오류가 발생했습니다.');
    }

    const tokenHtml = typeof tokenResp.data === 'string' ? tokenResp.data : JSON.stringify(tokenResp.data);
    const tokenMatch = tokenHtml.match(/name="access_token"\s+value="([^"]+)"/);
    if (!tokenMatch) {
      throw new Error('access_token 추출 실패');
    }
    const accessToken = tokenMatch[1];

    // 3단계: LMS 세션(JSESSIONID) 생성 및 메인 뷰 HTML 캐시
    try {
      const mainResp = await HttpClient.post({
        url: `${LMS_BASE}/main/MainView.dunet`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        data: new URLSearchParams({ access_token: accessToken }).toString(),
      });
      let htmlText = typeof mainResp.data === 'string' ? mainResp.data : JSON.stringify(mainResp.data);
      // 만약 302 리디렉션 응답이거나 메인 뷰 공지 본문(.learn_pds)이 없는 경우 실제 메인 페이지를 GET 요청으로 재확보
      if (!htmlText.includes('learn_pds') && !htmlText.includes('myCourseList')) {
        try {
          const getResp = await HttpClient.get({
            url: `${LMS_BASE}/main/MainView.dunet`,
            headers: {
              'User-Agent': USER_AGENT,
            },
          });
          const getHtml = typeof getResp.data === 'string' ? getResp.data : '';
          if (getHtml) {
            htmlText = getHtml;
          }
        } catch {
          // fallback ignore
        }
      }
      if (htmlText) {
        this.cachedMainViewHtml = htmlText;
      }
    } catch (e: any) {
      throw new Error('LMS 세션 연결 중 네트워크 오류가 발생했습니다.');
    }

    // 4단계: LMS 세션 정보(/lms/common/select/getSessionInfo.dunet)에서 실제 학번(user_no) 추출
    try {
      const sessionResp = await HttpClient.post({
        url: `${LMS_BASE}/lms/common/select/getSessionInfo.dunet`,
        headers: {
          'User-Agent': USER_AGENT,
          Referer: `${LMS_BASE}/main/MainView.dunet`,
        },
      });
      let sData = sessionResp.data;
      if (typeof sData === 'string') {
        try {
          sData = JSON.parse(sData);
        } catch {}
      }
      if (sData?.data?.user_no) {
        this.userNo = String(sData.data.user_no).trim();
      }
      if (sData?.data?.user_name) {
        this.userName = String(sData.data.user_name).trim();
      }
      if (sData?.data?.dept_nm) {
        this.deptName = String(sData.data.dept_nm).trim();
      }
    } catch (e) {
      console.warn('LMS getSessionInfo execution note', e);
    }

    this.loggedIn = true;
    this.loggedInUser = userId;
    debugLog('auth', 'SSO 로그인 완료', { hasUserNo: !!this.userNo });
    return true;
  }

  public static isLoggedIn(): boolean {
    return this.loggedIn;
  }

  public static getUserNo(): string {
    return this.userNo;
  }

  public static getUserName(): string {
    return this.userName;
  }

  public static getDeptName(): string {
    return this.deptName;
  }

  public static getCachedMainViewHtml(): string {
    return this.cachedMainViewHtml;
  }
}
