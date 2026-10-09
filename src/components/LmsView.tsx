import React, { useEffect, useMemo, useState } from 'react';
import { RotateCw, ChevronDown, CheckCircle, FolderOpen, Search, X } from 'lucide-react';
import { AppStateData, AssignmentItem, NoticeItem } from '../types';
import { SubjectChips } from './SubjectChips';
import { AssignmentCard } from './AssignmentCard';
import { LectureCard } from './LectureCard';
import { NoticeCard } from './NoticeCard';
import { parseNoticeDate } from '../utils/date';
import { isActiveAssignment, isActiveLecture } from '../utils/lmsItems';
import { parseLectureDeadline } from '../services/lmsScraper';
import { useNow } from '../hooks/useNow';
import { HeaderIconButton, HeaderTabs, HeaderTitleRow } from './TabHeader';

export type LmsSubTab = 'assignments' | 'lectures' | 'notices' | 'materials';

interface LmsViewProps {
  state: AppStateData;
  subTab: LmsSubTab;
  onSubTabChange: (sub: LmsSubTab) => void;
  readNoticeIds: Set<string>;
  onOpenAssignment: (a: AssignmentItem) => void;
  onOpenNotice: (n: NoticeItem) => void;
  onMarkAllRead: () => void;
  /** 검색어 (null = 검색 닫힘) */
  query: string | null;
}

/** 제목·과목명에서 찾기: 띄어 쓴 낱말이 모두 들어 있으면 일치 (대소문자·띄어쓰기 무시) */
const normalize = (s: string) => (s || '').toLowerCase().replace(/\s+/g, '');
export function matchesQuery(item: { title: string; courseNm: string }, query: string): boolean {
  const haystack = normalize(`${item.title} ${item.courseNm}`);
  return (query || '')
    .split(/\s+/)
    .map(normalize)
    .filter(Boolean)
    .every(term => haystack.includes(term));
}

const EmptyBox: React.FC<{ text: string }> = ({ text }) => (
  <div className="p-8 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
    <p className="text-xs font-bold text-zinc-600 dark:text-zinc-300">{text}</p>
  </div>
);

