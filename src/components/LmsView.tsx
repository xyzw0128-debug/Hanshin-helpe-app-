import React, { useEffect, useMemo, useState } from 'react';
import { RotateCw, ChevronDown, CheckCircle, FolderOpen } from 'lucide-react';
import { AppStateData, AssignmentItem, NoticeItem } from '../types';
import { SubjectChips } from './SubjectChips';
import { AssignmentCard } from './AssignmentCard';
import { LectureCard } from './LectureCard';
import { NoticeCard } from './NoticeCard';
import { parseNoticeDate } from '../utils/date';
import { isActiveAssignment, isActiveLecture } from '../utils/lmsItems';
import { parseLectureDeadline } from '../services/lmsScraper';

export type LmsSubTab = 'assignments' | 'lectures' | 'notices' | 'materials';

interface LmsViewProps {
  state: AppStateData;
  subTab: LmsSubTab;
  onSubTabChange: (sub: LmsSubTab) => void;
  isSyncing: boolean;
  onSync: () => void;
  readNoticeIds: Set<string>;
  onOpenAssignment: (a: AssignmentItem) => void;
  onOpenNotice: (n: NoticeItem) => void;
  onMarkAllRead: () => void;
}

const EmptyBox: React.FC<{ text: string }> = ({ text }) => (
  <div className="p-8 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
    <p className="text-xs font-bold text-zinc-600 dark:text-zinc-300">{text}</p>
  </div>
);

/** 진행 중 목록 아래에 접어 두는 "지난 항목" 영역 */
const PastSection: React.FC<{ count: number; children: React.ReactNode }> = ({ count, children }) => {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <div className="space-y-2.5">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-1 py-1.5 text-xs font-bold text-zinc-500 dark:text-zinc-400"
      >
        <span>지난 항목 ({count})</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="space-y-2.5 opacity-90">{children}</div>}
    </div>
  );
};

const SUB_TABS: Array<{ id: LmsSubTab; label: string }> = [
  { id: 'assignments', label: '과제·퀴즈' },
  { id: 'lectures', label: '온라인 강의' },
  { id: 'notices', label: '공지' },
  { id: 'materials', label: '자료실' },
];

