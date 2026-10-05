import { Capacitor, registerPlugin } from '@capacitor/core';

/** 알림·위젯으로 열린 화면. target 예: "lms:assignments", "lms:notices", "home" */
export interface OpenTarget {
  target?: string;
  itemId?: string;
}

export interface SystemStatus {
  /** 이 앱의 알림 권한 */
  notificationsEnabled: boolean;
  /** 배터리 최적화에서 제외됨 (백그라운드 확인이 절전 기능에 멈추지 않음) */
  ignoringBatteryOptimizations: boolean;
  /** 정확한 알람 허용 (Android 12+, 마감 알림이 제시간에) */
  exactAlarmsAllowed: boolean;
  manufacturer: string;
}

interface AppShellPluginInterface {
  setBackState(options: { canGoBack: boolean }): Promise<void>;
  armExit(): Promise<void>;
  consumeOpenTarget(): Promise<OpenTarget>;
  getSystemStatus(): Promise<SystemStatus>;
  openBatterySettings(): Promise<void>;
  openExactAlarmSettings(): Promise<void>;
  openNotificationSettings(): Promise<void>;
  addCalendarEvent(options: { title: string; description: string; beginMs: number; endMs: number }): Promise<void>;
}

const AppShell = registerPlugin<AppShellPluginInterface>('AppShell', {
  web: {
    async setBackState() {},
    async armExit() {
      window.dispatchEvent(new Event('hsBackExitHint'));
    },
    async consumeOpenTarget() {
      return {};
    },
    async getSystemStatus() {
      return { notificationsEnabled: true, ignoringBatteryOptimizations: true, exactAlarmsAllowed: true, manufacturer: '' };
    },
    async openBatterySettings() {},
    async openExactAlarmSettings() {},
    async openNotificationSettings() {},
    async addCalendarEvent(options) {
      downloadIcs(options);
    },
  },
});

export const isNativeApp = () => Capacitor.isNativePlatform();

export async function setNativeBackState(canGoBack: boolean): Promise<void> {
  try {
    await AppShell.setBackState({ canGoBack });
  } catch {
    // 네이티브 플러그인이 없는 이전 빌드: 기본 뒤로가기 동작
  }
}

export async function armNativeExit(): Promise<void> {
  try {
    await AppShell.armExit();
  } catch {}
}

export async function consumeOpenTarget(): Promise<OpenTarget> {
  try {
    return (await AppShell.consumeOpenTarget()) || {};
  } catch {
    return {};
  }
}

export async function getSystemStatus(): Promise<SystemStatus | null> {
  if (!isNativeApp()) return null;
  try {
    return await AppShell.getSystemStatus();
  } catch {
    return null;
  }
}

export const openBatterySettings = () => AppShell.openBatterySettings().catch(() => undefined);
export const openExactAlarmSettings = () => AppShell.openExactAlarmSettings().catch(() => undefined);
export const openNotificationSettings = () => AppShell.openNotificationSettings().catch(() => undefined);

/**
 * 기기 캘린더에 마감 일정 추가 화면을 엶 (앱에서는 캘린더 앱, 웹에서는 .ics 파일).
 * 마감 시각으로 끝나는 1시간짜리 일정으로 만든다.
 */
export async function addDeadlineToCalendar(item: { title: string; courseNm: string; deadlineMs: number; deadlineStr?: string }) {
  const description = [item.courseNm, item.deadlineStr ? `기한: ${item.deadlineStr}` : '', '한신대 LMS 알리미에서 추가']
    .filter(Boolean)
    .join('\n');
  await AppShell.addCalendarEvent({
    title: `[마감] ${item.title}`,
    description,
    beginMs: item.deadlineMs - 60 * 60 * 1000,
    endMs: item.deadlineMs,
  });
}

function downloadIcs(o: { title: string; description: string; beginMs: number; endMs: number }) {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//hs-lms-notifier//KO',
    'BEGIN:VEVENT',
    `UID:${o.beginMs}-${Math.abs(hashCode(o.title))}@hs-lms-notifier`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(o.beginMs)}`,
    `DTEND:${stamp(o.endMs)}`,
    `SUMMARY:${esc(o.title)}`,
    `DESCRIPTION:${esc(o.description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'deadline.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** 외부 링크를 기기 브라우저로 엶 (Capacitor는 앱 밖 주소를 시스템 브라우저로 넘김) */
export const openExternal = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
