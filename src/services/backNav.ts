import { useEffect, useRef } from 'react';
import { armNativeExit, setNativeBackState } from './appShell';

/**
 * 안드로이드 뒤로가기 (MainActivity → "hsBackButton" 이벤트).
 *
 * 1) 열려 있는 창(바텀시트·하위 화면·검색·시간표 상세)을 가장 나중에 연 것부터 닫고
 * 2) 없으면 앱의 이전 화면(탭·하위 탭) → 홈으로 돌아간다 (App의 setRootBack)
 * 3) 홈에서 더 돌아갈 곳이 없으면 네이티브가 "한 번 더 누르면 종료" 처리
 *
 * 뒤로 갈 곳이 있는지는 바뀔 때마다 네이티브에 알려 둔다(setBackState). 그래야 홈에서만 종료 안내가 뜬다.
 */

type Entry = { onBack: () => void };

const stack: Entry[] = [];
let rootCanGoBack = false;
let rootHandler: (() => boolean) | null = null;
let reported: boolean | null = null;

export function canGoBack(): boolean {
  return stack.length > 0 || rootCanGoBack;
}

function report(force = false) {
  const can = canGoBack();
  if (!force && can === reported) return;
  reported = can;
  setNativeBackState(can);
}

/** 창을 열 때 등록, 반환된 함수로 해제. 뒤로가기는 가장 나중에 등록한 창부터 닫는다 */
export function pushBackHandler(onBack: () => void): () => void {
  const entry: Entry = { onBack };
  stack.push(entry);
  report();
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    report();
  };
}

/** 열린 창이 없을 때의 뒤로가기: 이전 화면이 있으면 handler가 처리하고 true */
export function setRootBack(can: boolean, handler: () => boolean) {
  rootCanGoBack = can;
  rootHandler = handler;
  report();
}

/** 뒤로가기 한 번 처리. 처리할 것이 없으면 false */
export function handleBack(): boolean {
  const top = stack[stack.length - 1];
  if (top) {
    top.onBack();
    return true;
  }
  return !!rootHandler && rootHandler();
}

/** active인 동안 뒤로가기로 onBack이 불리게 함 (창이 닫히면 자동 해제) */
export function useBackHandler(active: boolean, onBack: () => void) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return;
    return pushBackHandler(() => ref.current());
  }, [active]);
}

if (typeof window !== 'undefined') {
  window.addEventListener('hsBackButton', () => {
    if (handleBack()) return;
    // 네이티브는 돌아갈 곳이 있다고 알고 있었지만 실제로는 없음 → 상태를 바로잡고 종료 안내
    reported = false;
    armNativeExit();
  });
  // 웹 화면이 다시 불러와지면(WebView 재시작 등) 네이티브의 이전 상태를 덮어씀
  report(true);
}
