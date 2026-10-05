import { getBackgroundSyncStatus, recordSessionKicked } from './backgroundSync';
import { debugLog } from './debugLog';

/**
 * PC 세션 보호: "다른 곳에서 로그인 중" 판단 시 SSO 재로그인과 자동 동기화를 멈춘다.
 *
 * LMS는 한 계정에 세션 하나만 유지한다. 다른 곳의 로그인으로 끊긴 세션이 처음 요청하면 서버가
 * `alert('다른 PC 에서 로그인 되었습니다.')` 페이지와 새 JSESSIONID를 돌려준다(1회성).
 * 이 응답을 앱(HttpClient)과 백그라운드 워커가 각각 감지해 시각을 기록한다.
 *
 * 끊긴 세션도 getSessionInfo(세션 확인)는 한동안 user_no를 돌려주고, 안내 페이지는 페이지 요청에만 온다(기기 로그 확인).
 *
 * 그 응답을 놓친 경우를 대비해, 방금 전까지(KICK_WINDOW_MS 이내) 유효하던 세션이 무효가 된 경우도 다른 곳 로그인으로 추정한다.
 * 단, 워커가 마지막 정상 이후 "다른 PC" 응답 없이 만료를 봤다면 자연 만료(유휴 만료·서버 재시작 등)이므로 추정하지 않는다.
 * (워커가 15~30분마다 세션을 확인하므로, 이 예외가 없으면 자연 만료 때도 "최근까지 정상"이라 멈춰 버림)
 */
export const KICK_WINDOW_MS = 30 * 60 * 1000;

/** 끊긴 세션의 첫 요청에 서버가 돌려주는 안내 문구 (공백 차이 허용) */
const KICKED_PATTERN = /다른\s*PC\s*에서\s*로그인/;
/**
 * 이 안내 페이지는 EUC-KR이라 앱(UTF-8로 읽음)에서는 한글이 깨진다(기기 로그 확인).
 * 깨져도 남는 ASCII 부분 `alert('… PC …')`로도 판별. 일반 페이지 스크립트와 헷갈리지 않게 짧은 응답(400자 안팎)만 대상.
 * 같은 크기의 "로그인 후 이용하실 수 있습니다" 페이지에는 PC가 없어 구분된다.
 */
const KICKED_ALERT_PATTERN = /alert\(\s*['"][^'"]*PC[^'"]*['"]\s*\)/;
const KICKED_PAGE_MAX_LEN = 2000;

const OK_AT_KEY = 'hs_lms_session_ok_at';
const KICKED_AT_KEY = 'hs_lms_session_kicked_at';
const PAUSED_AT_KEY = 'hs_lms_session_paused_at';

const readNumber = (key: string): number => {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
};

const writeValue = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 저장소 사용 불가 시 이번 실행 동안만 판단이 빗나갈 뿐 동작에는 지장 없음
  }
};

const listeners = new Set<(paused: boolean) => void>();

/** 다른 곳 로그인이 의심되어 재로그인을 하지 않고 동기화를 중단할 때 던지는 오류 */
export class SyncPausedError extends Error {
  constructor() {
    super('다른 곳에서 로그인 중인 것으로 보여 동기화를 멈췄습니다.');
    this.name = 'SyncPausedError';
  }
}

/** 서버가 앱 세션을 유효하다고 응답했을 때 호출 (앱 세션이 살아 있으면 끊긴 상태가 아니므로 멈춤도 해제) */
export function markSessionOk(): void {
  writeValue(OK_AT_KEY, String(Date.now()));
  setPaused(false);
}

export function isKickedResponse(body: unknown): boolean {
  if (typeof body !== 'string') return false;
  if (KICKED_PATTERN.test(body)) return true;
  return body.length <= KICKED_PAGE_MAX_LEN && KICKED_ALERT_PATTERN.test(body);
}

/** 서버가 "다른 PC 에서 로그인" 응답을 보냈을 때 호출 */
export function markKicked(): void {
  writeValue(KICKED_AT_KEY, String(Date.now()));
  recordSessionKicked(); // 워커의 멈춤 알림이 이유를 정확히 안내하도록
  debugLog('guard', '서버 응답: 다른 PC 에서 로그인 되었습니다');
}

