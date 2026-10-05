import React from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { debugLog } from '../services/debugLog';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 화면을 그리다 오류가 나도 흰 화면만 남지 않게 안내와 "다시 시도"를 보여 준다.
 * 화면 조각(lazy) 불러오기 실패(업데이트 직후 등)는 앱을 다시 불러오면 대부분 해결된다.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    debugLog('app', '화면 오류', {
      message: error?.message,
      stack: (info?.componentStack || '').split('\n').slice(0, 6).join(' | '),
    });
  }

  private retry = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    const chunkError = /dynamically imported module|Loading chunk|Importing a module script failed/i.test(
      this.state.error.message || ''
    );
    return (
      <div className="min-h-screen max-w-md mx-auto bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center p-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-950/60 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-base font-black text-zinc-900 dark:text-white">화면을 표시하다 문제가 생겼어요</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
            {chunkError
              ? '앱을 다시 불러오면 대부분 해결돼요.'
              : '다시 시도해도 계속되면 앱 정보의 문의하기로 알려 주세요. 저장된 과제·공지는 그대로 있어요.'}
          </p>
        </div>
        <div className="flex gap-2 w-full max-w-xs">
          {!chunkError && (
            <button
              onClick={this.retry}
              className="flex-1 py-2.5 bg-hs-700 dark:bg-hs-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5"
            >
              <RotateCw className="w-3.5 h-3.5" />
              다시 시도
            </button>
          )}
          <button
            onClick={() => window.location.reload()}
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl ${
              chunkError
                ? 'bg-hs-700 dark:bg-hs-500 text-white'
                : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
            }`}
          >
            앱 다시 불러오기
          </button>
        </div>
      </div>
    );
  }
}