/** 진행 중 목록 아래에 접어 두는 "지난 항목" 영역 */
const PastSection: React.FC<{ count: number; forceOpen?: boolean; children: React.ReactNode }> = ({
  count,
  forceOpen,
  children,
}) => {
  const [userOpen, setOpen] = useState(false);
  const open = userOpen || !!forceOpen; // 검색 중에는 지난 항목도 펼쳐서 보여 줌
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

/** LMS 상단 바: 제목(또는 검색창) · 검색 · 새로고침 · 하위 탭 */
export const LmsHeader: React.FC<{
  state: AppStateData;
  subTab: LmsSubTab;
  onSubTabChange: (sub: LmsSubTab) => void;
  readNoticeIds: Set<string>;
  query: string | null;
  onQueryChange: (q: string | null) => void;
  isSyncing: boolean;
  onSync: () => void;
}> = ({ state, subTab, onSubTabChange, readNoticeIds, query, onQueryChange, isSyncing, onSync }) => {
  const nowMs = useNow().getTime();
  const badgeFor = (id: LmsSubTab): number => {
    if (id === 'assignments') return state.assignments.filter(a => isActiveAssignment(a, nowMs)).length;
    if (id === 'lectures') return state.lectures.filter(l => isActiveLecture(l, nowMs)).length;
    if (id === 'notices') return state.notices.filter(n => !readNoticeIds.has(n.id)).length;
    return 0;
  };

  return (
    <>
      {query !== null ? (
        <div className="flex items-center gap-2 min-h-[60px] py-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              autoFocus
              type="text"
              enterKeyHint="search"
              aria-label="LMS 검색어"
              value={query}
              onChange={e => onQueryChange(e.target.value)}
              placeholder="과제·강의·공지·자료 제목이나 과목명"
              className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-xl pl-9 pr-9 py-2.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-hs-400"
            />
            {query.trim() && (
              <button
                onClick={() => onQueryChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400"
                aria-label="검색어 지우기"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => onQueryChange(null)}
            className="px-1 py-2 text-xs font-bold text-zinc-600 dark:text-zinc-300 whitespace-nowrap"
          >
            닫기
          </button>
        </div>
      ) : (
        <HeaderTitleRow title="LMS" subtitle={state.lastSyncTime ? `${state.lastSyncTime} 동기화` : undefined}>
          <HeaderIconButton label="LMS 검색" onClick={() => onQueryChange('')}>
            <Search className="w-5 h-5" />
          </HeaderIconButton>
          <HeaderIconButton label="LMS 새로고침" onClick={onSync} disabled={isSyncing}>
            <RotateCw className={`w-5 h-5 ${isSyncing ? 'animate-spin' : ''}`} />
          </HeaderIconButton>
        </HeaderTitleRow>
      )}
      <HeaderTabs
        tabs={SUB_TABS.map(t => ({ ...t, badge: badgeFor(t.id) }))}
        active={subTab}
        onChange={onSubTabChange}
      />
    </>
  );
};

export const LmsView: React.FC<LmsViewProps> = ({
  state,
  subTab,
  onSubTabChange,
  readNoticeIds,
  onOpenAssignment,
  onOpenNotice,
  onMarkAllRead,
  query,
}) => {
  const q = (query || '').trim();
  // 과목 필터는 서브탭이 바뀔 때마다(다른 화면에서 이동해 온 경우 포함) "전체"로 초기화
  const [selectedSubject, setSelectedSubject] = useState('전체');
  useEffect(() => setSelectedSubject('전체'), [subTab]);
  const changeSubTab = (sub: LmsSubTab) => onSubTabChange(sub);

  const subjectList = useMemo(
    () => ['전체', ...Array.from(new Set(state.courses.map(c => c.course_nm)))],
    [state.courses]
  );
  const bySubject = <T extends { courseNm: string; title: string }>(items: T[]) =>
    (selectedSubject === '전체' ? items : items.filter(i => i.courseNm.includes(selectedSubject))).filter(
      i => !q || matchesQuery(i, q)
    );

  const nowMs = useNow().getTime();
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

  // 검색 중: 하위 탭별 결과 수 (다른 탭에 있는 결과로 바로 이동)
  const resultCounts: Record<LmsSubTab, number> = {
    assignments: assignments.length,
    lectures: lectures.length,
    notices: filteredNotices.length,
    materials: materials.length,
  };

  return (
    <div className="space-y-3.5">
      {/* 검색 중: 하위 탭별 결과 수 */}
      {q && (
        <div className="flex flex-wrap gap-1.5 px-0.5">
          {SUB_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => changeSubTab(t.id)}
              className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                subTab === t.id
                  ? 'bg-hs-700 dark:bg-hs-500 text-white'
                  : resultCounts[t.id] > 0
                  ? 'bg-hs-50 dark:bg-hs-950/60 text-hs-700 dark:text-hs-300'
                  : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-400'
              }`}
            >
              {t.label} {resultCounts[t.id]}
            </button>
          ))}
        </div>
      )}

      <SubjectChips subjects={subjectList} selectedSubject={selectedSubject} onSelectSubject={setSelectedSubject} />

      {subTab === 'assignments' && (
        <div className="space-y-2.5">
          {activeAssignments.length === 0 ? (
            <EmptyBox
              text={
                q
                  ? pastAssignments.length > 0
                    ? '진행 중인 항목 중에는 결과가 없어요.'
                    : '검색 결과가 없어요.'
                  : state.courses.length === 0
                  ? 'LMS 동기화를 진행해주세요.'
                  : '진행 중인 과제·퀴즈가 없습니다.'
              }
            />
          ) : (
            activeAssignments.map(item => (
              <AssignmentCard key={item.id} item={item} onClick={() => onOpenAssignment(item)} />
            ))
          )}
          <PastSection count={pastAssignments.length} forceOpen={!!q}>
            {pastAssignments.map(item => (
              <AssignmentCard key={item.id} item={item} onClick={() => onOpenAssignment(item)} />
            ))}
          </PastSection>
        </div>
      )}

      {subTab === 'lectures' && (
        <div className="space-y-2.5">
          {activeLectures.length === 0 ? (
            <EmptyBox
              text={q ? (pastLectures.length > 0 ? '진행 중인 강의 중에는 결과가 없어요.' : '검색 결과가 없어요.') : '수강할 온라인 강의가 없습니다.'}
            />
          ) : (
            activeLectures.map(item => <LectureCard key={item.id} item={item} />)
          )}
          <PastSection count={pastLectures.length} forceOpen={!!q}>
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
            <EmptyBox text={q ? '검색 결과가 없어요.' : '공지사항이 없습니다.'} />
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
            <EmptyBox text={q ? '검색 결과가 없어요.' : '자료실에 올라온 자료가 없습니다.'} />
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
