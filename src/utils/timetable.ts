import { TimetableItem } from '../types';

/**
 * 시간표 공용 값과 계산 (순수 함수, 종합정보 통신 코드에 의존하지 않음)
 * 홈 화면의 "오늘 수업" 카드와 학사 화면이 함께 쓴다. 홈이 학사 모듈 전체를 불러오지 않도록 분리.
 */

export function normalizeSubjectName(subjectNm: string): string {
  return (subjectNm || '').replace(/\s+/g, '').replace(/\([^)]*\)/g, '').toLowerCase();
}

// 에브리타임 업로드 이미지 과목 기준 일치 매핑
export const KNOWN_SUBJECT_COLORS: Record<string, number> = {
  '자율지능iot시스템': 0, // 살몬 코랄 (#ee7968)
  '데이터베이스': 1,       // 머스타드 앰버 (#ecb559)
  '데이터베이스시스템': 1, // 머스타드 앰버 (#ecb559)
  '논리회로': 2,           // 올리브 그린 (#9dc462)
  '인지감성ai에이전트': 3, // 민트 틸 (#6bc8ba)
  '운영체제': 4,           // 소프트 퍼플 (#9782e0)
  '채플': 5,               // 스카이 블루 (#709ee8)
  '1인미디어만들기': 6,     // 웜 오렌지 (#fca15d)
};

/**
 * 과목명 해시 기반 고유 컬러 인덱스 도출
 * (8색 파스텔/비비드 팔레트와 1:1 매핑)
 */
export function getSubjectColorIndex(subjectNm: string, paletteSize: number = 8): number {
  if (!subjectNm) return 0;
  const normalized = normalizeSubjectName(subjectNm);

  if (KNOWN_SUBJECT_COLORS[normalized] !== undefined) {
    return KNOWN_SUBJECT_COLORS[normalized];
  }

  // 31-bit string hash
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % paletteSize;
}

/**
 * 한신대학교 공식 75분 수업 + 15분 휴식 교시 체계 (09:30 시작)
 */
export const PERIOD_TIMES: Record<number, string> = {
  1: '09:30 - 10:45', // 1교시 (1블록)
  2: '11:00 - 12:15', // 2교시 (2블록)
  3: '13:00 - 14:15', // 3교시 (3블록)
  4: '14:30 - 15:45', // 4교시 (4블록)
  5: '16:00 - 17:15', // 5교시 (5블록)
  6: '17:30 - 18:45', // 6교시 (야간 1블록)
  7: '19:00 - 20:15', // 7교시 (야간 2블록)
  8: '20:30 - 21:45', // 8교시 (야간 3블록)
  9: '22:00 - 23:15', // 9교시 (야간 4블록)
  10: '18:00 - 19:15', // 10교시 (야간 레거시 매핑)
  11: '19:25 - 20:40', // 11교시 (야간 레거시 매핑)
  12: '20:50 - 22:05', // 12교시 (야간 레거시 매핑)
  13: '22:15 - 23:30', // 13교시 (야간 레거시 매핑)
  14: '23:40 - 00:55', // 14교시 (야간 레거시 매핑)
};

export interface TimetablePaletteColor {
  bg: string;
  name: string;
  cardClass: string;
  badgeClass: string;
}

/**
 * 에브리타임 스타일 8색 비비드/파스텔 솔리드 컬러 팔레트 (사용자 캡처 기준)
 */
export const SUBJECT_PALETTE: TimetablePaletteColor[] = [
  // 0: 살몬 코랄 (자율지능IoT시스템)
  {
    bg: '#ee7968',
    name: '살몬 코랄',
    cardClass: 'bg-[#ee7968] text-white',
    badgeClass: 'bg-[#ee7968] text-white border-transparent',
  },
  // 1: 머스타드 앰버 (데이터베이스)
  {
    bg: '#ecb559',
    name: '머스타드 앰버',
    cardClass: 'bg-[#ecb559] text-white',
    badgeClass: 'bg-[#ecb559] text-white border-transparent',
  },
  // 2: 올리브 그린 (논리회로)
  {
    bg: '#9dc462',
    name: '올리브 그린',
    cardClass: 'bg-[#9dc462] text-white',
    badgeClass: 'bg-[#9dc462] text-white border-transparent',
  },
  // 3: 민트 틸 (인지감성AI에이전트)
  {
    bg: '#6bc8ba',
    name: '민트 틸',
    cardClass: 'bg-[#6bc8ba] text-white',
    badgeClass: 'bg-[#6bc8ba] text-white border-transparent',
  },
  // 4: 소프트 퍼플 (운영체제)
  {
    bg: '#9782e0',
    name: '소프트 퍼플',
    cardClass: 'bg-[#9782e0] text-white',
    badgeClass: 'bg-[#9782e0] text-white border-transparent',
  },
  // 5: 스카이 블루 (채플)
  {
    bg: '#709ee8',
    name: '스카이 블루',
    cardClass: 'bg-[#709ee8] text-white',
    badgeClass: 'bg-[#709ee8] text-white border-transparent',
  },
  // 6: 웜 오렌지 (1인미디어만들기)
  {
    bg: '#fca15d',
    name: '웜 오렌지',
    cardClass: 'bg-[#fca15d] text-white',
    badgeClass: 'bg-[#fca15d] text-white border-transparent',
  },
  // 7: 로즈 핑크
  {
    bg: '#e5739a',
    name: '로즈 핑크',
    cardClass: 'bg-[#e5739a] text-white',
    badgeClass: 'bg-[#e5739a] text-white border-transparent',
  },
];

