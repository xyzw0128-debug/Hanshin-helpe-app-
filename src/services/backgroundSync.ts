import { registerPlugin } from '@capacitor/core';

export interface BackgroundSyncStatus {
  lastSyncTime: string;
  lastStatus: string;
  enabled: boolean;
  intervalMinutes: number;
}

export interface BackgroundSyncPluginInterface {
  configure(options: { enabled: boolean; intervalMinutes: number }): Promise<{
    success: boolean;
    enabled: boolean;
    intervalMinutes: number;
  }>;
  getStatus(): Promise<BackgroundSyncStatus>;
  saveSession(): Promise<{ saved: boolean }>;
  restoreSession(): Promise<{ restored: boolean }>;
  clearSession(): Promise<void>;
  getSeenItems(): Promise<{ ids: string[] }>;
  markItemsSeen(options: { ids: string[] }): Promise<void>;
  getDebugLog(): Promise<{ enabled: boolean; log: string }>;
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
      return { restored: false };
    },
    async clearSession() {},
    async getSeenItems() {
      return { ids: [] };
    },
    async markItemsSeen() {},
    async getDebugLog() {
      // 웹 개발 서버(vite dev)에서만 활성화
      return { enabled: (import.meta as any).env?.DEV === true, log: '' };
    },
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
 */
export async function restoreLmsSession(): Promise<boolean> {
  try {
    const res = await BackgroundSyncPlugin.restoreSession();
    return res?.restored ?? false;
  } catch (e) {
    console.warn('Failed to restore LMS session cookie', e);
    return false;
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
