import { RefObject, useEffect, useRef, useState } from 'react';

/** 이만큼(px) 당긴 뒤 놓으면 새로고침 */
export const PULL_TRIGGER_PX = 64;
const PULL_MAX_PX = 96;

/**
 * 목록 맨 위에서 아래로 당겨 새로고침. 당긴 거리(px)를 돌려줘 화면에 표시기를 그리게 한다.
 * 가로로 미는 동작이나 맨 위가 아닐 때, 그리고 data-no-pull-refresh 안(과목 선택 창처럼 목록 안에 뜬 창)에서
 * 시작한 터치에는 반응하지 않는다.
 */
export function usePullToRefresh(
  ref: RefObject<HTMLElement>,
  options: { enabled: boolean; onRefresh: () => void }
): number {
  const [distance, setDistance] = useState(0);
  const onRefreshRef = useRef(options.onRefresh);
  onRefreshRef.current = options.onRefresh;

  useEffect(() => {
    const el = ref.current;
    if (!el || !options.enabled) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let current = 0;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || el.scrollTop > 0) return;
      if ((e.target as Element | null)?.closest?.('[data-no-pull-refresh]')) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
      current = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (el.scrollTop > 0 || (current === 0 && Math.abs(dx) > Math.abs(dy))) {
        tracking = false;
        current = 0;
        setDistance(0);
        return;
      }
      current = dy > 0 ? Math.min(PULL_MAX_PX, dy * 0.5) : 0;
      setDistance(current);
    };
    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (current >= PULL_TRIGGER_PX) onRefreshRef.current();
      current = 0;
      setDistance(0);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      setDistance(0);
    };
  }, [ref, options.enabled]);

  return distance;
}
