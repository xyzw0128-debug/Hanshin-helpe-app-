import { registerPlugin } from '@capacitor/core';

export interface BackgroundSyncStatus {
  lastSyncTime: string;
  lastStatus: string;
  enabled: boolean;
  intervalMinutes: number;
  /** 백그라운드 워커가 마지막으로 유효한 세션을 확인한 시각(epoch ms, 없으면 0) */
  sessionOkAt?: number;
  /** 백그라운드 워커가 "다른 PC 에서 로그인" 응답을 받은 시각(epoch ms, 없으면 0) */
  sessionKickedAt?: number;
  /** 백그라운드 워커가 "다른 PC" 응답 없이 세션 만료를 본 시각(epoch ms, 없으면 0) = 자연 만료 */
  sessionExpiredAt?: number;
}

export interface BackgroundSyncPluginInterface {
  configure(options: { enabled: boolean; intervalMinutes: number }): Promise<{
    success: boolean;
    enabled: boolean;
    intervalMinutes: number;
  }>;
  getStatus(): Promise<BackgroundSyncStatus>;
  saveSession(): Promise<{ saved: boolean }>;
  restoreSession(): Promise<{ restored: boolean; hasCookie?: boolean }>;
  clearSession(): Promise<void>;
  getSeenItems(): Promise<{ ids: string[] }>;
  markItemsSeen(options: { ids: string[] }): Promise<void>;
  getDebugLog(): Promise<{ enabled: boolean; debugBuild?: boolean; log: string }>;
  setReportLog(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
  recordSessionKicked(): Promise<void>;
  clearDebugLog(): Promise<void>;
  shareText(options: { text: string; title?: string }): Promise<void>;
}

let webFallbackEnabled = true;
let webFallbackInterval = 30;

const BackgroundSyncPlugin = registerPlugin<BackgroundSyncPluginInterface>('BackgroundSync', {
  web: {
    async configure(options: { enabled: boolean; intervalMinutes: number }) {
      webFallbackEnabled = options.enabled;
      webFallbackInterval = options.intervalMinutes;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('hs_lms_bg_sync_enabled', String(options.enabled));
          window.localStorage.setItem('hs_lms_bg_sync_interval', String(options.intervalMinutes));
        }
      } catch {}
      return {
        success: true,
        enabled: options.enabled,
        intervalMinutes: options.intervalMinutes,
      };
    },
    async getStatus(): Promise<BackgroundSyncStatus> {
      let enabled = webFallbackEnabled;
      let intervalMinutes = webFallbackInterval;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const savedEnabled = window.localStorage.getItem('hs_lms_bg_sync_enabled');
          if (savedEnabled !== null) enabled = savedEnabled !== 'false';
          const savedInt = window.localStorage.getItem('hs_lms_bg_sync_interval');
          if (savedInt) intervalMinutes = parseInt(savedInt, 10);
        }
      } catch {}
      return {
        lastSyncTime: '웹 프리뷰 (백그라운드 미지원)',
        lastStatus: '정상 (웹 환경)',
        enabled,
        intervalMinutes,
      };
    },
    async saveSession() {
      return { saved: false };
    },
    async restoreSession() {
      return { restored: false, hasCookie: false };
    },
    async clearSession() {},
    async getSeenItems() {
      return { ids: [] };
    },
    async markItemsSeen() {},
    async getDebugLog() {
      // 웹 개발 서버(vite dev)는 디버그 빌드처럼 취급. 주소에 ?release=1을 붙이면 배포 앱 화면으로 미리보기
      const previewRelease = typeof location !== 'undefined' && /[?&]release=1\b/.test(location.search);
      const dev = (import.meta as any).env?.DEV === true && !previewRelease;
      return { enabled: dev, debugBuild: dev, log: '' };
    },
    async setReportLog(options: { enabled: boolean }) {
      return { enabled: options.enabled };
    },
    async recordSessionKicked() {},
    async clearDebugLog() {},
    async shareText() {
      throw new Error('share not supported on web');
    },
  },
});

/**
 * Android WorkManager 백그라운드 동기화 설정 (활성화 여부 및 주기 분 단위)
 */
export async function configureBackgroundSync(
  enabled: boolean,
  intervalMinutes: number = 30
): Promise<boolean> {
  try {
    const res = await BackgroundSyncPlugin.configure({ enabled, intervalMinutes });
    return res?.success ?? true;
  } catch (e) {
    console.warn('Failed to configure background sync plugin', e);
    return false;
  }
}

/**
 * Android WorkManager 마지막 동기화 시간 및 상태 조회
 */
export async function getBackgroundSyncStatus(): Promise<BackgroundSyncStatus> {
  try {
    return await BackgroundSyncPlugin.getStatus();
  } catch (e) {
    console.warn('Failed to get background sync status from plugin', e);
    return {
      lastSyncTime: '동기화 이력 없음',
      lastStatus: '조회 실패',
      enabled: false,
      intervalMinutes: 30,
    };
  }
}

/**
 * 현재 LMS 세션 쿠키 사본을 네이티브에 보관 (Capacitor가 앱 종료 시 세션 쿠키를 지우므로 워커/재시작용)
 */
export async function saveLmsSession(): Promise<void> {
  try {
    await BackgroundSyncPlugin.saveSession();
  } catch (e) {
    console.warn('Failed to save LMS session cookie', e);
  }
}

/**
 * 앱 시작 시 보관된 LMS 세션 쿠키 복원 (유효하면 SSO 재로그인 없이 재사용하여 PC 세션 보호)
 * restored: 보관 사본에서 복원함 / hasCookie: 복원 여부와 관계없이 지금 세션 쿠키가 있음
 */
export async function restoreLmsSession(): Promise<{ restored: boolean; hasCookie: boolean }> {
  try {
    const res = await BackgroundSyncPlugin.restoreSession();
    const restored = res?.restored ?? false;
    return { restored, hasCookie: res?.hasCookie ?? restored };
  } catch (e) {
    console.warn('Failed to restore LMS session cookie', e);
    return { restored: false, hasCookie: false };
  }
}

/** 앱이 받은 "다른 PC 에서 로그인" 응답을 워커에도 기록 */
export async function recordSessionKicked(): Promise<void> {
  try {
    await BackgroundSyncPlugin.recordSessionKicked();
  } catch {
    // 웹 환경 등: 앱 쪽 기록(sessionGuard)만으로도 판단 가능
  }
}

export async function clearLmsSession(): Promise<void> {
  try {
    await BackgroundSyncPlugin.clearSession();
  } catch (e) {
    console.warn('Failed to clear LMS session cookie', e);
  }
}

/**
 * 백그라운드 워커가 이미 알림을 보낸 항목 ID 목록
 */
export async function getBackgroundSeenItems(): Promise<string[]> {
  try {
    const res = await BackgroundSyncPlugin.getSeenItems();
    return Array.isArray(res?.ids) ? res.ids : [];
  } catch (e) {
    console.warn('Failed to get background seen items', e);
    return [];
  }
}

/**
 * 포그라운드에서 확인한 항목 ID를 워커 알림 이력에 병합
 */
export async function markBackgroundItemsSeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await BackgroundSyncPlugin.markItemsSeen({ ids });
  } catch (e) {
    console.warn('Failed to mark background items seen', e);
  }
}

export { BackgroundSyncPlugin };
