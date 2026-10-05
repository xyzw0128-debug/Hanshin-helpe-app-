/** 뒤로가기로 돌아갈 화면 (탭 + 탭 안의 하위 화면) */
export interface ViewState {
  tab: 'home' | 'lms' | 'academics' | 'menu';
  lmsSub: 'assignments' | 'lectures' | 'notices' | 'materials';
  academic: 'timetable' | 'grades' | 'graduation';
}

export const MAX_NAV_HISTORY = 20;

export const sameView = (a: ViewState, b: ViewState) =>
  a.tab === b.tab && a.lmsSub === b.lmsSub && a.academic === b.academic;

/**
 * cur → next로 옮길 때의 뒤로가기 기록.
 * 홈 탭으로 가면 비움(홈에서는 종료 안내), 그 외에는 직전 화면을 쌓되 같은 화면은 한 번만 남겨
 * 탭을 오가도 뒤로가기가 같은 화면을 여러 번 거치지 않게 한다.
 */
export function nextNavHistory(history: ViewState[], cur: ViewState, next: ViewState): ViewState[] {
  if (sameView(cur, next)) return history;
  if (next.tab === 'home') return [];
  return [...history.filter(v => !sameView(v, cur) && !sameView(v, next)), cur].slice(-MAX_NAV_HISTORY);
}
