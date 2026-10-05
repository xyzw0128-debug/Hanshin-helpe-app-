import { AssignmentItem, LectureItem } from '../types';
import { parseLectureDeadline, stripLectureProgress } from '../services/lmsScraper';
import type { ReminderItem } from '../services/backgroundSync';

/** 진행 중인 과제·퀴즈: 미제출이면서 마감이 지나지 않았거나 마감일이 없는 항목 */
export function isActiveAssignment(a: AssignmentItem, nowMs: number = Date.now()): boolean {
  if (a.isSubmitted) return false;
  if (!a.deadlineDate) return true;
  return new Date(a.deadlineDate).getTime() > nowMs;
}

/** 진행 중인 온라인 강의: 미수강이면서 학습 기간이 끝나지 않은 항목 */
export function isActiveLecture(l: LectureItem, nowMs: number = Date.now()): boolean {
  if (l.isAttended) return false;
  return parseLectureDeadline(l.periodStr) > nowMs;
}

export function isQuizItem(a: AssignmentItem): boolean {
  return a.title.startsWith('[퀴즈]') || a.title.startsWith('[시험]');
}

/**
 * 마감 알림 대상: 미제출 과제·퀴즈와 미수강 온라인 강의 중 마감이 남은 것
 * (백그라운드 워커는 완료 목록에 오른 항목을 빼고, 새로 본 항목을 더한다)
 */
export function buildReminderItems(
  assignments: AssignmentItem[],
  lectures: LectureItem[],
  nowMs: number = Date.now()
): ReminderItem[] {
  const items: ReminderItem[] = [];
  for (const a of assignments) {
    const ms = a.deadlineDate ? new Date(a.deadlineDate).getTime() : NaN;
    if (a.isSubmitted || isNaN(ms) || ms <= nowMs) continue;
    items.push({
      id: a.id,
      kind: isQuizItem(a) ? 'quiz' : 'assignment',
      courseNm: a.courseNm,
      title: a.title,
      deadlineStr: a.deadlineStr,
      deadlineMs: ms,
    });
  }
  for (const l of lectures) {
    const ms = parseLectureDeadline(l.periodStr);
    if (l.isAttended || ms === Infinity || ms <= nowMs) continue;
    items.push({
      id: l.id,
      kind: 'lecture',
      courseNm: l.courseNm,
      title: stripLectureProgress(l.title),
      deadlineStr: l.periodStr,
      deadlineMs: ms,
    });
  }
  return items;
}
