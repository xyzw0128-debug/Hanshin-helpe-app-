import { LocalNotifications } from '@capacitor/local-notifications';
import { CapacitorHttp } from '@capacitor/core';

export function sanitizeDiscordText(text: string): string {
  if (!text) return '';
  return text
    .replace(/@(everyone|here)/gi, '＠$1')
    .replace(/<@([!&]?\d+)>/g, '＜@$1＞');
}

export function isValidDiscordWebhookUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url.trim());
    const isDiscordHost = parsed.hostname === 'discord.com' || parsed.hostname === 'discordapp.com';
    const isWebhookPath = parsed.pathname.startsWith('/api/webhooks/');
    return parsed.protocol === 'https:' && isDiscordHost && isWebhookPath;
  } catch {
    return false;
  }
}

/**
 * 문자열 ID(예: 과제 ID, 공지 ID 등)를 결정론적(deterministic) 양의 32비트 정수로 해싱합니다.
 * 동일한 문자열 ID는 항상 동일한 정수를 반환하며 범위는 [1, 2147483647] 입니다.
 */
export function hashNotificationId(idStr: string): number {
  if (!idStr || typeof idStr !== 'string') return 1;
  let hash = 5381;
  for (let i = 0; i < idStr.length; i++) {
    hash = ((hash << 5) + hash) + idStr.charCodeAt(i);
    hash = hash & 0x7fffffff;
  }
  return hash === 0 ? 1 : hash;
}

/**
 * ID(숫자 또는 문자열)를 안전한 양의 정수 알림 ID로 정규화합니다.
 */
export function toNotificationNumericId(
  id?: number | string | null,
  defaultSeed: string = 'hs_lms_notification'
): number {
  if (typeof id === 'number') {
    if (isNaN(id) || !isFinite(id)) return hashNotificationId(defaultSeed);
    const safeInt = Math.floor(Math.abs(id)) & 0x7fffffff;
    return safeInt === 0 ? 1 : safeInt;
  }
  if (typeof id === 'string' && id.trim().length > 0) {
    return hashNotificationId(id.trim());
  }
  return hashNotificationId(defaultSeed);
}

export class NotificationService {
  public static async requestPermission(): Promise<boolean> {
    try {
      const status = await LocalNotifications.requestPermissions();
      return status.display === 'granted';
    } catch (e) {
      console.warn('LocalNotifications permission request failed', e);
      return false;
    }
  }

  /**
   * 문자열/숫자 ID에 대한 결정론적 알림 ID 조회
   */
  public static getNotificationId(id: number | string): number {
    return toNotificationNumericId(id);
  }

