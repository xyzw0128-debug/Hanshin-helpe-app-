import { HomeCardId, HomeCardSetting } from '../types';

export const HOME_CARD_META: Record<HomeCardId, { label: string; description: string }> = {
  todayClasses: { label: '오늘 수업', description: '오늘 시간표와 다음 수업' },
  quickHub: { label: '캠퍼스 퀵허브', description: '전자출결 · 수강신청 · 도서관 회원증' },
  summaryChips: { label: '요약', description: '미제출 과제 · 미수강 강의 · 안 읽은 공지' },
  deadlines: { label: '마감 임박', description: '과제 · 퀴즈 · 온라인 강의 마감 순' },
  recentNotices: { label: '최근 공지', description: '새로 올라온 공지 3개' },
  graduation: { label: '졸업 학점', description: '졸업 학점 달성률' },
  urgentNotice: { label: '긴급 공지', description: '긴급으로 분류된 최신 공지' },
};

export const DEFAULT_HOME_CARDS: HomeCardSetting[] = [
  { id: 'todayClasses', enabled: true },
  { id: 'quickHub', enabled: true },
  { id: 'summaryChips', enabled: true },
  { id: 'deadlines', enabled: true },
  { id: 'recentNotices', enabled: false },
  { id: 'graduation', enabled: false },
  { id: 'urgentNotice', enabled: false },
];

/**
 * 저장된 홈 카드 설정을 정리: 알 수 없는 카드는 제거하고, 새로 추가된 카드는 꺼진 상태로 뒤에 붙임
 */
export function normalizeHomeCards(saved?: HomeCardSetting[] | null): HomeCardSetting[] {
  if (!Array.isArray(saved) || saved.length === 0) {
    return DEFAULT_HOME_CARDS.map(c => ({ ...c }));
  }
  const known = new Set(Object.keys(HOME_CARD_META));
  const seen = new Set<string>();
  const result: HomeCardSetting[] = [];
  for (const card of saved) {
    if (card && known.has(card.id) && !seen.has(card.id)) {
      seen.add(card.id);
      result.push({ id: card.id, enabled: !!card.enabled });
    }
  }
  for (const card of DEFAULT_HOME_CARDS) {
    if (!seen.has(card.id)) result.push({ id: card.id, enabled: false });
  }
  return result;
}
