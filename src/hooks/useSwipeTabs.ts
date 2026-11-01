import { RefObject, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

/** 손가락이 이만큼(px) 움직이면 가로·세로 중 어느 쪽으로 미는지 정함 (hooks/usePullToRefresh.ts와 같은 값) */
export const GESTURE_LOCK_PX = 10;
/** 본문 너비의 이 비율보다 많이 밀었거나 빠르게 튕기면 옆 탭으로 넘김 */
const SWIPE_RATIO = 0.22;
const FLICK_PX_PER_MS = 0.45;
const OUT_MS = 140;
const IN_MS = 200;

/** 본문 안에서 가로로 스크롤되는 요소 위에서 시작한 터치인지 */
function inHorizontalScroller(target: Element | null, root: Element): boolean {
  for (let n = target; n && n !== root; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
  }
  return false;
}

/**
 * 본문을 좌우로 밀어 옆 하위 탭으로 넘김. 미는 동안 page가 손가락을 따라 움직이고, 넘기면 민 쪽으로 빠진 뒤
 * 새 탭이 반대쪽에서 들어온다. 첫 탭·마지막 탭에서 바깥쪽으로 밀면 조금만 따라오다 제자리로 돌아감.
 * 세로로 미는 동작, 가로로 스크롤되는 요소, data-no-tab-swipe 안(과목 선택 창처럼 목록 안에 뜬 창)에서
 * 시작한 터치에는 반응하지 않는다. 쉬는 동안 page에는 transform을 남기지 않음(안쪽 fixed 창이 화면 기준으로 뜨게).
 */
export function useSwipeTabs(
  areaRef: RefObject<HTMLElement>,
  pageRef: RefObject<HTMLElement>,
  options: { tabs: string[] | null; active: string; onChange: (id: string) => void }
): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const enabled = !!options.tabs && options.tabs.length > 1;

  useEffect(() => {
    const area = areaRef.current;
    if (!area || !enabled) return;
    let mode: 'idle' | 'pending' | 'swipe' = 'idle';
    let busy = false; // 넘기는 애니메이션 중
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const move = (x: number, ms = 0, opacity = 1) => {
      const page = pageRef.current;
      if (!page) return;
      page.style.transition = ms ? `transform ${ms}ms ease-out, opacity ${ms}ms ease-out` : 'none';
      page.style.transform = x ? `translate3d(${x}px,0,0)` : '';
      page.style.opacity = opacity < 1 ? String(opacity) : '';
    };
    const neighbor = (dir: number): string | undefined => {
      const { tabs, active } = optionsRef.current;
      const i = tabs ? tabs.indexOf(active) : -1;
      return i < 0 ? undefined : tabs[i + dir];
    };

    const onStart = (e: TouchEvent) => {
      mode = 'idle';
      if (busy || e.touches.length !== 1) return;
      const target = e.target as Element | null;
      if (target?.closest?.('[data-no-tab-swipe]') || inHorizontalScroller(target, area)) return;
      startX = lastX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      lastT = e.timeStamp;
      dx = velocity = 0;
      mode = 'pending';
    };
    const onMove = (e: TouchEvent) => {
      if (mode === 'idle') return;
      const x = e.touches[0].clientX;
      if (mode === 'pending') {
        const adx = Math.abs(x - startX);
        const ady = Math.abs(e.touches[0].clientY - startY);
        if (Math.max(adx, ady) < GESTURE_LOCK_PX) return;
        if (adx <= ady) {
          mode = 'idle';
          return;
        }
        mode = 'swipe';
        startX = x; // 정하기 전 움직인 만큼 튀지 않게 여기서부터 따라감
      }
      if (e.cancelable) e.preventDefault(); // 가로로 미는 동안 목록이 세로로 스크롤되지 않게
      dx = x - startX;
      const dt = e.timeStamp - lastT;
      if (dt > 0) velocity = (x - lastX) / dt;
      lastX = x;
      lastT = e.timeStamp;
      move(neighbor(dx < 0 ? 1 : -1) ? dx : dx * 0.3);
    };
    const onEnd = () => {
      if (mode !== 'swipe') {
        mode = 'idle';
        return;
      }
      mode = 'idle';
      const dir = dx < 0 ? 1 : -1; // 왼쪽으로 밀면 다음 탭
      const next = neighbor(dir);
      const width = area.clientWidth;
      const flicked = Math.abs(velocity) > FLICK_PX_PER_MS && Math.sign(velocity) === Math.sign(dx);
      if (!next || !(Math.abs(dx) > width * SWIPE_RATIO || flicked)) {
        move(0, IN_MS);
        return;
      }
      busy = true;
      move(-dir * width, OUT_MS, 0);
      timer = setTimeout(() => {
        flushSync(() => optionsRef.current.onChange(next));
        move(dir * width * 0.35, 0, 0);
        void pageRef.current?.offsetWidth; // 시작 위치를 먼저 그린 뒤 들어오게
        move(0, IN_MS);
        timer = setTimeout(() => {
          busy = false;
          move(0);
        }, IN_MS);
      }, OUT_MS);
    };
    const onCancel = () => {
      if (mode === 'swipe') move(0, IN_MS);
      mode = 'idle';
    };

    area.addEventListener('touchstart', onStart, { passive: true });
    area.addEventListener('touchmove', onMove, { passive: false });
    area.addEventListener('touchend', onEnd);
    area.addEventListener('touchcancel', onCancel);
    return () => {
      area.removeEventListener('touchstart', onStart);
      area.removeEventListener('touchmove', onMove);
      area.removeEventListener('touchend', onEnd);
      area.removeEventListener('touchcancel', onCancel);
      if (timer) clearTimeout(timer);
      move(0);
    };
  }, [areaRef, pageRef, enabled]);
}