  /**
   * 즉시 로컬 알림 발송 (100ms 후 실행)
   * id 미지정 시 title:body 기반 결정론적 해시 ID를 부여하여 Math.random() 중복/난수 제거
   */
  public static async sendLocalNotification(
    title: string,
    body: string,
    id?: number | string
  ): Promise<number> {
    const numericId = toNotificationNumericId(id, `${title}:${body}`);
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            title,
            body,
            id: numericId,
            schedule: { at: new Date(Date.now() + 100) },
            sound: 'beep.wav',
            actionTypeId: '',
            extra: null,
          },
        ],
      });
      return numericId;
    } catch (e) {
      console.warn('Failed to send local notification', e);
      return numericId;
    }
  }

  /**
   * 과제 고유 ID 기반 미래 마감 예약 알림 (OS 차원의 덮어쓰기 지원)
   * 동일한 과제 ID로 호출 시 항상 동일한 1:1 고유 정수 ID가 매핑되어 중복 없이 덮어씁니다(Overwrite).
   * 유효하지 않은 ID이거나 알림 시각(scheduleAt)이 현재 시각 이전/유효하지 않으면 등록하지 않고 null을 반환합니다.
   */
  public static async scheduleReminderNotification(options: {
    id: number | string;
    title: string;
    body: string;
    scheduleAt: Date | number | string;
    sound?: string;
    extra?: any;
  }): Promise<number | null>;
  public static async scheduleReminderNotification(
    id: number | string,
    title: string,
    body: string,
    scheduleAt: Date | number | string,
    sound?: string,
    extra?: any
  ): Promise<number | null>;
  public static async scheduleReminderNotification(
    idOrOptions:
      | number
      | string
      | {
          id: number | string;
          title: string;
          body: string;
          scheduleAt: Date | number | string;
          sound?: string;
          extra?: any;
        },
    title?: string,
    body?: string,
    scheduleAt?: Date | number | string,
    sound: string = 'beep.wav',
    extra: any = null
  ): Promise<number | null> {
    let targetId: number | string;
    let targetTitle: string;
    let targetBody: string;
    let targetAt: Date | number | string;
    let targetSound = sound;
    let targetExtra = extra;

    if (typeof idOrOptions === 'object' && idOrOptions !== null) {
      targetId = idOrOptions.id;
      targetTitle = idOrOptions.title;
      targetBody = idOrOptions.body;
      targetAt = idOrOptions.scheduleAt;
      if (idOrOptions.sound !== undefined) targetSound = idOrOptions.sound;
      if (idOrOptions.extra !== undefined) targetExtra = idOrOptions.extra;
    } else {
      targetId = idOrOptions as string | number;
      targetTitle = title || '';
      targetBody = body || '';
      targetAt = scheduleAt ?? Date.now();
    }

    // 과제 고유 1:1 매핑 ID 유효성 검사 (빈 값, null, NaN 거부)
    if (
      targetId === undefined ||
      targetId === null ||
      (typeof targetId === 'string' && targetId.trim().length === 0) ||
      (typeof targetId === 'number' && (isNaN(targetId) || !isFinite(targetId)))
    ) {
      return null;
    }

    const atDate = targetAt instanceof Date ? targetAt : new Date(targetAt);
    if (isNaN(atDate.getTime()) || atDate.getTime() <= Date.now()) {
      return null;
    }

    const numericId = toNotificationNumericId(targetId);
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            title: targetTitle,
            body: targetBody,
            id: numericId,
            schedule: { at: atDate },
            sound: targetSound,
            actionTypeId: '',
            extra: targetExtra,
          },
        ],
      });
      return numericId;
    } catch (e) {
      console.warn('Failed to schedule reminder notification', e);
      return null;
    }
  }

  /**
   * 특정 ID(과제 ID 등)에 해당하는 예약 알림 개별 취소
   * 과제 제출 완료(isSubmitted) 시 호출하여 OS 대기열에서 해당 과제 알림만 즉시 제거합니다.
   * 유효하지 않은 ID(빈 문자열, null, NaN 등)는 기본 알림 오발 취소를 방지하기 위해 즉시 false를 반환합니다.
   */
  public static async cancelNotification(id?: number | string | null): Promise<boolean> {
    if (
      id === undefined ||
      id === null ||
      (typeof id === 'string' && id.trim().length === 0) ||
      (typeof id === 'number' && (isNaN(id) || !isFinite(id)))
    ) {
      return false;
    }

    try {
      const numericId = toNotificationNumericId(id);
      await LocalNotifications.cancel({
        notifications: [{ id: numericId }],
      });
      return true;
    } catch (e) {
      console.warn('Failed to cancel notification', e);
      return false;
    }
  }

  /**
   * 과제 제출 완료 시 해당 과제의 알림 취소 편의 메서드
   */
  public static async cancelAssignmentNotification(assignmentId?: number | string | null): Promise<boolean> {
    return this.cancelNotification(assignmentId);
  }

  public static async sendDiscordWebhook(
    webhookUrl: string,
    content: string,
    allowParse = false
  ): Promise<boolean> {
    const cleanUrl = (webhookUrl || '').trim();
    if (!isValidDiscordWebhookUrl(cleanUrl)) {
      if (cleanUrl) {
        console.warn('Invalid Discord webhook URL skipped:', cleanUrl);
      }
      return false;
    }
    try {
      await CapacitorHttp.post({
        url: cleanUrl,
        headers: { 'Content-Type': 'application/json' },
        data: {
          content,
          // CWE-74 / CWE-116: 악의적인 @everyone, @here, 역할 멘션 파싱 방지
          allowed_mentions: {
            parse: allowParse ? ['everyone', 'roles', 'users'] : [],
          },
        },
      });
      return true;
    } catch (e) {
      console.warn('Discord webhook failed', e);
      return false;
    }
  }
}
