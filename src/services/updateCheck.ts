import { Capacitor, CapacitorHttp } from '@capacitor/core';
import pkg from '../../package.json';

/**
 * 새 버전 확인. 앱은 Play 스토어가 아니라 GitHub Releases로 배포하므로 자동 업데이트가 없다.
 * 하루 두 번 정도 GitHub의 최신 릴리스 버전만 확인한다 (보내는 정보 없음, 응답에서 버전과 주소만 읽음).
 */

export const GITHUB_REPO = 'xyzw0128-debug/Hanshin-helpe-app-';
export const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`;
export const ISSUES_PAGE = `https://github.com/${GITHUB_REPO}/issues`;
const LATEST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

const CACHE_KEY = 'hs_update_check';
const DISMISSED_KEY = 'hs_update_dismissed';
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

export const CURRENT_VERSION: string = pkg.version;

export interface UpdateInfo {
  version: string;
  url: string;
}

/** "v1.10.0" vs "1.2.0" 같은 버전 비교 (a가 크면 양수) */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    (v || '')
      .trim()
      .replace(/^v/i, '')
      .split(/[.-]/)
      .map(x => parseInt(x, 10))
      .map(n => (isNaN(n) ? 0 : n));
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function readCache(): { checkedAt: number; latest: UpdateInfo | null } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(latest: UpdateInfo | null) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ checkedAt: Date.now(), latest }));
  } catch {}
}

async function fetchLatestRelease(): Promise<UpdateInfo | null> {
  const headers = { Accept: 'application/vnd.github+json' };
  let data: any;
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({ url: LATEST_API, headers, connectTimeout: 8000, readTimeout: 8000 });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } else {
    const res = await fetch(LATEST_API, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  }
  if (!data?.tag_name || data.draft || data.prerelease) return null;
  return { version: String(data.tag_name).replace(/^v/i, ''), url: data.html_url || RELEASES_PAGE };
}

/**
 * 지금 버전보다 새 버전이 있으면 반환. force가 아니면 12시간 안에 확인한 결과를 재사용.
 * 네트워크 오류는 조용히 null (force면 오류를 던짐)
 */
export async function checkForUpdate(options: { force?: boolean } = {}): Promise<UpdateInfo | null> {
  let latest: UpdateInfo | null;
  const cache = readCache();
  if (!options.force && cache && Date.now() - cache.checkedAt < CHECK_INTERVAL_MS) {
    latest = cache.latest;
  } else {
    try {
      latest = await fetchLatestRelease();
      writeCache(latest);
    } catch (e) {
      if (options.force) throw e;
      return null;
    }
  }
  return latest && compareVersions(latest.version, CURRENT_VERSION) > 0 ? latest : null;
}

/** 홈의 업데이트 안내를 이 버전에 대해서는 다시 띄우지 않음 */
export function dismissUpdate(version: string) {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {}
}

export function isUpdateDismissed(version: string): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === version;
  } catch {
    return false;
  }
}
