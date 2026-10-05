import { Capacitor, registerPlugin } from '@capacitor/core';
import { debugLog, isDebugLogEnabled } from '../services/debugLog';

interface NativeAppLauncherPlugin {
  launchApp(options: { packageName: string; fallbackPackages?: string[] }): Promise<{ status: string; package?: string }>;
}

const NativeAppLauncher = registerPlugin<NativeAppLauncherPlugin>('NativeAppLauncher');

// === 성능 로깅 인프라 ===
export interface LaunchLog {
  timestamp: string;
  appId: string;
  stage: 'start' | 'native_attempt' | 'native_success' | 'native_fail' | 'fallback_intent' | 'fallback_store' | 'complete' | 'blocked_duplicate';
  durationMs: number;
  detail?: string;
}

const launchLogs: LaunchLog[] = [];
let isLaunching = false;

function addLog(appId: string, stage: LaunchLog['stage'], startTime: number, detail?: string) {
  // 로그를 기록하지 않는 상태(배포 앱 기본값)에서는 메모리에도 쌓지 않음
  if (!isDebugLogEnabled()) return;
  launchLogs.push({
    timestamp: new Date().toISOString(),
    appId,
    stage,
    durationMs: Math.round(performance.now() - startTime),
    detail,
  });
  if (stage !== 'start' && stage !== 'complete') {
    debugLog('quickhub', `${appId} ${stage} (${Math.round(performance.now() - startTime)}ms)`, detail);
  }
}

/** 캠퍼스 퀵허브 성능 로그 내보내기 */
export function getLaunchLogs(): LaunchLog[] {
  return [...launchLogs];
}

/** 로그 초기화 */
export function clearLaunchLogs(): void {
  launchLogs.length = 0;
}

export interface CampusAppInfo {
  id: 'attendance' | 'sugang' | 'library' | string;
  name: string;
  shortName: string;
  packageName: string;
  fallbackPackages?: string[];
  description: string;
  badgeText: string;
  actionText: string;
  storeUrl: string;
}

export const CAMPUS_APPS: Record<string, CampusAppInfo> = {
  attendance: {
    id: 'attendance',
    name: '한신대 전자출결 (U-Check+)',
    shortName: '대면 전자출결',
    packageName: 'kr.ac.hanshin.attendance',
    fallbackPackages: ['kr.ac.hanshin.ucheck', 'kr.ac.hs.ucheck', 'com.libeka.attendance.ucheckplusstud_hanshin', 'com.icerti.certuniv.hanshin'],
    description: '강의실 블루투스/비콘 현장 출석체크',
    badgeText: '현장 출결 필수',
    actionText: '대면 전자출결 실행',
    storeUrl: 'https://play.google.com/store/apps/details?id=kr.ac.hanshin.attendance',
  },
  sugang: {
    id: 'sugang',
    name: '한신대학교 수강신청',
    shortName: '수강신청',
    packageName: 'kr.ac.hanshin.sugang',
    fallbackPackages: ['kr.ac.hs.sugang', 'com.hs.sugang', 'kr.co.swit.hsuv'],
    description: '정규/계절학기 수강신청 및 희망과목',
    badgeText: '학사일정 바로가기',
    actionText: '수강신청',
    storeUrl: 'https://play.google.com/store/apps/details?id=kr.ac.hanshin.sugang',
  },
  library: {
    id: 'library',
    name: '한신대 도서관 회원증',
    shortName: '도서관 회원증',
    packageName: 'liberty.hslib',
    fallbackPackages: [],
    description: '중앙도서관 모바일 출입 및 열람증',
    badgeText: '모바일 이용증',
    actionText: '도서관 회원증 실행',
    storeUrl: 'https://play.google.com/store/apps/details?id=liberty.hslib',
  },
};

/**
 * 안드로이드 Intent URI 빌더 (웹 및 이전 호환용)
 */
export function buildIntentUri(packageName: string, fallbackUrl?: string): string {
  const fallback = fallbackUrl || `https://play.google.com/store/apps/details?id=${packageName}`;
  return `intent:#Intent;package=${packageName};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
}

/**
 * 캠퍼스 공식 외부 앱 원터치 실행
 * 안드로이드 네이티브 앱이 설치되어 있으면 즉시 열고, 미설치 시 플레이스토어로 안전하게 안내
 */
export async function launchCampusApp(appKeyOrPackage: 'attendance' | 'sugang' | 'library' | string): Promise<void> {
  const t0 = performance.now();

  // 중복 클릭 방지
  if (isLaunching) {
    addLog(appKeyOrPackage, 'blocked_duplicate', t0, 'Another launch is in progress');
    return;
  }
  isLaunching = true;

  try {
    addLog(appKeyOrPackage, 'start', t0);

    const app =
      CAMPUS_APPS[appKeyOrPackage] ||
      Object.values(CAMPUS_APPS).find(a => a.packageName === appKeyOrPackage || a.fallbackPackages?.includes(appKeyOrPackage));

    const packageName = app ? app.packageName : appKeyOrPackage;
    const fallbackPackages = app?.fallbackPackages || [];
    const storeUrl = app ? app.storeUrl : `https://play.google.com/store/apps/details?id=${packageName}`;

    const isNative = typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform && Capacitor.isNativePlatform();

    if (isNative) {
      try {
        addLog(appKeyOrPackage, 'native_attempt', t0, `package=${packageName}`);
        await NativeAppLauncher.launchApp({ packageName, fallbackPackages });
        addLog(appKeyOrPackage, 'native_success', t0);
        return;
      } catch (e: any) {
        addLog(appKeyOrPackage, 'native_fail', t0, e?.message || String(e));
        console.warn('NativeAppLauncher invocation failed, falling back to store URL', e);
      }
    }

    // 웹 브라우저 환경이거나 네이티브 런처 실패 시
    const isAndroidWeb = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
    if (isAndroidWeb && typeof window !== 'undefined') {
      const intentUri = buildIntentUri(packageName, storeUrl);
      addLog(appKeyOrPackage, 'fallback_intent', t0, intentUri.substring(0, 80));
      window.location.href = intentUri;
      return;
    }

    // 데스크톱 또는 기타 브라우저 환경 시 플레이스토어 링크 열기
    addLog(appKeyOrPackage, 'fallback_store', t0, storeUrl);
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(storeUrl, '_blank', 'noopener,noreferrer');
    }
  } finally {
    addLog(appKeyOrPackage, 'complete', t0);
    isLaunching = false;
  }
}
