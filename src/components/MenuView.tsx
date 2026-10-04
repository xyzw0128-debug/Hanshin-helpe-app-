import React from 'react';
import {
  Settings,
  ChevronRight,
  ExternalLink,
  LogOut,
  User,
  FileText,
  PlayCircle,
  Megaphone,
  FolderOpen,
  CalendarDays,
  Award,
  BarChart3,
  MapPin,
  Edit3,
  Library,
  LayoutGrid,
  Info,
  Globe,
} from 'lucide-react';
import { StudentProfile } from '../types';
import { HomeNavigateTarget } from './HomeView';
import { launchCampusApp } from '../utils/campusLauncher';

export type MenuSubpage = 'settings' | 'homeEdit' | 'appInfo';

interface MenuViewProps {
  profile: StudentProfile;
  onOpenSubpage: (page: MenuSubpage) => void;
  onNavigate: (target: HomeNavigateTarget) => void;
  onLogout: () => void;
}

type MenuRow = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  external?: boolean;
};

const openExternal = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

const Section: React.FC<{ title: string; rows: MenuRow[] }> = ({ title, rows }) => (
  <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm overflow-hidden">
    <div className="px-4 pt-3 pb-1 text-[11px] font-black text-zinc-400 dark:text-zinc-500">{title}</div>
    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {rows.map(row => (
        <button
          key={row.label}
          onClick={row.onClick}
          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60 active:bg-zinc-100 dark:active:bg-zinc-800"
        >
          <row.icon className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
          <span className="flex-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{row.label}</span>
          {row.external ? (
            <ExternalLink className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600" />
          ) : (
            <ChevronRight className="w-4 h-4 text-zinc-300 dark:text-zinc-600" />
          )}
        </button>
      ))}
    </div>
  </div>
);

export const MenuView: React.FC<MenuViewProps> = ({ profile, onOpenSubpage, onNavigate, onLogout }) => {
  // 학번 앞 4자리(입학년도) → "24학번"
  const admissionYear = /^\d{4}/.test(profile.studentNo) ? `${profile.studentNo.slice(2, 4)}학번` : '';
  const detailLine = [profile.dept, profile.gradeYear].filter(Boolean).join(' · ');

  return (
    <div className="space-y-3.5 pb-6">
      {/* 프로필 카드 + 설정(톱니바퀴) */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-hs-100 dark:bg-hs-950 border border-hs-200 dark:border-hs-800 text-hs-700 dark:text-hs-300 flex items-center justify-center flex-shrink-0">
            <User className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <h2 className="text-base font-black text-zinc-900 dark:text-white truncate">{profile.name || '한신대학교 학생'}</h2>
              {admissionYear && <span className="text-xs font-bold text-hs-700 dark:text-hs-300">{admissionYear}</span>}
            </div>
            {detailLine && <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 mt-0.5 truncate">{detailLine}</p>}
            <p className="text-xs text-zinc-400 mt-0.5">학번 {profile.studentNo || '-'}</p>
          </div>
          <button
            onClick={() => onOpenSubpage('settings')}
            className="p-2 -mr-1 -mt-1 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="설정"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      <Section
        title="LMS"
        rows={[
          { icon: FileText, label: '과제·퀴즈', onClick: () => onNavigate({ tab: 'lms', sub: 'assignments' }) },
          { icon: PlayCircle, label: '온라인 강의', onClick: () => onNavigate({ tab: 'lms', sub: 'lectures' }) },
          { icon: Megaphone, label: '공지', onClick: () => onNavigate({ tab: 'lms', sub: 'notices' }) },
          { icon: FolderOpen, label: '자료실', onClick: () => onNavigate({ tab: 'lms', sub: 'materials' }) },
          { icon: Globe, label: 'LMS 웹사이트', onClick: () => openExternal('https://lms.hs.ac.kr'), external: true },
        ]}
      />

      <Section
        title="학사"
        rows={[
          { icon: CalendarDays, label: '시간표', onClick: () => onNavigate({ tab: 'academics', sub: 'timetable' }) },
          { icon: Award, label: '졸업 학점', onClick: () => onNavigate({ tab: 'academics', sub: 'graduation' }) },
          { icon: BarChart3, label: '성적', onClick: () => onNavigate({ tab: 'academics', sub: 'grades' }) },
          { icon: Globe, label: '종합정보시스템', onClick: () => openExternal('https://hsctis.hs.ac.kr'), external: true },
        ]}
      />

      <Section
        title="캠퍼스"
        rows={[
          { icon: MapPin, label: '대면 전자출결', onClick: () => launchCampusApp('attendance'), external: true },
          { icon: Edit3, label: '수강신청', onClick: () => launchCampusApp('sugang'), external: true },
          { icon: Library, label: '도서관 회원증', onClick: () => launchCampusApp('library'), external: true },
          { icon: Globe, label: '중앙도서관 웹사이트', onClick: () => openExternal('https://hslib.hs.ac.kr'), external: true },
        ]}
      />

      <Section
        title="앱"
        rows={[
          { icon: LayoutGrid, label: '홈 화면 편집', onClick: () => onOpenSubpage('homeEdit') },
          { icon: Settings, label: '설정', onClick: () => onOpenSubpage('settings') },
          { icon: Info, label: '앱 정보', onClick: () => onOpenSubpage('appInfo') },
        ]}
      />

      <button
        onClick={onLogout}
        className="w-full py-3 flex items-center justify-center gap-1.5 text-xs font-bold text-red-600 dark:text-red-400 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl"
      >
        <LogOut className="w-3.5 h-3.5" />
        로그아웃
      </button>
    </div>
  );
};
