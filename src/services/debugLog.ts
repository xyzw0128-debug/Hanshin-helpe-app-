import { BackgroundSyncPlugin } from './backgroundSync';

/**
 * 로그 수집기
 * - 디버그 빌드: 항상 기록 (네이티브 BackgroundSyncPlugin.getDebugLog가 debuggable 여부를 알려 줌)
 * - 배포(릴리스) 빌드: 기본 꺼짐. 앱 정보 화면의 숨김 메뉴에서 "문제 신고용 로그"를 켰을 때만 기록
 * - 앱 로그는 localStorage 링버퍼에 보관 (앱 재시작 후에도 유지)
 * - 비밀번호/쿠키/토큰/웹훅 주소는 기록 전에 마스킹
 */

const STORAGE_KEY = 'hs_lms_debug_log';
const MAX_LINES = 800;
const MAX_PENDING = 200;
const MAX_SHARE_CHARS = 200_000;

let enabled = false;
let debugBuild = false;
let initialized = false;
let consoleCaptured = false;
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

/** 진단 로그용 지금 네트워크 종류 (WebView가 알려 주는 값: wifi, cellular 등). "다른 PC 로그인" 오탐과 네트워크 전환의 관계 확인용 */
export function networkType(): string {
  try {
    return (navigator as any).connection?.type || '?';
  } catch {
    return '?';
  }
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
    debugBuild = !!res?.debugBuild;
  } catch {
    enabled = false;
    debugBuild = false;
  }
  initialized = true;

  if (enabled) {
    const buffered = pending;
    pending = [];
    if (buffered.length > 0) writeLines([...readLines(), ...buffered]);
    captureConsole();
    debugLog('app', debugBuild ? '디버그 로그 활성화' : '문제 신고용 로그 기록 중', { userAgent: navigator.userAgent });
  } else {
    pending = [];
  }
  return enabled;
}

/** console.warn/error도 로그에 남김 (한 번만 설치, 기록 여부는 append가 enabled로 판단) */
function captureConsole(): void {
  if (consoleCaptured) return;
  consoleCaptured = true;
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      append(redactSensitive(`${timestamp()} [console.${level}] ${args.map(stringify).join(' ')}`));
    };
  }
}

/** 지금 로그를 기록하는지 (디버그 빌드이거나 문제 신고용 로그를 켠 경우) */
export function isDebugLogEnabled(): boolean {
  return enabled;
}

/** 디버그 빌드인지. 개발용 기능(1분 주기 등) 노출과 배포 앱 전용 정리(buildPolicy)의 기준 */
export function isDebugBuild(): boolean {
  return debugBuild;
}

/** 배포 앱의 "문제 신고용 로그" 켜기/끄기 (앱과 백그라운드 워커 모두) */
export async function setReportLogEnabled(on: boolean): Promise<boolean> {
  if (debugBuild) return true;
  try {
    const res = await BackgroundSyncPlugin.setReportLog({ enabled: on });
    enabled = !!res?.enabled;
  } catch {
    enabled = on;
  }
  if (enabled) {
    captureConsole();
    debugLog('app', '문제 신고용 로그 켜짐', { userAgent: navigator.userAgent });
  }
  return enabled;
}

/**
 * 네이티브(워커/플러그인) 로그 + 앱 로그를 하나의 텍스트로 합침
 */
const tail = (text: string, max: number) => (text.length > max ? '(앞부분 생략)\n' + text.slice(-max) : text);

export async function getCombinedDebugLog(maxCharsPerSection = Infinity): Promise<string> {
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
    tail(nativeLog.trim(), maxCharsPerSection) || '(기록 없음)',
    '',
    '--- 앱 (동기화 / 인증 / 오류) ---',
    tail(appLines.join('\n'), maxCharsPerSection) || '(기록 없음)',
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
  // 섹션별로 뒷부분을 남겨 네이티브(백그라운드) 로그가 앱 로그에 밀려 통째로 잘리지 않게 함
  const text = await getCombinedDebugLog(MAX_SHARE_CHARS / 2);
  try {
    await BackgroundSyncPlugin.shareText({ text, title: '한신대 LMS 디버그 로그' });
    return 'shared';
  } catch {
    await navigator.clipboard.writeText(text);
    return 'copied';
  }
}
