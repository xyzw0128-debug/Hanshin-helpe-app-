import React, { useState, useEffect, useMemo } from 'react';
import {
  GraduationCap,
  Award,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  BookOpen,
  MapPin,
  TrendingUp,
  Clock,
  X,
  EyeOff,
} from 'lucide-react';
import { AcademicData, SemesterGrade, TimetableItem } from '../types';
import { SUBJECT_PALETTE, MergedTimetableItem, mergeDayTimetable, parseClassMinutes } from '../utils/timetable';

// 기존 import 경로 호환용 재내보내기
export { SUBJECT_PALETTE, mergeDayTimetable } from '../utils/timetable';
export type { TimetablePaletteColor, MergedTimetableItem } from '../utils/timetable';

export type AcademicSection = 'timetable' | 'graduation' | 'grades';

interface AcademicViewProps {
  academicData?: AcademicData;
  isLoading: boolean;
  onRefresh: () => void;
  section: AcademicSection;
  onSectionChange: (section: AcademicSection) => void;
  hideGrades?: boolean; // 성적 화면 평점 가리기 (눌러야 표시)
}

export const AcademicView: React.FC<AcademicViewProps> = ({
  academicData,
  isLoading,
  onRefresh,
  section,
  onSectionChange,
  hideGrades,
}) => {
  const activeSection = section;
  const setActiveSection = onSectionChange;
  const [gradesRevealed, setGradesRevealed] = useState(false);
  const gradesHidden = hideGrades !== false && !gradesRevealed;
  const [timetableViewMode, setTimetableViewMode] = useState<'grid' | 'daily'>('grid');
  const [expandedSemester, setExpandedSemester] = useState<string | null>(() => {
    return academicData?.gradeSummary?.semesters[0]
      ? `${academicData.gradeSummary.semesters[0].year}-${academicData.gradeSummary.semesters[0].semester}`
      : null;
  });

  // academicData가 로드된 후 최신 학기를 자동으로 확장
  useEffect(() => {
    if (academicData?.gradeSummary?.semesters[0]) {
      setExpandedSemester(
        `${academicData.gradeSummary.semesters[0].year}-${academicData.gradeSummary.semesters[0].semester}`
      );
    }
  }, [academicData?.gradeSummary?.semesters]);

  const [selectedDay, setSelectedDay] = useState<number>(() => {
    const today = new Date().getDay(); // 0: 일, 1: 월 ... 5: 금, 6: 토
    return today >= 1 && today <= 6 ? today : 1;
  });

  // 토요일 수업이 없으면 월요일로 폴백
  useEffect(() => {
    const hasSat = (academicData?.timetable || []).some(t => t.dayOfWeek === 6);
    if (selectedDay === 6 && !hasSat) {
      setSelectedDay(1);
    }
  }, [academicData?.timetable, selectedDay]);

  const gradeSummary = academicData?.gradeSummary;
  const timetable = academicData?.timetable || [];
  const graduation = academicData?.graduation;

  const toggleSemester = (semKey: string) => {
    setExpandedSemester(prev => (prev === semKey ? null : semKey));
  };

  const getGradeBadge = (grade: string) => {
    const g = grade.toUpperCase();
    if (g.startsWith('A')) {
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300';
    }
    if (g.startsWith('B')) {
      return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300';
    }
    if (g.startsWith('C') || g.startsWith('D')) {
      return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300';
    }
    if (g === 'P') {
      return 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200 border-zinc-300';
    }
    return 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-300';
  };

  const hasSaturday = timetable.some(t => t.dayOfWeek === 6);
  const unscheduledClasses = timetable.filter(t => t.unscheduled);
  const courseCount = new Set(timetable.map(t => t.subjectNm)).size;
  const daysOfWeek = [
    { num: 1, name: '월' },
    { num: 2, name: '화' },
    { num: 3, name: '수' },
    { num: 4, name: '목' },
    { num: 5, name: '금' },
    ...(hasSaturday ? [{ num: 6, name: '토' }] : []),
  ];

  const [selectedModalClass, setSelectedModalClass] = useState<MergedTimetableItem | null>(null);

  // 요일별 연속 강의 병합 처리
  const mergedTimetableByDay = useMemo(() => {
    const map: Record<number, MergedTimetableItem[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    for (let d = 1; d <= 6; d++) {
      const dayClasses = timetable.filter(t => t.dayOfWeek === d);
      map[d] = mergeDayTimetable(dayClasses);
    }
    return map;
  }, [timetable]);

  // 주간 그리드 표시 시간대 계산 (09:00 ~ 17:00 이상)
  const { startHour, endHour, hours } = useMemo(() => {
    let minMinute = 9 * 60; // 기본 09:00 시작
    let maxMinute = 17 * 60 + 15; // 기본 17:15 마감

    for (const item of timetable) {
      if (item.unscheduled) continue;
      const start = item.startMinutes !== undefined ? item.startMinutes : parseClassMinutes(item.timeStr, item.period).start;
      let end = item.endMinutes !== undefined ? item.endMinutes : parseClassMinutes(item.timeStr, item.period).end;
      if (end < start) end += 24 * 60;
      if (start < minMinute) minMinute = start;
      if (end > maxMinute) maxMinute = end;
    }

    const startH = Math.min(9, Math.floor(minMinute / 60));
    // 17:15 마감인 경우 17:00(5시) 슬롯 내에 위치하므로 마지막 슬롯은 17 (5시)
    // 18:00 초과 수업(야간)이 있는 경우에만 18시(6시) 이상의 추가 슬롯 생성
    const lastSlotHour = Math.max(17, Math.floor((maxMinute - 1) / 60));
    const hList: number[] = [];
    for (let h = startH; h <= lastSlotHour; h++) {
      hList.push(h);
    }
    return { startHour: startH, endHour: lastSlotHour, hours: hList };
  }, [timetable]);

  const HOUR_HEIGHT = 56;

  const currentDayClasses = useMemo(
    () => mergedTimetableByDay[selectedDay] || [],
    [mergedTimetableByDay, selectedDay]
  );

  if (!academicData || (!gradeSummary && timetable.length === 0)) {
    return (
      <div className="space-y-4 pb-6">
        <div className="p-6 bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-3xl text-center shadow-sm space-y-3.5">
          <div className="w-14 h-14 rounded-2xl bg-hs-50 dark:bg-hs-950/60 text-hs-700 dark:text-hs-300 flex items-center justify-center mx-auto shadow-inner">
            <Award className="w-7 h-7" />
          </div>
          <div>
            <h3 className="text-sm font-black text-zinc-900 dark:text-white">종합정보시스템 성적 & 시간표</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed max-w-xs mx-auto">
              학교 종합정보시스템(hsctis)과 연동하여 실제 내 성적표와 주간 강의시간표를 가져옵니다.
            </p>
          </div>
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="w-full py-3.5 bg-hs-700 hover:bg-hs-800 text-white font-bold text-xs rounded-2xl shadow-md shadow-hs-700/20 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? '종합정보시스템 데이터 조회 중...' : '학사 데이터 동기화하기'}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3.5 pb-6">
      {/* 상단: 서브탭 + 학사 새로고침 (탭 제목 줄 없이 서브탭이 곧 상단) */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 flex p-1 bg-zinc-200/80 dark:bg-zinc-900 rounded-2xl text-xs font-bold">
            {(
              [
                ['timetable', '시간표'],
                ['graduation', '졸업 학점'],
                ['grades', '성적'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={`flex-1 py-2 text-center rounded-xl transition-all ${
                  activeSection === id
                    ? 'bg-white dark:bg-zinc-800 text-hs-700 dark:text-hs-300 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 disabled:opacity-60"
            aria-label="학사 새로고침"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <p className="text-[10px] text-zinc-400 text-right px-1">최종 갱신 {academicData?.lastUpdated || '-'}</p>
      </div>

      {/* 성적 가리기: 눌러야 평점 표시 */}
      {activeSection === 'grades' && gradesHidden && (
        <button
          onClick={() => setGradesRevealed(true)}
          className="w-full p-8 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm text-center space-y-1"
        >
          <EyeOff className="w-6 h-6 mx-auto text-zinc-400" />
          <p className="text-sm font-bold text-zinc-800 dark:text-zinc-200">성적이 가려져 있습니다</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">눌러서 보기 · 설정에서 끌 수 있습니다</p>
        </button>
      )}

      {/* [1. 성적/평점 섹션] */}
      {activeSection === 'grades' && !gradesHidden && (
        <div className="space-y-3.5">
          {/* 전체 GPA 요약 카드 */}
          {gradeSummary && (
            <div className="bg-gradient-to-br from-hs-800 to-hs-900 dark:from-zinc-900 dark:to-hs-950 text-white p-4 rounded-2xl shadow-sm border border-hs-700/50 dark:border-zinc-800 relative overflow-hidden">
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-hs-200 dark:text-zinc-400">
                    전체 누적 학점 / 평점평균
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/20 text-white backdrop-blur">
                    {gradeSummary.totalGpa >= 4.0
                      ? '🏆 최우수'
                      : gradeSummary.totalGpa >= 3.5
                      ? '⭐ 우수'
                      : '일반'}
                  </span>
                </div>

                <div className="flex items-baseline gap-2 mb-3">
                  <span className="text-3xl font-black tracking-tight">
                    {gradeSummary.totalGpa.toFixed(2)}
                  </span>
                  <span className="text-sm font-semibold text-hs-200 dark:text-zinc-400">
                    / 4.5
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10 text-xs">
                  <div>
                    <span className="text-hs-200 dark:text-zinc-400 block text-[10px]">
                      취득 / 신청 학점
                    </span>
                    <span className="font-bold">
                      {gradeSummary.totalAcquiredCredits} / {gradeSummary.totalAppliedCredits} 학점
                    </span>
                  </div>
                  <div>
                    <span className="text-hs-200 dark:text-zinc-400 block text-[10px]">
                      환산 백분율
                    </span>
                    <span className="font-bold">
                      {gradeSummary.totalPercentile ? `${gradeSummary.totalPercentile}점` : '-'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 학기별 성적 아코디언 */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-black text-zinc-900 dark:text-zinc-100 px-1 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-hs-700 dark:text-hs-400" />
              학기별 성적표
            </h3>

            {(!gradeSummary || gradeSummary.semesters.length === 0) ? (
              <div className="p-8 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500">
                조회된 성적 내역이 없습니다.
              </div>
            ) : (
              gradeSummary.semesters.map((sem: SemesterGrade) => {
                const semKey = `${sem.year}-${sem.semester}`;
                const isExpanded = expandedSemester === semKey;

                return (
                  <div
                    key={semKey}
                    className="bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm transition-all"
                  >
                    <button
                      onClick={() => toggleSemester(semKey)}
                      className="w-full p-3.5 flex items-center justify-between text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-black text-xs text-zinc-900 dark:text-white">
                          {sem.year}학년도 {sem.semester}
                        </span>
                        <span className="text-[10px] font-semibold text-zinc-400">
                          {sem.acquiredCredits}학점
                        </span>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <span className="text-xs font-black text-hs-700 dark:text-hs-300">
                          {sem.semesterGpa.toFixed(2)}
                          <span className="text-[10px] font-normal text-zinc-400 ml-0.5">/ 4.5</span>
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-zinc-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-zinc-400" />
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="p-3 bg-zinc-50/70 dark:bg-zinc-950/50 border-t border-zinc-100 dark:border-zinc-800/80 space-y-1.5">
                        {sem.subjects.map((sub, idx) => (
                          <div
                            key={idx}
                            className="p-2.5 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200/70 dark:border-zinc-800 flex items-center justify-between"
                          >
                            <div className="min-w-0 flex-1 pr-2">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                                  {sub.compDiv}
                                </span>
                                <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                                  {sub.subjNm}
                                </span>
                              </div>
                              <span className="text-[10px] text-zinc-400">
                                {sub.credits}학점 {sub.subjCode ? `• ${sub.subjCode}` : ''}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span
                                className={`px-2 py-0.5 text-xs font-black rounded-lg border ${getGradeBadge(
                                  sub.grade
                                )}`}
                              >
                                {sub.grade}
                              </span>
                              {sub.gpaPoint !== undefined && (
                                <span className="text-[10px] font-semibold text-zinc-400 w-7 text-right">
                                  {sub.gpaPoint.toFixed(1)}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* [2. 강의 시간표 섹션] */}
      {activeSection === 'timetable' && (
        <div className="space-y-3">
          {/* 상단 뷰 모드 전환 토글 (주간 그리드 vs 일별 카드) */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-black text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-hs-700 dark:text-hs-400" />
              주간 강의 시간표
            </span>

            <div className="flex p-0.5 bg-zinc-200/80 dark:bg-zinc-800 rounded-xl text-[11px] font-bold">
              <button
                onClick={() => setTimetableViewMode('grid')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  timetableViewMode === 'grid'
                    ? 'bg-white dark:bg-zinc-700 text-hs-700 dark:text-hs-300 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                주간 그리드
              </button>
              <button
                onClick={() => setTimetableViewMode('daily')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  timetableViewMode === 'daily'
                    ? 'bg-white dark:bg-zinc-700 text-hs-700 dark:text-hs-300 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                일별 카드
              </button>
            </div>
          </div>

          {/* [2-A. 주간 에브리타임 스타일 그리드 뷰] */}
          {timetableViewMode === 'grid' && (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
              {/* 컬럼 헤더 (요일) */}
              <div className="flex border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/40">
                {/* 좌측 시간축 상단 여백 (w-6 = 24px) */}
                <div className="w-6 flex-shrink-0" />
                {daysOfWeek.map(d => (
                  <button
                    key={d.num}
                    onClick={() => {
                      setSelectedDay(d.num);
                      setTimetableViewMode('daily');
                    }}
                    className="flex-1 py-2 text-center text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:text-hs-700 dark:hover:text-hs-400 border-l border-zinc-100 dark:border-zinc-800/60 first:border-l-0 transition-colors"
                  >
                    {d.name}
                  </button>
                ))}
              </div>

              {/* 시간표 메인 캔버스 */}
              <div
                className="relative bg-white dark:bg-zinc-900"
                style={{ height: `${hours.length * HOUR_HEIGHT}px` }}
              >
                {/* 좌측 시간 라벨 & 가로 구분선 */}
                {hours.map((h, i) => {
                  const topPx = i * HOUR_HEIGHT;
                  const displayHour = h > 12 ? (h >= 24 ? (h % 12 === 0 ? 12 : h % 12) : h - 12) : (h === 0 ? 12 : h);
                  return (
                    <React.Fragment key={h}>
                      <div
                        className="absolute left-0 w-6 text-right pr-1 select-none pointer-events-none z-10"
                        style={{ top: `${topPx - 7}px` }}
                      >
                        <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                          {displayHour}
                        </span>
                      </div>
                      <div
                        className="absolute right-0 border-t border-zinc-100 dark:border-zinc-800/60 pointer-events-none"
                        style={{
                          top: `${topPx}px`,
                          left: '24px',
                        }}
                      />
                    </React.Fragment>
                  );
                })}

                {/* 요일별 세로 열 컨테이너 */}
                <div
                  className="absolute top-0 bottom-0 right-0 flex"
                  style={{ left: '24px' }}
                >
                  {daysOfWeek.map(d => {
                    const dayClasses = mergedTimetableByDay[d.num] || [];
                    return (
                      <div
                        key={d.num}
                        className="relative flex-1 h-full border-l border-zinc-100 dark:border-zinc-800/60 first:border-l-0"
                      >
                        {dayClasses.map(item => {
                          const top = ((item.startMinutes - startHour * 60) / 60) * HOUR_HEIGHT;
                          const durationMinutes = Math.max(30, item.durationMinutes || (item.endMinutes - item.startMinutes));
                          const height = Math.max(36, (durationMinutes / 60) * HOUR_HEIGHT - 2);
                          const color = SUBJECT_PALETTE[item.colorIndex % SUBJECT_PALETTE.length];

                          return (
                            <div
                              key={item.id}
                              onClick={() => setSelectedModalClass(item)}
                              className={`absolute left-0.5 right-0.5 rounded-lg p-1.5 flex flex-col justify-start overflow-hidden cursor-pointer select-none transition-transform active:scale-[0.98] shadow-sm hover:opacity-95 ${color.cardClass}`}
                              style={{
                                top: `${top}px`,
                                height: `${height}px`,
                                backgroundColor: color.bg,
                              }}
                              title={`${item.subjectNm} (${item.timeStr})`}
                            >
                              <div className="text-[11px] font-bold text-white leading-[1.2] break-keep line-clamp-2">
                                {item.subjectNm}
                              </div>
                              <div className="text-[10px] text-white/95 font-medium leading-tight mt-0.5 truncate">
                                {item.classroom}
                              </div>
                              {/* 3단 정보: 과목명 / 강의실 / 교수명 (75분 단일 블록 높이 ≈ 68px) */}
                              {item.profNm && height >= 55 && (
                                <div className="text-[9px] text-white/90 font-medium leading-tight mt-0.5 truncate">
                                  {item.profNm}
                                </div>
                              )}
                              {height >= 100 && (
                                <div className="text-[9px] text-white/80 font-normal leading-tight mt-0.5 truncate">
                                  {item.startTime}~{item.endTime}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* [2-B. 일별 카드 뷰] */}
          {timetableViewMode === 'daily' && (
            <div className="space-y-3">
              {/* 요일 선택 탭 */}
              <div className="flex items-center justify-between gap-1 p-1 bg-zinc-200/80 dark:bg-zinc-900 rounded-xl">
                {daysOfWeek.map(d => (
                  <button
                    key={d.num}
                    onClick={() => setSelectedDay(d.num)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all ${
                      selectedDay === d.num
                        ? 'bg-white dark:bg-zinc-800 text-hs-700 dark:text-hs-300 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    {d.name}요일
                  </button>
                ))}
              </div>

              {/* 해당 요일 수업 리스트 */}
              <div className="space-y-2">
                {currentDayClasses.length === 0 ? (
                  <div className="p-8 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 space-y-1">
                    <Calendar className="w-5 h-5 mx-auto text-zinc-400 mb-1" />
                    <p className="font-bold text-zinc-700 dark:text-zinc-300">수업이 없는 날입니다.</p>
                    <p className="text-[11px]">충분한 휴식 또는 자율 학습을 권장합니다.</p>
                  </div>
                ) : (
                  currentDayClasses.map(cls => {
                    const color = SUBJECT_PALETTE[cls.colorIndex % SUBJECT_PALETTE.length];
                    const duration = cls.durationMinutes || Math.max(0, cls.endMinutes - cls.startMinutes);

                    return (
                      <div
                        key={cls.id}
                        onClick={() => setSelectedModalClass(cls)}
                        className="p-3.5 bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl shadow-sm flex items-start gap-3.5 cursor-pointer hover:border-hs-300 dark:hover:border-hs-700 transition-colors"
                      >
                        <div className="w-16 rounded-xl bg-zinc-100 dark:bg-zinc-800 p-2 flex flex-col items-center justify-center flex-shrink-0 text-center">
                          <span className="text-xs font-black text-zinc-900 dark:text-white">
                            {cls.startTime}
                          </span>
                          <span className="text-[10px] font-medium text-zinc-400 mt-0.5">
                            {cls.endTime}
                          </span>
                          <span className="text-[9px] font-bold text-hs-700 dark:text-hs-400 mt-0.5">
                            {duration}분
                          </span>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span
                              className={`px-2.5 py-0.5 text-[11px] font-bold rounded-lg ${color.badgeClass}`}
                              style={{ backgroundColor: color.bg }}
                            >
                              {cls.subjectNm}
                            </span>
                          </div>

                          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 space-y-1">
                            <div className="flex items-center gap-1 font-semibold text-zinc-800 dark:text-zinc-200">
                              <span>⏱️ {cls.startTime} - {cls.endTime} ({duration}분)</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="flex items-center gap-1 truncate">
                                <MapPin className="w-3.5 h-3.5 text-zinc-400" />
                                {cls.classroom || '강의실 미정'}
                              </span>
                              {cls.profNm && (
                                <span className="flex items-center gap-1">
                                  • {cls.profNm} 교수
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* 수업 시간 미지정 과목 (예: 진로와상담) */}
          {unscheduledClasses.length > 0 && (
            <div className="p-3 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-1.5">
              <span className="text-[11px] font-black text-zinc-700 dark:text-zinc-300">시간 미지정 과목</span>
              <div className="flex flex-wrap gap-1.5">
                {unscheduledClasses.map(cls => (
                  <span
                    key={cls.id}
                    className="px-2 py-1 rounded-lg text-[11px] font-bold text-white"
                    style={{ backgroundColor: SUBJECT_PALETTE[(cls.colorIndex ?? 0) % SUBJECT_PALETTE.length].bg }}
                  >
                    {cls.subjectNm}
                    {cls.profNm && <span className="font-medium text-white/85"> · {cls.profNm}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 전체 시간표 요약 칩 */}
          <div className="p-3 bg-zinc-100/80 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-600 dark:text-zinc-400 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-zinc-500" />
              이번 학기 총 {courseCount}개 강좌
            </span>
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">
              시간 기반 편성
            </span>
          </div>
        </div>
      )}

      {/* [3. 졸업사정 진단 섹션] */}
      {activeSection === 'graduation' && (
        <div className="space-y-3.5">
          {graduation ? (
            <>
              {/* 졸업 달성도 메인 게이지 카드 */}
              <div className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award className="w-5 h-5 text-hs-700 dark:text-hs-400" />
                    <span className="text-xs font-black text-zinc-900 dark:text-white">
                      졸업학점 달성도
                    </span>
                  </div>
                  <span className="text-xs font-bold text-hs-700 dark:text-hs-300">
                    {graduation.completionPercent}% 달성
                  </span>
                </div>

                {/* 프로그레스 바 */}
                <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-3 rounded-full overflow-hidden p-0.5">
                  <div
                    className="bg-gradient-to-r from-hs-600 to-emerald-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, graduation.completionPercent)}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  <span>취득 {graduation.totalAcquiredCredits}학점</span>
                  <span>기준 {graduation.totalRequiredCredits}학점</span>
                </div>
              </div>

              {/* 영역별 세부 진단 (교양 / 계열공통 / 전공 / 타전공) */}
              <div className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl shadow-sm space-y-3">
                <span className="text-xs font-black text-zinc-900 dark:text-white">영역별 이수 현황</span>
                {[
                  {
                    label: '교양',
                    acquired: graduation.generalAcquiredCredits,
                    required: graduation.generalRequiredCredits,
                    hint: graduation.generalMaxCredits ? `최대 ${graduation.generalMaxCredits}학점까지 인정` : undefined,
                  },
                  ...(graduation.commonRequiredCredits
                    ? [
                        {
                          label: '계열공통',
                          acquired: graduation.commonAcquiredCredits || 0,
                          required: graduation.commonRequiredCredits,
                          hint: undefined,
                        },
                      ]
                    : []),
                  {
                    label: '전공',
                    acquired: graduation.majorAcquiredCredits,
                    required: graduation.majorRequiredCredits,
                    hint: undefined,
                  },
                ].map(area => {
                  const met = area.acquired >= area.required;
                  const pct = area.required > 0 ? Math.min(100, (area.acquired / area.required) * 100) : 100;
                  return (
                    <div key={area.label} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-zinc-700 dark:text-zinc-300">
                          {area.label}
                          {area.hint && (
                            <span className="ml-1.5 text-[10px] font-medium text-zinc-400">{area.hint}</span>
                          )}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="font-black text-zinc-900 dark:text-white">
                            {area.acquired}
                            <span className="font-semibold text-zinc-400"> / {area.required}</span>
                          </span>
                          <span
                            className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                              met
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            }`}
                          >
                            {met ? '충족' : `${Math.round((area.required - area.acquired) * 10) / 10} 부족`}
                          </span>
                        </span>
                      </div>
                      <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${met ? 'bg-emerald-500' : 'bg-hs-600 dark:bg-hs-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                {graduation.otherAcquiredCredits > 0 && (
                  <div className="flex items-center justify-between text-xs pt-0.5">
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">타전공·일반선택</span>
                    <span className="font-black text-zinc-900 dark:text-white">{graduation.otherAcquiredCredits}학점</span>
                  </div>
                )}
                {graduation.ruleText && (
                  <p className="text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500 border-t border-zinc-100 dark:border-zinc-800 pt-2">
                    기준: {graduation.ruleText}
                    {graduation.multiMajorText && <><br />다전공: {graduation.multiMajorText}</>}
                  </p>
                )}
                {graduation.creditsComputed === false && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400">{graduation.note}</p>
                )}
              </div>

              {/* 졸업 사정 상태 안내 배너 */}
              <div
                className={`p-3.5 rounded-2xl border flex items-center gap-3 ${
                  graduation.status === 'satisfied'
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60'
                    : graduation.status === 'insufficient'
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60'
                    : 'bg-hs-50 dark:bg-hs-950/40 border-hs-200 dark:border-hs-800/60'
                }`}
              >
                <CheckCircle2
                  className={`w-5 h-5 flex-shrink-0 ${
                    graduation.status === 'satisfied'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : graduation.status === 'insufficient'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-hs-700 dark:text-hs-400'
                  }`}
                />
                <div
                  className={`text-xs font-medium ${
                    graduation.status === 'satisfied'
                      ? 'text-emerald-900 dark:text-emerald-200'
                      : graduation.status === 'insufficient'
                      ? 'text-amber-900 dark:text-amber-200'
                      : 'text-hs-900 dark:text-hs-200'
                  }`}
                >
                  {graduation.status === 'satisfied'
                    ? '🎉 졸업 이수학점 기준을 모두 충족하였습니다. 졸업논문/인증 요건을 확인하세요.'
                    : graduation.status === 'insufficient'
                    ? '⚠️ 전체 취득학점은 기준을 달성하였으나, 교양·계열공통·전공 중 부족한 영역이 있습니다. 위 영역별 현황을 확인하세요.'
                    : `현재 정상적으로 학점을 이수 중입니다. 남은 기준 학점(${
                        Math.round(Math.max(0, graduation.totalRequiredCredits - graduation.totalAcquiredCredits) * 10) / 10
                      }학점)을 순차적으로 취득해주세요.`}
                </div>
              </div>

              {/* 필수 이수 현황 (교양필수 / 주전공필수 / 비교과) — 적용 대상은 안내문 기준으로 본인 확인 필요 */}
              {graduation.requiredCourses && graduation.requiredCourses.length > 0 && (
                <div className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-zinc-900 dark:text-white">필수 이수 현황</span>
                    <span className="text-[10px] text-zinc-400">적용 대상은 안내 문구 확인</span>
                  </div>
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {graduation.requiredCourses.map((c, idx) => {
                      const done = c.completedCount !== null && c.completedCount > 0;
                      const statusText =
                        c.completedCount === null
                          ? `${c.earned}${c.unit === '점' ? '점' : ''}`
                          : done
                          ? `${c.completedCount}과목 이수`
                          : '미이수';
                      return (
                        <div key={`${c.category}_${c.name}_${idx}`} className="py-2 space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate">
                              {c.category === '주전공필수' && c.note ? `${c.note} (${c.name})` : c.name}
                              <span className="ml-1.5 text-[10px] font-semibold text-zinc-400">{c.category}</span>
                            </span>
                            <span
                              className={`flex-shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded ${
                                done
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                              }`}
                            >
                              {statusText}
                            </span>
                          </div>
                          {c.note && c.category !== '주전공필수' && (
                            <p className="text-[10px] leading-snug text-zinc-400 dark:text-zinc-500">{c.note}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="p-8 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500">
              졸업사정 진단 데이터가 없습니다. 상단 동기화를 진행해주세요.
            </div>
          )}
        </div>
      )}

      {/* 강의 상세 모달 다이얼로그 */}
      {selectedModalClass && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
          onClick={() => setSelectedModalClass(null)}
        >
          <div
            className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl border border-zinc-200 dark:border-zinc-800 animate-in fade-in zoom-in duration-150"
            onClick={e => e.stopPropagation()}
          >
            {/* 상단 컬러 배너 */}
            <div
              className="p-5 text-white relative"
              style={{
                backgroundColor:
                  SUBJECT_PALETTE[selectedModalClass.colorIndex % SUBJECT_PALETTE.length].bg,
              }}
            >
              <button
                onClick={() => setSelectedModalClass(null)}
                className="absolute top-4 right-4 p-1.5 rounded-full bg-black/20 hover:bg-black/30 text-white transition-colors"
                aria-label="닫기"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="text-[11px] font-bold opacity-90 mb-1 flex items-center gap-1.5">
                <span>{selectedModalClass.dayName}요일 강의</span>
                <span>•</span>
                <span>
                  {selectedModalClass.startTime} ~ {selectedModalClass.endTime} ({selectedModalClass.durationMinutes || Math.max(0, selectedModalClass.endMinutes - selectedModalClass.startMinutes)}분)
                </span>
              </div>
              <h3 className="text-lg font-black leading-tight break-keep pr-6">
                {selectedModalClass.subjectNm}
              </h3>
            </div>

            {/* 세부 정보 목록 */}
            <div className="p-5 space-y-3.5 text-xs text-zinc-600 dark:text-zinc-300">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4 h-4 text-zinc-500" />
                </div>
                <div>
                  <div className="text-[10px] text-zinc-400 font-semibold">강의 시간</div>
                  <div className="font-bold text-zinc-900 dark:text-white">
                    {selectedModalClass.startTime} ~ {selectedModalClass.endTime} (총 {selectedModalClass.durationMinutes || Math.max(0, selectedModalClass.endMinutes - selectedModalClass.startMinutes)}분)
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-4 h-4 text-zinc-500" />
                </div>
                <div>
                  <div className="text-[10px] text-zinc-400 font-semibold">강의실</div>
                  <div className="font-bold text-zinc-900 dark:text-white">
                    {selectedModalClass.classroom || '강의실 정보 없음'}
                  </div>
                </div>
              </div>

              {selectedModalClass.profNm && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                    <BookOpen className="w-4 h-4 text-zinc-500" />
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-400 font-semibold">담당 교수</div>
                    <div className="font-bold text-zinc-900 dark:text-white">
                      {selectedModalClass.profNm} 교수
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 하단 닫기 버튼 */}
            <div className="p-4 pt-0">
              <button
                onClick={() => setSelectedModalClass(null)}
                className="w-full py-2.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 font-bold text-xs rounded-xl text-zinc-800 dark:text-zinc-200 transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
