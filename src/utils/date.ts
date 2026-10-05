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

/**
 * 마감까지 남은 기간 배지 (동기화 시점이 아닌 현재 시각 기준으로 계산)
 * 오늘 마감 → "오늘 23:59", 그 외 → 달력 날짜 기준 "D-n"
 */
export function formatDeadlineBadge(deadlineMs: number, now: Date = new Date()): { text: string; urgent: boolean } {
  const deadline = new Date(deadlineMs);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(deadline) - startOfDay(now)) / 86_400_000);
  if (days <= 0) {
    const hh = String(deadline.getHours()).padStart(2, '0');
    const mm = String(deadline.getMinutes()).padStart(2, '0');
    return { text: `오늘 ${hh}:${mm}`, urgent: true };
  }
  return { text: `D-${days}`, urgent: days <= 1 };
}
