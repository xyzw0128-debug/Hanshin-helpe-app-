export function parseNoticeDate(dateStr: string): number {
  if (!dateStr) return 0;
  const digits = dateStr.match(/\d+/g);
  if (!digits || digits.length === 0) return 0;

  let year = new Date().getFullYear();
  let month = 1;
  let day = 1;
  let hour = 0;
  let min = 0;
  let sec = 0;

  if (digits[0].length === 4) {
    year = parseInt(digits[0], 10);
    month = parseInt(digits[1] || '1', 10);
    day = parseInt(digits[2] || '1', 10);
    hour = parseInt(digits[3] || '0', 10);
    min = parseInt(digits[4] || '0', 10);
    sec = parseInt(digits[5] || '0', 10);
  } else if (digits.length >= 2) {
    month = parseInt(digits[0], 10);
    day = parseInt(digits[1], 10);
    hour = parseInt(digits[2] || '0', 10);
    min = parseInt(digits[3] || '0', 10);
  }

  return new Date(year, month - 1, day, hour, min, sec).getTime();
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 홈 헤더용 오늘 날짜 (예: "10월 4일 토요일")
 */
export function formatTodayLabel(now: Date = new Date()): string {
  return `${now.getMonth() + 1}월 ${now.getDate()}일 ${WEEKDAYS[now.getDay()]}요일`;
}

/** 마감 시각 표시: "10월 5일 (일) 23:59" */
export function formatDeadlineDateTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]}) ${hh}:${mm}`;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** to가 from보다 달력으로 며칠 뒤인지 (같은 날 0, 다음 날 1) */
const calendarDays = (from: Date, to: Date) => Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * 마감까지 남은 기간 배지 (동기화 시점이 아닌 현재 시각 기준으로 계산)
 * 오늘 마감 → "오늘 23:59", 그 외 → 달력 날짜 기준 "D-n"
 */
export function formatDeadlineBadge(deadlineMs: number, now: Date = new Date()): { text: string; urgent: boolean } {
  const deadline = new Date(deadlineMs);
  const days = calendarDays(now, deadline);
  if (days <= 0) return { text: `오늘 ${hhmm(deadline)}`, urgent: true };
  return { text: `D-${days}`, urgent: days <= 1 };
}

export type DeadlineBadgeType = 'urgent' | 'warning' | 'done' | 'normal';

/**
 * 과제·퀴즈·강의 카드의 마감 배지와 남은 시간. 그릴 때마다 현재 시각으로 계산한다
 * (동기화 때 계산해 저장한 글자를 쓰면 다음 동기화까지 "3시간 남음"에 멈춰 있음).
 * D-day는 홈·위젯(formatDeadlineBadge)과 같은 달력 날짜 기준. 오늘·내일 마감은 urgent, 3일 안은 warning.
 * deadlineMs가 NaN·Infinity면 마감일 미지정
 */
export function deadlineStatus(
  deadlineMs: number,
  isSubmitted: boolean,
  now: Date = new Date()
): { badgeText: string; badgeType: DeadlineBadgeType; timeLeftText: string } {
  if (isSubmitted) return { badgeText: '제출완료', badgeType: 'done', timeLeftText: '제출완료됨' };
  if (!Number.isFinite(deadlineMs)) return { badgeText: '마감일 미지정', badgeType: 'normal', timeLeftText: '기한 정보 없음' };
  const leftMs = deadlineMs - now.getTime();
  if (leftMs < 0) return { badgeText: '마감 지남', badgeType: 'normal', timeLeftText: '기한 만료' };

  const leftMin = Math.floor(leftMs / 60_000);
  const leftHours = Math.floor(leftMin / 60);
  const timeLeftText =
    leftHours >= 24
      ? `${Math.floor(leftHours / 24)}일${leftHours % 24 ? ` ${leftHours % 24}시간` : ''} 남음`
      : leftHours > 0
      ? `${leftHours}시간 ${leftMin % 60}분 남음`
      : `${leftMin}분 남음`;

  const deadline = new Date(deadlineMs);
  const days = calendarDays(now, deadline);
  if (days <= 0) return { badgeText: `오늘 ${hhmm(deadline)} 마감`, badgeType: 'urgent', timeLeftText };
  return { badgeText: `D-${days}`, badgeType: days <= 1 ? 'urgent' : days <= 3 ? 'warning' : 'normal', timeLeftText };
}

/** 마지막 동기화 시각: 오늘이면 "14:05", 어제면 "어제 14:05", 그 전이면 "10/12 14:05" */
export function formatSyncTime(ms: number, now: Date = new Date()): string {
  const d = new Date(ms);
  const days = calendarDays(d, now);
  if (days <= 0) return hhmm(d);
  if (days === 1) return `어제 ${hhmm(d)}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm(d)}`;
}