export const LmsView: React.FC<LmsViewProps> = ({
  state,
  subTab,
  onSubTabChange,
  isSyncing,
  onSync,
  readNoticeIds,
  onOpenAssignment,
  onOpenNotice,
  onMarkAllRead,
}) => {
  // 과목 필터는 서브탭이 바뀔 때마다(다른 화면에서 이동해 온 경우 포함) "전체"로 초기화
  const [selectedSubject, setSelectedSubject] = useState('전체');
  useEffect(() => setSelectedSubject('전체'), [subTab]);
  const changeSubTab = (sub: LmsSubTab) => onSubTabChange(sub);

  const subjectList = useMemo(
    () => ['전체', ...Array.from(new Set(state.courses.map(c => c.course_nm)))],
    [state.courses]
  );
  const bySubject = <T extends { courseNm: string }>(items: T[]) =>
    selectedSubject === '전체' ? items : items.filter(i => i.courseNm.includes(selectedSubject));

  const nowMs = Date.now();
  const assignments = bySubject(state.assignments);
  const activeAssignments = assignments.filter(a => isActiveAssignment(a, nowMs));
  const pastAssignments = assignments.filter(a => !isActiveAssignment(a, nowMs));

  const lectures = bySubject(state.lectures);
  const activeLectures = lectures.filter(l => isActiveLecture(l, nowMs));
  const pastLectures = lectures.filter(l => !isActiveLecture(l, nowMs));

  const notices = useMemo(
    () => [...state.notices].sort((a, b) => parseNoticeDate(b.dateStr) - parseNoticeDate(a.dateStr)),
    [state.notices]
  );
  const filteredNotices = bySubject(notices);
  const unreadCount = state.notices.filter(n => !readNoticeIds.has(n.id)).length;

  const materials = bySubject(state.materials || []);

  const badgeFor = (id: LmsSubTab): number => {
    if (id === 'assignments') return state.assignments.filter(a => isActiveAssignment(a, nowMs)).length;
    if (id === 'lectures') return state.lectures.filter(l => isActiveLecture(l, nowMs)).length;
    if (id === 'notices') return unreadCount;
    return 0;
  };

  return (
    <div className="space-y-3.5">
      {/* 상단: 서브탭 + 새로고침 */}
      <div className="flex items-center gap-1.5">
        <div className="flex-1 flex p-1 pt-1.5 bg-zinc-200/80 dark:bg-zinc-900 rounded-2xl font-bold">
          {SUB_TABS.map(t => {
            const badge = badgeFor(t.id);
            return (
              <button
                key={t.id}
                onClick={() => changeSubTab(t.id)}
                className={`relative flex-1 py-2 rounded-xl transition-all text-center whitespace-nowrap text-[11.5px] ${
                  subTab === t.id
                    ? 'bg-white dark:bg-zinc-800 text-hs-700 dark:text-hs-300 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                {t.label}
                {badge > 0 && (
                  <span className="absolute -top-1 right-0.5 min-w-[16px] px-1 bg-hs-700 dark:bg-hs-500 text-white rounded-full text-[9px] font-black leading-[15px]">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          onClick={onSync}
          disabled={isSyncing}
          className="p-2 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 disabled:opacity-60"
          aria-label="LMS 새로고침"
        >
          <RotateCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <SubjectChips subjects={subjectList} selectedSubject={selectedSubject} onSelectSubject={setSelectedSubject} />

      {subTab === 'assignments' && (
        <div className="space-y-2.5">
          {activeAssignments.length === 0 ? (
            <EmptyBox text={state.courses.length === 0 ? 'LMS 동기화를 진행해주세요.' : '진행 중인 과제·퀴즈가 없습니다.'} />
          ) : (
            activeAssignments.map(item => (
              <AssignmentCard key={item.id} item={item} onClick={() => onOpenAssignment(item)} />
            ))
          )}
          <PastSection count={pastAssignments.length}>
            {pastAssignments.map(item => (
              <AssignmentCard key={item.id} item={item} onClick={() => onOpenAssignment(item)} />
            ))}
          </PastSection>
        </div>
      )}

      {subTab === 'lectures' && (
        <div className="space-y-2.5">
          {activeLectures.length === 0 ? (
            <EmptyBox text="수강할 온라인 강의가 없습니다." />
          ) : (
            activeLectures.map(item => <LectureCard key={item.id} item={item} />)
          )}
          <PastSection count={pastLectures.length}>
            {pastLectures.map(item => (
              <LectureCard key={item.id} item={item} />
            ))}
          </PastSection>
        </div>
      )}

      {subTab === 'notices' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs px-1">
            <span className="text-zinc-500 font-semibold">최신 날짜순</span>
            <button
              onClick={onMarkAllRead}
              disabled={unreadCount === 0}
              className="text-xs font-bold text-hs-700 dark:text-hs-200 bg-hs-100 dark:bg-hs-900 px-2 py-0.5 rounded-full flex items-center gap-1 active:scale-95 transition-all disabled:opacity-40"
            >
              <CheckCircle className="w-3 h-3" />
              모두 읽음
            </button>
          </div>
          {filteredNotices.length === 0 ? (
            <EmptyBox text="공지사항이 없습니다." />
          ) : (
            filteredNotices.map(item => (
              <NoticeCard
                key={item.id}
                item={item}
                isRead={readNoticeIds.has(item.id)}
                onClick={() => onOpenNotice(item)}
              />
            ))
          )}
        </div>
      )}

      {subTab === 'materials' && (
        <div className="space-y-2">
          {materials.length === 0 ? (
            <EmptyBox text="자료실에 올라온 자료가 없습니다." />
          ) : (
            materials.map(m => (
              <div
                key={m.id}
                className="flex items-start gap-3 p-3.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm"
              >
                <FolderOpen className="w-4 h-4 mt-0.5 flex-shrink-0 text-hs-700 dark:text-hs-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-hs-700 dark:text-hs-300 truncate">{m.courseNm}</div>
                  <div className="text-sm font-bold text-zinc-900 dark:text-white leading-snug">{m.title}</div>
                  {parseLectureDeadline(m.dateStr) > nowMs && parseLectureDeadline(m.dateStr) !== Infinity && (
                    <div className="text-[11px] text-zinc-400 mt-0.5">
                      {m.dateStr.replace(/[()]/g, '').replace(/종료시한\s*:\s*/, '열람 기한 ')}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          <p className="text-[11px] text-zinc-400 text-center pt-1">자료 파일은 LMS 웹사이트의 강의실에서 받을 수 있습니다</p>
        </div>
      )}
    </div>
  );
};
