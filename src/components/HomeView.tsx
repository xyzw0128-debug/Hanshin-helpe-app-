import React, { useMemo } from 'react';
import {
  RotateCw,
  Clock,
  MapPin,
  CalendarX,
  ChevronRight,
  FileText,
  PlayCircle,
  HelpCircle,
  Award,
  SlidersHorizontal,
} from 'lucide-react';
import { AppStateData, AssignmentItem, HomeCardSetting, NoticeItem } from '../types';
import { CampusQuickHub } from './CampusQuickHub';
import { mergeDayTimetable, SUBJECT_PALETTE } from './AcademicView';
import { parseLectureDeadline, stripLectureProgress } from '../services/lmsScraper';
import { formatDeadlineBadge, formatTodayLabel, parseNoticeDate } from '../utils/date';
import { isActiveAssignment, isActiveLecture, isQuizItem } from '../utils/lmsItems';

export type HomeNavigateTarget =
  | { tab: 'lms'; sub: 'assignments' | 'lectures' | 'notices' | 'materials' }
  | { tab: 'academics'; sub?: 'timetable' | 'graduation' | 'grades' };

interface HomeViewProps {
  state: AppStateData;
  cards: HomeCardSetting[];
  displayName: string;
  isSyncing: boolean;
  onSync: () => void;
  readNoticeIds: Set<string>;
  onOpenAssignment: (a: AssignmentItem) => void;
  onOpenNotice: (n: NoticeItem) => void;
  onNavigate: (target: HomeNavigateTarget) => void;
  onEditHome: () => void;
}

const cardClass =
  'bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl p-3.5 shadow-sm';

const CardTitle: React.FC<{ title: string; action?: { label: string; onClick: () => void } }> = ({ title, action }) => (
  <div className="flex items-center justify-between mb-2.5 px-0.5">
    <h3 className="text-xs font-black text-zinc-900 dark:text-zinc-100">{title}</h3>
    {action && (
      <button onClick={action.onClick} className="text-xs font-bold text-hs-700 dark:text-hs-300 flex items-center">
        {action.label}
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    )}
  </div>
);

const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

