import { HttpResponse } from '@capacitor/core';
import { HttpClient } from './httpClient';
import { Course, AssignmentItem, LectureItem, NoticeItem, TodoListResult, MaterialItem } from '../types';
import { LMS_BASE, USER_AGENT, LmsAuthService } from './lmsAuth';
import { debugLog } from './debugLog';
import { isKickedResponse } from './sessionGuard';

const MY_LECTURE_MNID = '201008840728';
const CLASSROOM_MNID = '201008254671';
const NOTICE_MNID = '201008945595';
const MATERIAL_MNID = '20100863099';
const PORTAL_NOTICE_MNID = '20120658883';
const PORTAL_CTL_MNID = '202102174150';

export function cleanText(s: string): string {
  if (!s) return '';
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&middot;/gi, '·')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\xa0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\(\s*학습시간\/기준시간\s*:\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .trim();
}

/** 브라우저 textContent처럼 HTML 엔티티를 디코딩 (DOMParser가 없는 환경용. Java TodoListParser.decodeEntities와 같은 표) */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', bull: '•',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', ndash: '–',
  mdash: '—', times: '×', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™',
};

export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole; // 범위를 벗어난 숫자 엔티티는 그대로
      }
    }
    return NAMED_ENTITIES[name] ?? whole;
  });
}

/**
 * DOMParser가 없는 환경(테스트)에서 `el.querySelector('.cls').textContent`와 같은 값을 구한다.
 * 클래스 토큰이 정확히 일치하는 첫 요소, 같은 태그의 중첩을 세어 끝 태그를 찾고, 안쪽 태그는 빈 문자열로 제거.
 * 백그라운드 워커(Java TodoListParser.textContentByClass)와 같은 규칙이어야 항목 ID가 일치한다.
 */
export function textContentByClass(html: string, cls: string): string | null {
  const openTag = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = openTag.exec(html)) !== null) {
    const classAttr = m[2].match(/(?:^|\s)class\s*=\s*(["'])([\s\S]*?)\1/i);
    if (!classAttr || !classAttr[2].split(/\s+/).includes(cls)) continue;
    const start = openTag.lastIndex;
    const sameTag = new RegExp(`<(/?)${m[1]}\\b[^>]*>`, 'gi');
    sameTag.lastIndex = start;
    let depth = 1;
    let end = html.length;
    let t: RegExpExecArray | null;
    while ((t = sameTag.exec(html)) !== null) {
      if (t[1]) {
        if (--depth === 0) {
          end = t.index;
          break;
        }
      } else if (!t[0].endsWith('/>')) {
        depth++;
      }
    }
    return decodeHtmlEntities(html.slice(start, end).replace(/<[^>]*>/g, ''));
  }
  return null;
}

export function cleanLecName(s: string): string {
  return cleanText(s)
    .replace(/^[\(\[]\d{2,4}[^\]\)]*[\]\)]\s*/, '')
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .trim();
}

/**
 * 강의 제목 끝의 진도율 "(NN%)" 제거 (진도율이 바뀌어도 동일 강의 ID 유지)
 */
export function stripLectureProgress(title: string): string {
  return (title || '').replace(/\s*\(\d{1,3}%\)\s*$/, '').trim();
}

/**
 * 온라인 강의 학습 기간 문자열 파싱 (종료시한 또는 종료일 기준 타임스탬프 추출)
 */
export function parseLectureDeadline(periodStr: string): number {
  if (!periodStr) return Infinity;
  const matches = Array.from(
    periodStr.matchAll(/(\d{4})[.\-/](\d{2})[.\-/](\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/g)
  );
  if (matches.length === 0) return Infinity;
  const last = matches[matches.length - 1];
  const y = parseInt(last[1], 10);
  const m = parseInt(last[2], 10) - 1;
  const d = parseInt(last[3], 10);
  const h = last[4] !== undefined ? parseInt(last[4], 10) : 23;
  const min = last[5] !== undefined ? parseInt(last[5], 10) : 59;
  const s = last[6] !== undefined ? parseInt(last[6], 10) : (last[4] !== undefined ? 0 : 59);
  return new Date(y, m, d, h, min, s).getTime();
}


/**
 * 긴급 필독 공지 판별 통합 함수
 * 제목 대괄호/괄호 말머리([긴급], (긴급), [필독], [휴강], [중요] 등)에 최우선 가중치를 부여하고,
 * 주요 긴급/학사 변동 키워드를 제목 및 본문에서 체계적으로 검사합니다.
 */
export function isEmergencyNotice(title: string, body?: string): boolean {
  if (!title) return false;
  const cleanTitle = cleanText(title);

  // 1. 제목 대괄호 및 괄호 말머리 우선 가중치 검사
  const headerMatch = cleanTitle.match(/^[\[\(]([^\]\)]+)[\]\)]/);
  if (headerMatch) {
    const header = headerMatch[1].trim();
    const urgentHeaders = ['긴급', '필독', '휴강', '중요', '시험', '퀴즈', '일정변경', '일정 변경', '결석', '보강'];
    if (urgentHeaders.some(h => header.includes(h))) {
      return true;
    }
  }

  // 2. 제목 내 주요 긴급 키워드 검사
  const urgentKeywords = [
    '긴급',
    '필독',
    '휴강',
    '보강',
    '중요',
    '시험',
    '퀴즈',
    '일정 변경',
    '일정변경',
    '마감 연장',
    '마감연장',
    '제출 기한',
    '서버 작업',
    '서버 점검',
    '서비스 중단',
    '시스템 점검',
  ];
  if (urgentKeywords.some(kw => cleanTitle.includes(kw))) {
    return true;
  }

  // 3. 본문 내 긴급 문구 검사 (옵션)
  // 본문에는 '중요', '시험', '퀴즈' 같은 일반 단어가 흔하므로 수업 변동/서비스 중단 키워드만 검사
  if (body) {
    const cleanBody = cleanText(body);
    const bodyKeywords = [
      '긴급',
      '휴강',
      '보강',
      '일정 변경',
      '일정변경',
      '마감 연장',
      '마감연장',
      '서버 점검',
      '서비스 중단',
      '시스템 점검',
    ];
    if (bodyKeywords.some(kw => cleanBody.includes(kw))) {
      return true;
    }
  }

  return false;
}

