import { BackgroundSyncPlugin } from './backgroundSync';

/**
 * 디버그 빌드 전용 로그 수집기
 * - 네이티브(BackgroundSyncPlugin.getDebugLog)가 debuggable 빌드인지 알려주면 활성화
 * - 앱 로그는 localStorage 링버퍼에 보관 (앱 재시작 후에도 유지)
 * - 비밀번호/쿠키/토큰/웹훅 주소는 기록 전에 마스킹
 * 릴리스 빌드에서는 아무것도 기록하지 않는다.
 */

const STORAGE_KEY = 'hs_lms_debug_log';
const MAX_LINES = 800;
const MAX_PENDING = 200;
const MAX_SHARE_CHARS = 200_000;

let enabled = false;
let initialized = false;
let pending: string[] = [];

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function redactSensitive(text: string): string {
  return text
    .replace(/(JSESSIONID|access_token|sso_token|SCOUTER|user_pwd|userPw|password)(["']?\s*[:=]\s*["']?)[^\s;&"',}]+/gi, '$1$2***')
    .replace(/https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/[^\s"']+/gi, 'https://discord.com/api/webhooks/***')
    .replace(/(name="access_token"\s+value=")[^"]+/gi, '$1***');
}

function stringify(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readLines(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeLines(lines: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines.slice(-MAX_LINES)));
  } catch {
    // 저장 공간 부족 등은 무시
  }
}

function append(line: string): void {
  if (!initialized) {
    pending.push(line);
    if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING);
    return;
  }
  if (!enabled) return;
  const lines = readLines();
  lines.push(line);
  writeLines(lines);
}

/**
 * 디버그 이벤트 기록 (예: debugLog('sync', '동기화 시작', { silent: true }))
 */
export function debugLog(source: string, message: string, data?: unknown): void {
  const detail = data === undefined ? '' : ` ${stringify(data)}`;
  append(redactSensitive(`${timestamp()} [${source}] ${message}${detail}`));
}

/**
 * 앱 시작 시 1회 호출: 디버그 빌드 여부 확인 후 console.warn/error 수집 시작
 */
export async function initDebugLog(): Promise<boolean> {
  if (initialized) return enabled;
  try {
    const res = await BackgroundSyncPlugin.getDebugLog();
    enabled = !!res?.enabled;
  } catch {
    enabled = false;
  }
  initialized = true;

  if (enabled) {
    const buffered = pending;
    pending = [];
    if (buffered.length > 0) writeLines([...readLines(), ...buffered]);

    for (const level of ['warn', 'error'] as const) {
      const original = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        original(...args);
        append(redactSensitive(`${timestamp()} [console.${level}] ${args.map(stringify).join(' ')}`));
      };
    }
    debugLog('app', '디버그 로그 활성화', { userAgent: navigator.userAgent });
  } else {
    pending = [];
  }
  return enabled;
}

export function isDebugLogEnabled(): boolean {
  return enabled;
}

/**
 * 네이티브(워커/플러그인) 로그 + 앱 로그를 하나의 텍스트로 합침
 */
export async function getCombinedDebugLog(): Promise<string> {
  let nativeLog = '';
  try {
    nativeLog = (await BackgroundSyncPlugin.getDebugLog())?.log || '';
  } catch (e) {
    nativeLog = `(native log unavailable: ${stringify(e)})`;
  }
  const appLines = readLines();
  return [
    `=== 한신대 LMS 디버그 로그 (${new Date().toISOString()}) ===`,
    '',
    '--- 네이티브 (백그라운드 워커 / 세션) ---',
    nativeLog.trim() || '(기록 없음)',
    '',
    '--- 앱 (동기화 / 인증 / 오류) ---',
    appLines.join('\n') || '(기록 없음)',
  ].join('\n');
}

export async function clearDebugLogs(): Promise<void> {
  writeLines([]);
  try {
    await BackgroundSyncPlugin.clearDebugLog();
  } catch {
    // 웹 환경 등
  }
}

/**
 * 안드로이드 공유 시트로 로그 전송 (공유 불가 시 클립보드 복사)
 */
export async function shareDebugLog(): Promise<'shared' | 'copied'> {
  let text = await getCombinedDebugLog();
  if (text.length > MAX_SHARE_CHARS) {
    text = '(앞부분 생략)\n' + text.slice(-MAX_SHARE_CHARS);
  }
  try {
    await BackgroundSyncPlugin.shareText({ text, title: '한신대 LMS 디버그 로그' });
    return 'shared';
  } catch {
    await navigator.clipboard.writeText(text);
    return 'copied';
  }
}