export interface MergedTimetableItem {
  id: string;
  dayOfWeek: number;
  dayName: string;
  periodStart: number;
  periodEnd: number;
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  timeStr: string;
  subjectNm: string;
  profNm: string;
  classroom: string;
  colorIndex: number;
  rawItems: TimetableItem[];
}

export function parseClassMinutes(timeStr?: string, period?: number): { start: number; end: number } {
  if (timeStr) {
    const match = /(\d{1,2}):(\d{2})\s*[~–—\-∼〜]\s*(\d{1,2}):(\d{2})/.exec(timeStr);
    if (match) {
      const startH = parseInt(match[1], 10);
      const startM = parseInt(match[2], 10);
      const endH = parseInt(match[3], 10);
      const endM = parseInt(match[4], 10);
      const start = startH * 60 + startM;
      let end = endH * 60 + endM;
      if (end < start) {
        end += 24 * 60;
      }
      return { start, end };
    }
  }

  const p = period || 1;
  if (PERIOD_TIMES[p]) {
    return parseClassMinutes(PERIOD_TIMES[p]);
  }

  const startM = (8 + p) * 60;
  return { start: startM, end: startM + 75 };
}

function formatMinToHHMM(mins: number): string {
  const normalizedMins = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(normalizedMins / 60);
  const m = normalizedMins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function mergeDayTimetable(items: TimetableItem[]): MergedTimetableItem[] {
  if (items.length === 0) return [];

  const parsed = items.map(it => {
    const { start, end } = parseClassMinutes(it.timeStr, it.period);
    const startMinutes = it.startMinutes !== undefined ? it.startMinutes : start;
    const endMinutes =
      it.endMinutes !== undefined
        ? (it.endMinutes < startMinutes ? it.endMinutes + 24 * 60 : it.endMinutes)
        : end;
    const startTime = it.startTime || formatMinToHHMM(startMinutes);
    const endTime = it.endTime || formatMinToHHMM(endMinutes);
    const durationMinutes =
      it.durationMinutes !== undefined && it.durationMinutes > 0
        ? it.durationMinutes
        : Math.max(0, endMinutes - startMinutes);
    const timeStr = it.timeStr || `${startTime} - ${endTime}`;
    const colorIndex =
      it.colorIndex !== undefined && it.colorIndex >= 0 && it.colorIndex < 8
        ? it.colorIndex
        : getSubjectColorIndex(it.subjectNm, 8);
    return {
      ...it,
      startTime,
      endTime,
      startMinutes,
      endMinutes,
      durationMinutes,
      timeStr,
      colorIndex,
    };
  });

  // 시작 시간 순 정렬
  parsed.sort((a, b) => a.startMinutes - b.startMinutes || (a.period || 0) - (b.period || 0));

  const merged: MergedTimetableItem[] = [];
  let curr: MergedTimetableItem | null = null;

  for (const it of parsed) {
    if (!curr) {
      curr = {
        id: it.id,
        dayOfWeek: it.dayOfWeek,
        dayName: it.dayName,
        periodStart: it.period || 0,
        periodEnd: it.period || 0,
        startTime: it.startTime,
        endTime: it.endTime,
        startMinutes: it.startMinutes,
        endMinutes: it.endMinutes,
        durationMinutes: it.durationMinutes,
        timeStr: it.timeStr,
        subjectNm: it.subjectNm,
        profNm: it.profNm,
        classroom: it.classroom,
        colorIndex: it.colorIndex,
        rawItems: [it],
      };
      continue;
    }

    const sameDay = curr.dayOfWeek === it.dayOfWeek;
    const sameSubject = curr.subjectNm.trim().toLowerCase() === it.subjectNm.trim().toLowerCase();
    const isContiguousTime = it.startMinutes <= curr.endMinutes + 20; // 15분 쉬는시간 오차 허용
    const isConsecutivePeriod =
      it.period !== undefined &&
      curr.periodEnd !== undefined &&
      it.period === curr.periodEnd + 1 &&
      it.startMinutes <= curr.endMinutes + 30;

    if (sameDay && sameSubject && (isContiguousTime || isConsecutivePeriod)) {
      if (it.period !== undefined) {
        curr.periodEnd = Math.max(curr.periodEnd, it.period);
      }
      curr.endMinutes = Math.max(curr.endMinutes, it.endMinutes);
      curr.durationMinutes = curr.endMinutes - curr.startMinutes;
      curr.endTime = formatMinToHHMM(curr.endMinutes);
      curr.timeStr = `${curr.startTime} - ${curr.endTime}`;
      if (!curr.classroom && it.classroom) curr.classroom = it.classroom;
      if (!curr.profNm && it.profNm) curr.profNm = it.profNm;
      curr.rawItems.push(it);
    } else {
      merged.push(curr);
      curr = {
        id: it.id,
        dayOfWeek: it.dayOfWeek,
        dayName: it.dayName,
        periodStart: it.period || 0,
        periodEnd: it.period || 0,
        startTime: it.startTime,
        endTime: it.endTime,
        startMinutes: it.startMinutes,
        endMinutes: it.endMinutes,
        durationMinutes: it.durationMinutes,
        timeStr: it.timeStr,
        subjectNm: it.subjectNm,
        profNm: it.profNm,
        classroom: it.classroom,
        colorIndex: it.colorIndex,
        rawItems: [it],
      };
    }
  }

  if (curr) {
    merged.push(curr);
  }

  return merged;
}