/**
 * 세션이 살아 있다고 확인된 직후 페이지 요청이 실패하는 원인(다른 곳 로그인 / SSO 리디렉션 / 서버 오류)을
 * 구분하기 위한 진단 로그. 최종 URL은 CapacitorHttp가 리디렉션을 따라간 결과.
 */
function logPageFailure(where: string, resp: HttpResponse, html: string): void {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, m => (/alert\(/.test(m) ? m : ' '))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  debugLog('scraper', `${where} 실패 (세션 만료로 처리)`, {
    status: resp?.status,
    finalUrl: (resp?.url || '').split('?')[0],
    len: html.length,
    title: html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || null,
    kicked: isKickedResponse(html),
    head: text.slice(0, 200),
  });
}

export class LmsScraperService {
  public static isEmergencyNotice = isEmergencyNotice;
  public static cleanLecName = cleanLecName;
  public static parseLectureDeadline = parseLectureDeadline;

  public static async getCourses(): Promise<Course[]> {
    const resp: HttpResponse = await HttpClient.get({
      url: `${LMS_BASE}/lms/myLecture/doListView.dunet`,
      params: { mnid: MY_LECTURE_MNID },
      headers: {
        'User-Agent': USER_AGENT,
        Referer: `${LMS_BASE}/main/MainView.dunet`,
      },
    });

    const html = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    if (!html.includes('myCourseList')) {
      logPageFailure('과목 목록(doListView)', resp, html);
      throw new Error('세션 만료: 로그인이 필요합니다.');
    }

    const courses: Course[] = [];
    const regex = /myCourseList\.push\((\{.*?\})\);/gs;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(html)) !== null) {
      try {
        const cleaned = match[1].replace(/,\s*\}/g, '}');
        const c = JSON.parse(cleaned);
        courses.push({
          course_id: String(c.course_id || ''),
          class_no: String(c.class_no || ''),
          course_nm: cleanText(c.course_nm || ''),
          prof_nm: cleanText(c.prof_nm || ''),
          alarm_count: Number(c.alarm_count || 0),
        });
      } catch (e) {
        console.warn('Course JSON parse error', e);
      }
    }

    return courses;
  }

  /**
   * doTodoList.dunet 단일 POST 호출 HTML 수집
   * @param toDoType 'all' (전체) | 'proceedable' (진행가능) | 'complete' (완료) | 'incomplete' (미완료)
   */
  public static async getTodoListHtml(toDoType: string = 'all'): Promise<string> {
    const resp: HttpResponse = await HttpClient.post({
      url: `${LMS_BASE}/lms/myLecture/doTodoList.dunet`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        Origin: LMS_BASE,
        Referer: `${LMS_BASE}/lms/myLecture/doListView.dunet?mnid=${MY_LECTURE_MNID}`,
      },
      data: new URLSearchParams({ to_do_type: toDoType }).toString(),
    });

    const html = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    // 정상 응답은 항목이 없어도 항상 todolist_pop 컨테이너를 포함 (HAR 확인)
    if (!html.includes('todolist_pop')) {
      logPageFailure(`할일(doTodoList ${toDoType})`, resp, html);
      throw new Error('세션 만료: 로그인이 필요합니다.');
    }
    return html;
  }

  /**
   * 완료된 학습(complete) HTML로부터 완료된 콘텐츠 ID 목록 추출
   */
  public static parseCompletedItemIds(html: string): Set<string> {
    const ids = new Set<string>();
    if (!html) return ids;
    const regex = /fnGoContent\s*\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null) {
      const args = m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
      if (args[3]) ids.add(args[3]);
    }
    return ids;
  }

  /**
   * (종료시한 : YYYY.MM.DD HH:mm:ss) 또는 기간 정밀 파싱 기반 초 단위 D-Day 계산
   */
  public static calculateDDay(
    dateStr: string,
    isSubmitted: boolean
  ): {
    badgeText: string;
    badgeType: 'urgent' | 'warning' | 'done' | 'normal';
    timeLeftText: string;
    deadlineDate: string | null;
  } {
    const matches = Array.from(
      (dateStr || '').matchAll(/(\d{4})[.\-/](\d{2})[.\-/](\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/g)
    );

    if (matches.length === 0) {
      if (isSubmitted) {
        return {
          badgeText: '제출완료',
          badgeType: 'done',
          timeLeftText: '제출완료됨',
          deadlineDate: null,
        };
      }
      return {
        badgeText: '마감일 미지정',
        badgeType: 'normal',
        timeLeftText: '기한 정보 없음',
        deadlineDate: null,
      };
    }

    const endParts = matches[matches.length - 1];
    const y = parseInt(endParts[1], 10);
    const m = parseInt(endParts[2], 10) - 1;
    const d = parseInt(endParts[3], 10);
    const h = endParts[4] !== undefined ? parseInt(endParts[4], 10) : 23;
    const min = endParts[5] !== undefined ? parseInt(endParts[5], 10) : 59;
    const s = endParts[6] !== undefined ? parseInt(endParts[6], 10) : (endParts[4] !== undefined ? 0 : 59);
    const deadline = new Date(y, m, d, h, min, s);

    if (isSubmitted) {
      return {
        badgeText: '제출완료',
        badgeType: 'done',
        timeLeftText: '제출완료됨',
        deadlineDate: deadline.toISOString(),
      };
    }

    const now = new Date();
    const diffMs = deadline.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMs < 0) {
      return {
        badgeText: '마감 지남',
        badgeType: 'normal',
        timeLeftText: '기한 만료',
        deadlineDate: deadline.toISOString(),
      };
    }

    if (diffHours < 24 && deadline.toDateString() === now.toDateString()) {
      const diffH = Math.floor(diffHours);
      const diffM = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const timeStr = endParts[4] !== undefined && endParts[5] !== undefined
        ? `오늘 ${endParts[4].padStart(2, '0')}:${endParts[5].padStart(2, '0')} 마감`
        : '오늘 마감';
      return {
        badgeText: timeStr,
        badgeType: 'urgent',
        timeLeftText: diffH > 0 ? `${diffH}시간 ${diffM}분 남음` : `${diffM}분 남음`,
        deadlineDate: deadline.toISOString(),
      };
    }

    if (diffDays <= 3) {
      return {
        badgeText: `D-${diffDays || 1}`,
        badgeType: 'warning',
        timeLeftText: `약 ${Math.floor(diffHours)}시간 남음`,
        deadlineDate: deadline.toISOString(),
      };
    }

    return {
      badgeText: `D-${diffDays}`,
      badgeType: 'normal',
      timeLeftText: `${diffDays}일 남음`,
      deadlineDate: deadline.toISOString(),
    };
  }

  /**
   * doTodoList HTML 파싱: 과제(tab5), 온라인 인강/진도율(tab2), 퀴즈/시험(tab7, tab8), 과목 공지(tab9)
   */
  public static parseTodoListHtml(
    html: string,
    courses: Course[] = [],
    completedIds: Set<string> = new Set()
  ): TodoListResult {
    const assignments: AssignmentItem[] = [];
    const lectures: LectureItem[] = [];
    const quizzes: AssignmentItem[] = [];
    const notices: NoticeItem[] = [];
    const materials: MaterialItem[] = [];

    if (!html) return { assignments, lectures, quizzes, notices, materials };

    // 1. 브라우저/Capacitor 환경 DOMParser 지원 시
    if (typeof DOMParser !== 'undefined') {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const items = doc.querySelectorAll('li.tab');

        items.forEach(li => {
          const className = li.className || '';
          const classList = className.split(/\s+/);
          const tabClass = classList.find(c => /^tab\d+$/.test(c)) || '';

          const a = li.querySelector('a');
          const href = a?.getAttribute('href') || a?.getAttribute('onclick') || '';
          const fnArgsMatch = href.match(/fnGoContent\s*\(([^)]+)\)/);
          let courseId = '';
          let classNo = '';
          let contentId = '';
          if (fnArgsMatch) {
            const args = fnArgsMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
            courseId = args[1] || '';
            classNo = args[2] || '';
            contentId = args[3] || '';
          }

          const lecNameEl = li.querySelector('.lec_name');
          const rawLecName = lecNameEl?.textContent || '';
          const matchedCourse = courses.find(c => c.course_id === courseId);
          const courseNm = matchedCourse ? matchedCourse.course_nm : cleanLecName(rawLecName);

          const subjEl = li.querySelector('.subject');
          const rawSubject = cleanText(subjEl?.textContent || '');
          const title = rawSubject.replace(/\s*(?:새로운\s+|새\s+)?글이 등록되었습니다\.?/g, '').trim();

          const dateEl = li.querySelector('.date span');
          const dateStr = cleanText(dateEl?.textContent || '');

          if (!title) return;

          if (tabClass === 'tab5') {
            const isSubmitted = completedIds.has(contentId);
            const ddayInfo = this.calculateDDay(dateStr, isSubmitted);
            const id = `${courseId}_assignment_${contentId || title}`;
            if (!assignments.some(item => item.id === id)) {
              assignments.push({
                id,
                courseId,
                courseNm,
                title,
                deadlineStr: dateStr,
                deadlineDate: ddayInfo.deadlineDate,
                statusInfo: isSubmitted ? '제출완료' : '미제출',
                isSubmitted,
                ddayBadgeText: ddayInfo.badgeText,
                badgeType: ddayInfo.badgeType,
                timeLeftText: ddayInfo.timeLeftText,
                scoreText: '배점 미공개',
                description: `마감 기한: ${dateStr}\n제출 상태: ${isSubmitted ? '제출완료' : '미제출'}`,
              });
            }
          } else if (tabClass === 'tab2') {
            const id = `${courseId}_lecture_${stripLectureProgress(title)}`;
            if (!lectures.some(item => item.id === id)) {
              const pctMatch = title.match(/(\d+)%/);
              const pct = pctMatch ? parseInt(pctMatch[1], 10) : 0;
              const isAttended = pct >= 100;
              lectures.push({
                id,
                courseId,
                courseNm,
                title,
                periodStr: dateStr,
                statusInfo: isAttended ? '출석 완료' : (pct > 0 ? `진행중 (${pct}%)` : '미수강'),
                isAttended,
                timeStr: `${pct}%`,
                progressPercent: pct,
              });
            }
          } else if (tabClass === 'tab7' || tabClass === 'tab8') {
            const isSubmitted = completedIds.has(contentId);
            const isExam = tabClass === 'tab8';
            const quizTitle = title.startsWith('[퀴즈]') || title.startsWith('[시험]')
              ? title
              : (isExam ? `[시험] ${title}` : `[퀴즈] ${title}`);
            const ddayInfo = this.calculateDDay(dateStr, isSubmitted);
            const id = `${courseId}_quiz_${contentId || title}`;
            if (!quizzes.some(item => item.id === id)) {
              quizzes.push({
                id,
                courseId,
                courseNm,
                title: quizTitle,
                deadlineStr: dateStr,
                deadlineDate: ddayInfo.deadlineDate,
                statusInfo: isSubmitted ? '제출완료' : (ddayInfo.badgeText === '마감 지남' ? '마감됨' : '미응시'),
                isSubmitted,
                ddayBadgeText: ddayInfo.badgeText,
                badgeType: ddayInfo.badgeType,
                timeLeftText: ddayInfo.timeLeftText,
                scoreText: '배점 미공개',
                description: `종료 시한: ${dateStr}\n유형: ${isExam ? '시험' : '퀴즈'}`,
              });
            }
          } else if (tabClass === 'tab4') {
            // 자료실: 교수 업로드 강의자료 (알림 대상 아님)
            const id = `${courseId}_material_${contentId || title}`;
            if (!materials.some(item => item.id === id)) {
              materials.push({ id, courseId, courseNm, title, dateStr });
            }
          } else if (tabClass === 'tab9') {
            const id = `${courseId}_board_7_${contentId || title}`;
            if (!notices.some(item => item.id === id)) {
              const cleanNoticeDate = dateStr.replace(/[()[\]]/g, '').replace(/등록일?\s*:\s*/, '').trim() || dateStr;
              notices.push({
                id,
                courseId,
                courseNm,
                boardNo: '7',
                boardItemNo: contentId,
                title,
                author: '',
                dateStr: cleanNoticeDate,
                isUrgent: isEmergencyNotice(title),
                summaryLines: [title],
                fullBody: title,
                attachments: [],
              });
            }
          }
        });
      } catch (e) {
        console.warn('DOMParser failed in parseTodoListHtml', e);
      }
    }

    // 2. Node.js 환경 또는 파서 미지원 시 정규식 Fallback
    if (
      assignments.length === 0 &&
      lectures.length === 0 &&
      quizzes.length === 0 &&
      notices.length === 0 &&
      materials.length === 0
    ) {
      const liRegex = /<li[^>]*class=[\"\x27][^\"\x27]*\b(tab\d+)\b[^\"\x27]*[\"\x27][^>]*>([\s\S]*?)<\/li>/g;
      let liMatch: RegExpExecArray | null;

      while ((liMatch = liRegex.exec(html)) !== null) {
        const tabClass = liMatch[1];
        const liBody = liMatch[2];

        const fnArgsMatch = liBody.match(/fnGoContent\s*\(([^)]+)\)/);
        let courseId = '';
        let classNo = '';
        let contentId = '';
        if (fnArgsMatch) {
          const args = fnArgsMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
          courseId = args[1] || '';
          classNo = args[2] || '';
          contentId = args[3] || '';
        }

        // 기기(DOM 경로)와 같은 값: querySelector('.lec_name' / '.subject').textContent
        const rawLecName = textContentByClass(liBody, 'lec_name') ?? '';
        const matchedCourse = courses.find(c => c.course_id === courseId);
        const courseNm = matchedCourse ? matchedCourse.course_nm : cleanLecName(rawLecName);

        const rawSubject = cleanText(textContentByClass(liBody, 'subject') ?? '');
        const title = rawSubject.replace(/\s*(?:새로운\s+|새\s+)?글이 등록되었습니다\.?/g, '').trim();

        const dateMatch = liBody.match(/<div[^>]*class=[\"\x27][^\"\x27]*\bdate\b[^\"\x27]*[\"\x27][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/);
        const dateStr = cleanText(dateMatch ? dateMatch[1].replace(/<[^>]+>/g, ' ') : '');

        if (!title) continue;

        if (tabClass === 'tab5') {
          const isSubmitted = completedIds.has(contentId);
          const ddayInfo = this.calculateDDay(dateStr, isSubmitted);
          const id = `${courseId}_assignment_${contentId || title}`;
          if (!assignments.some(item => item.id === id)) {
            assignments.push({
              id,
              courseId,
              courseNm,
              title,
              deadlineStr: dateStr,
              deadlineDate: ddayInfo.deadlineDate,
              statusInfo: isSubmitted ? '제출완료' : '미제출',
              isSubmitted,
              ddayBadgeText: ddayInfo.badgeText,
              badgeType: ddayInfo.badgeType,
              timeLeftText: ddayInfo.timeLeftText,
              scoreText: '배점 미공개',
              description: `마감 기한: ${dateStr}\n제출 상태: ${isSubmitted ? '제출완료' : '미제출'}`,
            });
          }
        } else if (tabClass === 'tab2') {
          const id = `${courseId}_lecture_${stripLectureProgress(title)}`;
          if (!lectures.some(item => item.id === id)) {
            const pctMatch = title.match(/(\d+)%/);
            const pct = pctMatch ? parseInt(pctMatch[1], 10) : 0;
            const isAttended = pct >= 100;
            lectures.push({
              id,
              courseId,
              courseNm,
              title,
              periodStr: dateStr,
              statusInfo: isAttended ? '출석 완료' : (pct > 0 ? `진행중 (${pct}%)` : '미수강'),
              isAttended,
              timeStr: `${pct}%`,
              progressPercent: pct,
            });
          }
        } else if (tabClass === 'tab7' || tabClass === 'tab8') {
          const isSubmitted = completedIds.has(contentId);
          const isExam = tabClass === 'tab8';
          const quizTitle = title.startsWith('[퀴즈]') || title.startsWith('[시험]')
            ? title
            : (isExam ? `[시험] ${title}` : `[퀴즈] ${title}`);
          const ddayInfo = this.calculateDDay(dateStr, isSubmitted);
          const id = `${courseId}_quiz_${contentId || title}`;
          if (!quizzes.some(item => item.id === id)) {
            quizzes.push({
              id,
              courseId,
              courseNm,
              title: quizTitle,
              deadlineStr: dateStr,
              deadlineDate: ddayInfo.deadlineDate,
              statusInfo: isSubmitted ? '제출완료' : (ddayInfo.badgeText === '마감 지남' ? '마감됨' : '미응시'),
              isSubmitted,
              ddayBadgeText: ddayInfo.badgeText,
              badgeType: ddayInfo.badgeType,
              timeLeftText: ddayInfo.timeLeftText,
              scoreText: '배점 미공개',
              description: `종료 시한: ${dateStr}\n유형: ${isExam ? '시험' : '퀴즈'}`,
            });
          }
        } else if (tabClass === 'tab4') {
          // 자료실: 교수 업로드 강의자료 (알림 대상 아님)
          const id = `${courseId}_material_${contentId || title}`;
          if (!materials.some(item => item.id === id)) {
            materials.push({ id, courseId, courseNm, title, dateStr });
          }
        } else if (tabClass === 'tab9') {
          const id = `${courseId}_board_7_${contentId || title}`;
          if (!notices.some(item => item.id === id)) {
            const cleanNoticeDate = dateStr.replace(/[()[\]]/g, '').replace(/등록일?\s*:\s*/, '').trim() || dateStr;
            notices.push({
              id,
              courseId,
              courseNm,
              boardNo: '7',
              boardItemNo: contentId,
              title,
              author: '',
              dateStr: cleanNoticeDate,
              isUrgent: isEmergencyNotice(title),
              summaryLines: [title],
              fullBody: title,
              attachments: [],
            });
          }
        }
      }
    }

    return { assignments, lectures, quizzes, notices, materials };
  }

  /**
   * 단 1회의 POST /lms/myLecture/doTodoList.dunet 호출로 모든 과제, 강의 진도율, 퀴즈/시험 통합 수집
   */
  public static async getTodoList(
    toDoType: string = 'all',
    courses: Course[] = [],
    options?: { checkComplete?: boolean }
  ): Promise<TodoListResult> {
    const isCompleteType = toDoType === 'complete';
    const shouldCheckComplete = options?.checkComplete ?? (toDoType === 'all');
    const [allHtml, completeHtml] = await Promise.all([
      this.getTodoListHtml(toDoType),
      shouldCheckComplete ? this.getTodoListHtml('complete').catch(() => '') : Promise.resolve(''),
    ]);

    let completedIds: Set<string>;
    if (isCompleteType) {
      completedIds = this.parseCompletedItemIds(allHtml);
    } else if (shouldCheckComplete && completeHtml) {
      completedIds = this.parseCompletedItemIds(completeHtml);
    } else {
      completedIds = new Set<string>();
    }

    return this.parseTodoListHtml(allHtml, courses, completedIds);
  }

  public static async getClassroomHtml(courseId: string, classNo: string): Promise<string> {
    const resp: HttpResponse = await HttpClient.post({
      url: `${LMS_BASE}/lms/class/classroom/doViewClassRoom.dunet`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        Origin: LMS_BASE,
        Referer: `${LMS_BASE}/lms/myLecture/doListView.dunet?mnid=${MY_LECTURE_MNID}`,
      },
      data: new URLSearchParams({
        mnid: CLASSROOM_MNID,
        course_id: courseId,
        class_no: classNo,
        change_role_no: '',
      }).toString(),
    });

    return typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
  }

  public static async getPortalNotices(): Promise<NoticeItem[]> {
    try {
      let html = LmsAuthService.getCachedMainViewHtml();
      let notices: NoticeItem[] = [];
      if (html) {
        notices = this.parsePortalNotices(html);
      }
      if (notices.length === 0) {
        const resp: HttpResponse = await HttpClient.get({
          url: `${LMS_BASE}/main/MainView.dunet`,
          headers: {
            'User-Agent': USER_AGENT,
            Referer: `${LMS_BASE}/main/MainView.dunet`,
          },
        });
        html = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
        notices = this.parsePortalNotices(html);
      }
      return notices;
    } catch (e) {
      console.warn('Failed to fetch portal notices', e);
      return [];
    }
  }

  public static parsePortalNotices(html: string): NoticeItem[] {
    const notices: NoticeItem[] = [];
    if (!html) return notices;

    // 1. DOMParser 지원 시 기본 탐색
    if (typeof DOMParser !== 'undefined') {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const pdsBoxes = doc.querySelectorAll('.learn_pds, .new_post_row .grid2_1');
        pdsBoxes.forEach(box => {
          const categoryHeader = cleanText(box.querySelector('.top h3')?.textContent || '');
          const isCtl = categoryHeader.includes('교수학습');
          const defaultBoardNo = isCtl ? '140' : '14';
          const courseNm = isCtl ? '교수학습 공지' : '이러닝 공지';

          const items = box.querySelectorAll('.cont_list li');
          items.forEach(li => {
            const a = li.querySelector('a.boardlist') || li.querySelector('a');
            const dateEl = li.querySelector('.date');
            if (!a) return;

            const idAttr = a.getAttribute('id') || '';
            const match = idAttr.match(/board(\d+)_(\d+)/);
            const boardNo = match ? match[1] : defaultBoardNo;
            const boardItemNo = match ? match[2] : '';
            const title = cleanText(a.textContent || '');
            const dateStr = cleanText(dateEl?.textContent || '');
            if (!title) return;

            const isUrgent = isEmergencyNotice(title);
            const noticeId = `PORTAL_LMS_board_${boardNo}_${boardItemNo || title}`;
            if (!notices.some(n => n.id === noticeId)) {
              notices.push({
                id: noticeId,
                courseId: 'PORTAL_LMS',
                courseNm,
                boardNo,
                boardItemNo,
                title,
                author: isCtl ? '교수학습개발센터' : 'LMS 관리자',
                dateStr,
                isUrgent,
                summaryLines: [title],
                fullBody: title,
                attachments: [],
              });
            }
          });
        });
      } catch (e) {
        console.warn('DOMParser failed in parsePortalNotices', e);
      }
    }

    // 2. 정규식 Fallback (Node 환경 또는 파서 미지원/실패 대비)
    if (notices.length === 0) {
      const regex = /<a[^>]+id=["']board(\d+)_(\d+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<span class=["']date["']>([^<]+)<\/span>/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(html)) !== null) {
        const boardNo = match[1];
        const boardItemNo = match[2];
        const title = cleanText(match[3].replace(/<[^>]+>/g, ''));
        const dateStr = cleanText(match[4]);
        if (!title) continue;

        const isCtl = boardNo === '140';
        const courseNm = isCtl ? '교수학습 공지' : '이러닝 공지';
        const isUrgent = isEmergencyNotice(title);

        const noticeId = `PORTAL_LMS_board_${boardNo}_${boardItemNo}`;
        if (!notices.some(n => n.id === noticeId)) {
          notices.push({
            id: noticeId,
            courseId: 'PORTAL_LMS',
            courseNm,
            boardNo,
            boardItemNo,
            title,
            author: isCtl ? '교수학습개발센터' : 'LMS 관리자',
            dateStr,
            isUrgent,
            summaryLines: [title],
            fullBody: title,
            attachments: [],
          });
        }
      }
    }

    return notices;
  }

  public static parseBoardItemDetailHtml(html: string): {
    title: string;
    author: string;
    date: string;
    body: string;
    attachments: string[];
  } {
    if (!html) {
      return { title: '', author: '', date: '', body: '', attachments: [] };
    }

    if (typeof DOMParser !== 'undefined') {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const table = doc.querySelector('table.table_view_basic') || doc.querySelector('table.board_view') || doc.querySelector('table');
        if (table) {
          const trs = table.querySelectorAll('tr');
          const title = cleanText(trs[0]?.textContent || '');
          const metaText = cleanText(trs[1]?.textContent || '');

          const authorMatch = metaText.match(/작성자\s*:\s*([^|]+)/);
          const author = authorMatch ? authorMatch[1].trim() : '';

          const dateMatch = metaText.match(/등록일\s*:\s*([\d\-\.\:\s]+)/);
          const date = dateMatch ? dateMatch[1].trim() : '';

          const body = (trs[2]?.textContent || '').trim();

          const attachments: string[] = [];
          if (trs.length > 3) {
            trs[3].querySelectorAll('a').forEach(a => {
              const fn = cleanText(a.textContent || '');
              if (fn && !attachments.includes(fn)) attachments.push(fn);
            });
            if (attachments.length === 0) {
              const txt = cleanText(trs[3].textContent || '');
              if (txt.includes('첨부파일')) {
                const parsed = txt.replace('첨부파일 :', '').replace('첨부파일', '').trim();
                if (parsed) attachments.push(parsed);
              }
            }
          }

          if (title || body) {
            return { title, author, date, body, attachments };
          }
        }

        const titleEl = doc.querySelector('.view_title') || doc.querySelector('h3') || doc.querySelector('.subject');
        const title = cleanText(titleEl?.textContent || '');
        const metaEl = doc.querySelector('.view_info') || doc.querySelector('.meta');
        const metaText = cleanText(metaEl?.textContent || '');
        const authorMatch = metaText.match(/작성자\s*:\s*([^|]+)/);
        const author = authorMatch ? authorMatch[1].trim() : '';
        const dateMatch = metaText.match(/등록일\s*:\s*([\d\-\.\:\s]+)/);
        const date = dateMatch ? dateMatch[1].trim() : '';
        const bodyEl = doc.querySelector('.view_cont') || doc.querySelector('.board_cont') || doc.querySelector('.content');
        const body = (bodyEl?.textContent || '').trim();

        const attachments: string[] = [];
        doc.querySelectorAll('.file_list a, a.file_down, a[href*="download"]').forEach(a => {
          const fn = cleanText(a.textContent || '');
          if (fn && !attachments.includes(fn)) attachments.push(fn);
        });

        if (title || body) {
          return { title, author, date, body, attachments };
        }
      } catch (e) {
        console.warn('DOMParser failed in parseBoardItemDetailHtml', e);
      }
    }

    // 정규식 Fallback
    const trMatches = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    let title = '';
    let author = '';
    let date = '';
    let body = '';
    const attachments: string[] = [];

    if (trMatches.length >= 3) {
      title = cleanText(trMatches[0][1].replace(/<[^>]+>/g, ''));
      const metaText = cleanText(trMatches[1][1].replace(/<[^>]+>/g, ''));
      const authorMatch = metaText.match(/작성자\s*:\s*([^|]+)/);
      if (authorMatch) author = authorMatch[1].trim();
      const dateMatch = metaText.match(/등록일\s*:\s*([\d\-\.\:\s]+)/);
      if (dateMatch) date = dateMatch[1].trim();
      body = cleanText(trMatches[2][1].replace(/<[^>]+>/g, ''));

      if (trMatches.length > 3) {
        const fileRowHtml = trMatches[3][1];
        const aMatches = [...fileRowHtml.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)];
        for (const am of aMatches) {
          const fn = cleanText(am[1].replace(/<[^>]+>/g, ''));
          if (fn && !attachments.includes(fn)) attachments.push(fn);
        }
      }
    }

    if (!title) {
      const titleMatch = html.match(/<th[^>]*>([\s\S]*?)<\/th>/i) ||
                         html.match(/<td[^>]*class=["'][^"']*subject[^"']*["'][^>]*>([\s\S]*?)<\/td>/i) ||
                         html.match(/<h\d[^>]*>([\s\S]*?)<\/h\d>/i);
      title = cleanText(titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '') : '');
    }

    if (!author) {
      const authorMatch = html.match(/작성자\s*:\s*([^<|\n]+)/);
      author = authorMatch ? cleanText(authorMatch[1]) : '';
    }

    if (!date) {
      const dateMatch = html.match(/등록일\s*:\s*([\d\-\.\:\s]+)/);
      date = dateMatch ? cleanText(dateMatch[1]) : '';
    }

    if (!body) {
      const bodyMatch = html.match(/<div[^>]*class=["'](?:board_cont|view_cont|cont)["'][^>]*>([\s\S]*?)<\/div>/i);
      body = cleanText(bodyMatch ? bodyMatch[1].replace(/<[^>]+>/g, '') : '');
    }

    if (attachments.length === 0) {
      const aMatches = [...html.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)];
      for (const am of aMatches) {
        const aHtml = am[0];
        const text = cleanText(am[1].replace(/<[^>]+>/g, ''));
        if (aHtml.includes('download') || /\.(pdf|hwp|docx?|xlsx?|pptx?|zip|png|jpe?g)/i.test(text)) {
          if (text && !attachments.includes(text)) attachments.push(text);
        }
      }
      const fileTxtMatch = html.match(/첨부파일\s*:\s*([^<\n\r]+)/);
      if (fileTxtMatch && attachments.length === 0) {
        const fn = cleanText(fileTxtMatch[1]);
        if (fn) attachments.push(fn);
      }
    }

    return { title, author, date, body, attachments };
  }

  public static async getBoardItemDetail(
    courseId: string,
    classNo: string,
    boardNo: string,
    boardItemNo: string
  ): Promise<{ title: string; author: string; date: string; body: string; attachments: string[] }> {
    if (courseId === 'PORTAL_LMS' || boardNo === '14' || boardNo === '140') {
      const mnid = boardNo === '140' ? PORTAL_CTL_MNID : PORTAL_NOTICE_MNID;
      const resp: HttpResponse = await HttpClient.post({
        url: `${LMS_BASE}/lms/front/boardItem/doViewBoardItem.dunet`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
          Origin: LMS_BASE,
          Referer: `${LMS_BASE}/main/MainView.dunet`,
        },
        data: new URLSearchParams({
          mnid,
          board_no: boardNo,
          boarditem_no: boardItemNo,
        }).toString(),
      });

      const html = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
      return this.parseBoardItemDetailHtml(html);
    }

    // 일반 강의실 공지/학습자료
    await HttpClient.post({
      url: `${LMS_BASE}/lms/class/classroom/doSetSessionClassRoom.dunet`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        Referer: `${LMS_BASE}/lms/class/classroom/doViewClassRoom.dunet`,
      },
      data: new URLSearchParams({ course_id: courseId, class_no: classNo }).toString(),
    });

    const mnid = boardNo === '7' ? NOTICE_MNID : MATERIAL_MNID;
    const resp: HttpResponse = await HttpClient.post({
      url: `${LMS_BASE}/lms/class/boardItem/doViewBoardItem.dunet`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        Origin: LMS_BASE,
        Referer: `${LMS_BASE}/lms/class/classroom/doViewClassRoom.dunet`,
      },
      data: new URLSearchParams({
        mnid,
        course_id: courseId,
        class_no: classNo,
        board_no: boardNo,
        boarditem_no: boardItemNo,
        dataType: 'C',
      }).toString(),
    });

    const html = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    return this.parseBoardItemDetailHtml(html);
  }

  public static parseClassroomItems(
    html: string,
    courseId: string,
    courseNm: string
  ): { assignments: AssignmentItem[]; lectures: LectureItem[]; notices: NoticeItem[] } {
    const parser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;
    const doc = parser ? parser.parseFromString(html, 'text/html') : null;

    const assignments: AssignmentItem[] = [];
    const lectures: LectureItem[] = [];
    const notices: NoticeItem[] = [];

    if (doc) {
      // 이번주 학습활동 (과제, 동영상 강의)
      const actNodes = doc.querySelectorAll('#lenAct .lenact_list');
      actNodes.forEach(node => {
        const subjectEl = node.querySelector('.lec_subject');
        const dateEl = node.querySelector('.date');
        const statusEl = node.querySelector('dd.lec_dotline');
        const iconEl = node.querySelector('.len_icon img');

        const title = cleanText(subjectEl?.textContent || '');
        if (!title) return;

        const alt = iconEl?.getAttribute('alt') || '';
        const isAssignment = alt.includes('과제');

        const dateStr = cleanText(dateEl?.textContent || '');
        const statusStr = cleanText(statusEl?.textContent || '');

        const btn = node.querySelector('.btn_lecture_view a');
        const onclick = btn?.getAttribute('onclick') || '';
        const actMatch = onclick.match(/fncModifyReport\('(\d+)'/);
        const actId = actMatch ? actMatch[1] : '';
        const prefix = isAssignment ? 'assignment' : 'lecture';
        const id = `${courseId}_${prefix}_${actId || title}`;

        if (isAssignment) {
          if (assignments.some(a => a.id === id)) return;
          const isSubmitted = statusStr.includes('제출') && !statusStr.includes('미제출');
          const ddayInfo = this.calculateDDay(dateStr, isSubmitted);

          assignments.push({
            id,
            courseId,
            courseNm,
            title,
            deadlineStr: dateStr,
            deadlineDate: ddayInfo.deadlineDate,
            statusInfo: statusStr || (isSubmitted ? '제출완료' : '미제출'),
            isSubmitted,
            ddayBadgeText: ddayInfo.badgeText,
            badgeType: ddayInfo.badgeType,
            timeLeftText: ddayInfo.timeLeftText,
            scoreText: '배점 미공개',
            description: `마감 기한: ${dateStr}\n제출 상태: ${statusStr}`,
          });
        } else {
          if (lectures.some(l => l.id === id)) return;
          const isAttended = statusStr.includes('출석') || statusStr.includes('100%');
          const percentMatch = statusStr.match(/(\d+)%/);
          const percent = percentMatch ? parseInt(percentMatch[1], 10) : isAttended ? 100 : 0;

          lectures.push({
            id,
            courseId,
            courseNm,
            title,
            periodStr: dateStr,
            statusInfo: statusStr,
            isAttended,
            timeStr: statusStr,
            progressPercent: percent,
          });
        }
      });

      // 최근 7일 공지 및 학습자료
      const actRows = doc.querySelectorAll('.std_act_box .act_row');
      actRows.forEach(node => {
        const subj = node.querySelector('.subject');
        const timeEl = node.querySelector('.time');
        const fileEl = node.querySelector('.file_down');

        const title = cleanText(subj?.textContent || '');
        if (!title) return;

        const href = subj?.getAttribute('href') || '';
        const linkMatch = href.match(/fncBoardItemViewGo\('(\d+)',\s*'(\d+)'\)/);
        const boardNo = linkMatch ? linkMatch[1] : '';
        const boardItemNo = linkMatch ? linkMatch[2] : '';

        const timeStr = cleanText(timeEl?.textContent || '');
        const fileName = cleanText(fileEl?.textContent || '');
        const isUrgent = isEmergencyNotice(title);

        const noticeId = boardNo && boardItemNo ? `${courseId}_board_${boardNo}_${boardItemNo}` : `${courseId}_notice_${title}`;
        if (notices.some(n => n.id === noticeId)) return;

        notices.push({
          id: noticeId,
          courseId,
          courseNm,
          boardNo,
          boardItemNo,
          title,
          author: '',
          dateStr: timeStr,
          isUrgent,
          summaryLines: [title],
          fullBody: title,
          attachments: fileName ? [fileName] : [],
        });
      });
    }

    return { assignments, lectures, notices };
  }
}
