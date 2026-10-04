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
