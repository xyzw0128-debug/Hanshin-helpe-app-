import { AssignmentItem, LectureItem } from '../types';
import { parseLectureDeadline } from '../services/lmsScraper';

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