export const HomeView: React.FC<HomeViewProps> = ({
  state,
  cards,
  displayName,
  isSyncing,
  onSync,
  readNoticeIds,
  onOpenAssignment,
  onOpenNotice,
  onNavigate,
  onEditHome,
}) => {
  const now = new Date();
  const nowMs = now.getTime();

  // 오늘 수업 (토·일 포함 요일 기준, 시간 미지정 과목 제외)
  const todayClasses = useMemo(() => {
    const day = new Date().getDay();
    const items = (state.academicData?.timetable || []).filter(t => !t.unscheduled && t.dayOfWeek === day);
    return mergeDayTimetable(items);
  }, [state.academicData?.timetable]);

  // 마감 임박: 과제·퀴즈 + 온라인 강의를 마감 순으로
  const deadlines = useMemo(() => {
    const t = Date.now();
    const list: Array<
      | { kind: 'assignment'; key: string; deadlineMs: number; item: AssignmentItem }
      | { kind: 'lecture'; key: string; deadlineMs: number; courseNm: string; title: string }
    > = [];
    for (const a of state.assignments) {
      if (isActiveAssignment(a, t) && a.deadlineDate) {
        list.push({ kind: 'assignment', key: a.id, deadlineMs: new Date(a.deadlineDate).getTime(), item: a });
      }
    }
    for (const l of state.lectures) {
      const ms = parseLectureDeadline(l.periodStr);
      if (isActiveLecture(l, t) && ms !== Infinity) {
        list.push({ kind: 'lecture', key: l.id, deadlineMs: ms, courseNm: l.courseNm, title: stripLectureProgress(l.title) });
      }
    }
    return list.sort((a, b) => a.deadlineMs - b.deadlineMs).slice(0, 5);
  }, [state.assignments, state.lectures]);

  const pendingAssignments = state.assignments.filter(a => isActiveAssignment(a, nowMs)).length;
  const pendingLectures = state.lectures.filter(l => isActiveLecture(l, nowMs)).length;
  const unreadNotices = state.notices.filter(n => !readNoticeIds.has(n.id)).length;

  const recentNotices = useMemo(
    () => [...state.notices].sort((a, b) => parseNoticeDate(b.dateStr) - parseNoticeDate(a.dateStr)).slice(0, 3),
    [state.notices]
  );
  const urgentNotice = state.notices.find(n => n.isUrgent);
  const graduation = state.academicData?.graduation;

  const renderCard = (id: HomeCardSetting['id']) => {
    switch (id) {
      case 'todayClasses': {
        const nowMin = minutesOfDay(now);
        const nextIdx = todayClasses.findIndex(c => c.endMinutes > nowMin);
        return (
          <div key={id} className={cardClass}>
            <CardTitle title="오늘 수업" action={{ label: '시간표', onClick: () => onNavigate({ tab: 'academics', sub: 'timetable' }) }} />
            {!state.academicData ? (
              <button
                onClick={() => onNavigate({ tab: 'academics', sub: 'timetable' })}
                className="w-full py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl"
              >
                학사 탭에서 시간표를 불러오면 여기에 표시됩니다
              </button>
            ) : todayClasses.length === 0 ? (
              <div className="py-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                <CalendarX className="w-4 h-4" /> 오늘은 수업이 없습니다
              </div>
            ) : (
              <div className="space-y-1.5">
                {todayClasses.map((c, idx) => {
                  const done = c.endMinutes <= nowMin;
                  const ongoing = c.startMinutes <= nowMin && nowMin < c.endMinutes;
                  const isNext = idx === nextIdx;
                  const color = SUBJECT_PALETTE[(c.colorIndex ?? 0) % SUBJECT_PALETTE.length].bg;
                  const minsLeft = c.startMinutes - nowMin;
                  return (
                    <div
                      key={c.id}
                      className={`flex items-center gap-2.5 p-2 rounded-xl ${
                        isNext ? 'bg-hs-50 dark:bg-hs-950/50' : ''
                      } ${done ? 'opacity-50' : ''}`}
                    >
                      <span className="w-1 self-stretch rounded-full" style={{ backgroundColor: color }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-zinc-900 dark:text-white truncate">{c.subjectNm}</div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                          <span className="flex items-center gap-0.5">
                            <Clock className="w-3 h-3" />
                            {c.startTime}–{c.endTime}
                          </span>
                          {c.classroom && (
                            <span className="flex items-center gap-0.5">
                              <MapPin className="w-3 h-3" />
                              {c.classroom}
                            </span>
                          )}
                        </div>
                      </div>
                      {isNext && (
                        <span className="text-[11px] font-black text-hs-700 dark:text-hs-300 whitespace-nowrap">
                          {ongoing
                            ? '수업 중'
                            : minsLeft >= 60
                            ? `${Math.floor(minsLeft / 60)}시간 ${minsLeft % 60}분 후`
                            : `${minsLeft}분 후`}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      }

      case 'quickHub':
        return <CampusQuickHub key={id} />;

      case 'summaryChips': {
        const chips = [
          { label: '미제출 과제', value: pendingAssignments, color: 'text-red-600 dark:text-red-400', onClick: () => onNavigate({ tab: 'lms', sub: 'assignments' }) },
          { label: '미수강 강의', value: pendingLectures, color: 'text-amber-600 dark:text-amber-400', onClick: () => onNavigate({ tab: 'lms', sub: 'lectures' }) },
          { label: '안 읽은 공지', value: unreadNotices, color: 'text-hs-700 dark:text-hs-300', onClick: () => onNavigate({ tab: 'lms', sub: 'notices' }) },
        ];
        return (
          <div key={id} className="grid grid-cols-3 gap-2">
            {chips.map(chip => (
              <button
                key={chip.label}
                onClick={chip.onClick}
                className="py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl shadow-sm active:scale-95 transition-transform"
              >
                <span className={`block text-lg font-black leading-tight ${chip.color}`}>{chip.value}</span>
                <span className="block text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">{chip.label}</span>
              </button>
            ))}
          </div>
        );
      }

      case 'deadlines':
        return (
          <div key={id} className={cardClass}>
            <CardTitle title="마감 임박" action={{ label: '전체', onClick: () => onNavigate({ tab: 'lms', sub: 'assignments' }) }} />
            {deadlines.length === 0 ? (
              <div className="py-3 text-center text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                다가오는 마감이 없습니다
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {deadlines.map(d => {
                  const badge = formatDeadlineBadge(d.deadlineMs);
                  const isLecture = d.kind === 'lecture';
                  const quiz = d.kind === 'assignment' && isQuizItem(d.item);
                  const Icon = isLecture ? PlayCircle : quiz ? HelpCircle : FileText;
                  return (
                    <button
                      key={d.key}
                      onClick={() =>
                        d.kind === 'assignment' ? onOpenAssignment(d.item) : onNavigate({ tab: 'lms', sub: 'lectures' })
                      }
                      className="w-full flex items-center gap-2.5 py-2 text-left"
                    >
                      <Icon className="w-4 h-4 flex-shrink-0 text-zinc-400" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-hs-700 dark:text-hs-300 truncate">
                          {d.kind === 'assignment' ? d.item.courseNm : d.courseNm}
                        </div>
                        <div className="text-xs font-bold text-zinc-900 dark:text-white truncate">
                          {d.kind === 'assignment' ? d.item.title : d.title}
                        </div>
                      </div>
                      <span
                        className={`flex-shrink-0 px-2 py-0.5 rounded-lg text-[11px] font-black ${
                          badge.urgent
                            ? 'bg-red-600 text-white'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        {badge.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );

      case 'recentNotices':
        return (
          <div key={id} className={cardClass}>
            <CardTitle title="최근 공지" action={{ label: '전체', onClick: () => onNavigate({ tab: 'lms', sub: 'notices' }) }} />
            {recentNotices.length === 0 ? (
              <div className="py-3 text-center text-xs font-semibold text-zinc-500 dark:text-zinc-400">공지사항이 없습니다</div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {recentNotices.map(n => {
                  const unread = !readNoticeIds.has(n.id);
                  return (
                    <button key={n.id} onClick={() => onOpenNotice(n)} className="w-full py-2 text-left">
                      <div className="text-[11px] font-semibold text-hs-700 dark:text-hs-300 truncate">{n.courseNm}</div>
                      <div
                        className={`text-xs truncate flex items-center gap-1.5 ${
                          unread ? 'font-bold text-zinc-900 dark:text-white' : 'font-medium text-zinc-500 dark:text-zinc-400'
                        }`}
                      >
                        {unread && <span className="w-1.5 h-1.5 rounded-full bg-hs-600 flex-shrink-0" />}
                        {n.title}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );

      case 'graduation':
        return (
          <button
            key={id}
            onClick={() => onNavigate({ tab: 'academics', sub: 'graduation' })}
            className={`${cardClass} w-full text-left space-y-2`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Award className="w-4 h-4 text-hs-700 dark:text-hs-400" /> 졸업 학점
              </span>
              {graduation && (
                <span className="text-xs font-bold text-hs-700 dark:text-hs-300">
                  {graduation.totalAcquiredCredits}/{graduation.totalRequiredCredits}학점 · {graduation.completionPercent}%
                </span>
              )}
            </div>
            {graduation ? (
              <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-hs-600 to-emerald-500 h-full rounded-full"
                  style={{ width: `${Math.min(100, graduation.completionPercent)}%` }}
                />
              </div>
            ) : (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">학사 탭에서 졸업 학점을 불러오면 표시됩니다</p>
            )}
          </button>
        );

      case 'urgentNotice':
        return urgentNotice ? (
          <button
            key={id}
            onClick={() => onOpenNotice(urgentNotice)}
            className="w-full text-left p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-2xl"
          >
            <div className="text-[11px] font-black text-red-600 dark:text-red-400">긴급 공지 · {urgentNotice.courseNm}</div>
            <div className="text-xs font-bold text-zinc-900 dark:text-white truncate mt-0.5">{urgentNotice.title}</div>
          </button>
        ) : null;

      default:
        return null;
    }
  };

  return (
    <div className="space-y-3.5">
      {/* 상단: 인사 · 오늘 날짜 · 새로고침 */}
      <div className="flex items-start justify-between pt-1 px-0.5">
        <div>
          <h1 className="text-lg font-black text-zinc-900 dark:text-white tracking-tight">{displayName}님, 안녕하세요</h1>
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mt-0.5">{formatTodayLabel(now)}</p>
        </div>
        <button
          onClick={onSync}
          disabled={isSyncing}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-60"
          aria-label="LMS 새로고침"
        >
          <RotateCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          {state.lastSyncTime || '동기화'}
        </button>
      </div>

      {cards.filter(c => c.enabled).map(c => renderCard(c.id))}

      <button
        onClick={onEditHome}
        className="w-full py-2.5 flex items-center justify-center gap-1.5 text-xs font-bold text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
        홈 편집
      </button>
    </div>
  );
};
