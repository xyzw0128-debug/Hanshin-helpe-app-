import { useEffect, useState } from 'react';

/**
 * 지금 시각. 매 분 0초에 맞춰 다시 그리고, 앱으로 돌아오면 바로 갱신한다(백그라운드에서는 WebView 타이머가 멈춤).
 * "n분 후"·D-day·진행 중/지난 항목처럼 현재 시각에 따라 바뀌는 표시는 이 값으로 계산해야
 * 다른 탭에 갔다 오거나 앱을 다시 켜지 않아도 제때 바뀐다.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      schedule();
    };
    const schedule = () => {
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      tick();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return now;
}