export function isSyncPaused(): boolean {
  return readNumber(PAUSED_AT_KEY) > 0;
}

export function onSyncPausedChange(listener: (paused: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setPaused(paused: boolean): void {
  if (paused === isSyncPaused()) return;
  writeValue(PAUSED_AT_KEY, paused ? String(Date.now()) : null);
  listeners.forEach(l => l(paused));
}

export function resumeSync(): void {
  setPaused(false);
}

/** 앱과 백그라운드 워커 기록을 합친 마지막 세션 유효 / 끊김 감지 / (워커가 본) 자연 만료 시각 */
async function getSessionTimes(): Promise<{ okAt: number; kickedAt: number; expiredAt: number }> {
  let worker = { sessionOkAt: 0, sessionKickedAt: 0, sessionExpiredAt: 0 };
  try {
    const st = await getBackgroundSyncStatus();
    worker = {
      sessionOkAt: st?.sessionOkAt || 0,
      sessionKickedAt: st?.sessionKickedAt || 0,
      sessionExpiredAt: st?.sessionExpiredAt || 0,
    };
  } catch {
    // 웹 환경 등 워커 정보가 없으면 앱 기록만 사용
  }
  return {
    okAt: Math.max(readNumber(OK_AT_KEY), worker.sessionOkAt),
    kickedAt: Math.max(readNumber(KICKED_AT_KEY), worker.sessionKickedAt),
    expiredAt: worker.sessionExpiredAt,
  };
}

/**
 * 세션이 무효로 확인됐을 때 다른 곳 로그인으로 볼지 판단 (순수 함수, 테스트 대상)
 * - kicked: 마지막 정상 이후 "다른 PC 에서 로그인" 응답을 받음 → 확정
 * - naturalExpiry: 워커가 마지막 정상 이후 그 응답 없이 만료를 봄 → 자연 만료
 * - 그 외에는 마지막 정상이 KICK_WINDOW_MS 이내면 다른 곳 로그인으로 추정 (응답을 놓친 경우 대비)
 */
export function judgeInvalidSession(t: {
  okAt: number;
  kickedAt: number;
  expiredAt: number;
  paused: boolean;
  now: number;
}): { kicked: boolean; naturalExpiry: boolean; suspected: boolean } {
  const kicked = t.kickedAt > 0 && t.kickedAt >= t.okAt;
  const naturalExpiry = !kicked && t.expiredAt > 0 && t.expiredAt > t.okAt;
  const recentlyOk = t.okAt > 0 && t.now - t.okAt < KICK_WINDOW_MS;
  return { kicked, naturalExpiry, suspected: t.paused || kicked || (!naturalExpiry && recentlyOk) };
}

/**
 * 세션이 무효일 때 SSO 재로그인을 해도 되는지 판단.
 * - interactive(사용자가 직접 새로고침): 다른 곳 로그인이 의심되면 확인 창을 띄움
 * - 자동(앱 시작·복귀·조용한 동기화): 의심되면 재로그인하지 않고 자동 동기화를 멈춤
 */
export async function canRelogin(options: { enabled: boolean; interactive: boolean }): Promise<boolean> {
  if (!options.enabled) {
    resumeSync();
    return true;
  }

  const times = await getSessionTimes();
  const paused = isSyncPaused();
  const { kicked, naturalExpiry, suspected } = judgeInvalidSession({ ...times, paused, now: Date.now() });
  debugLog('guard', '세션 무효 → 재로그인 판단', {
    interactive: options.interactive,
    paused,
    kicked,
    naturalExpiry,
    minutesSinceOk: times.okAt > 0 ? Math.round((Date.now() - times.okAt) / 60000) : null,
    suspected,
  });

  if (!suspected) return true;

  if (options.interactive) {
    const ok = window.confirm(
      'PC 등 다른 곳에서 LMS에 로그인한 것 같아요.\n지금 앱에서 다시 로그인하면 그쪽 LMS가 로그아웃될 수 있어요.\n\n다시 로그인할까요?'
    );
    if (ok) resumeSync();
    return ok;
  }

  setPaused(true);
  return false;
}
