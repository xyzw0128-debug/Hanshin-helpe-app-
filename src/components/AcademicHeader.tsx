import React from 'react';
import { RefreshCw } from 'lucide-react';
import { AcademicData } from '../types';
import type { AcademicSection } from './AcademicView';
import { HeaderIconButton, HeaderTabs, HeaderTitleRow } from './TabHeader';

// AcademicView는 처음 열 때 불러오므로(App의 lazy) 상단 바는 따로 둔다

const SECTIONS: Array<{ id: AcademicSection; label: string }> = [
  { id: 'timetable', label: '시간표' },
  { id: 'graduation', label: '졸업 학점' },
  { id: 'grades', label: '성적' },
];

/** 학사 상단 바: 제목 · 최종 갱신 · 새로고침 · 하위 탭 (불러온 학사 정보가 없으면 하위 탭 없이) */
export const AcademicHeader: React.FC<{
  academicData?: AcademicData;
  isLoading: boolean;
  onRefresh: () => void;
  section: AcademicSection;
  onSectionChange: (section: AcademicSection) => void;
}> = ({ academicData, isLoading, onRefresh, section, onSectionChange }) => {
  const hasData = !!academicData && (!!academicData.gradeSummary || (academicData.timetable || []).length > 0);
  return (
    <>
      <HeaderTitleRow title="학사" subtitle={hasData ? `최종 갱신 ${academicData.lastUpdated || '-'}` : undefined}>
        <HeaderIconButton label="학사 새로고침" onClick={onRefresh} disabled={isLoading}>
          <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
        </HeaderIconButton>
      </HeaderTitleRow>
      {hasData && <HeaderTabs tabs={SECTIONS} active={section} onChange={onSectionChange} />}
    </>
  );
};
