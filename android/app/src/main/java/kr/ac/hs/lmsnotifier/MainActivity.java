package kr.ac.hs.lmsnotifier;

import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // 첫 번째 뒤로가기 후 이 시간 안에 한 번 더 누르면 종료 (ExitHint.tsx의 EXIT_HINT_MS와 같은 값)
    private static final long EXIT_CONFIRM_WINDOW_MS = 2000;
    // 웹 화면(ExitHint.tsx)에 "한 번 더 누르면 종료" 안내를 띄우는 이벤트
    private static final String EXIT_HINT_EVENT = "hsBackExitHint";

    private long lastBackPressedAt = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeAppLauncherPlugin.class);
        registerPlugin(BackgroundSyncPlugin.class);
        super.onCreate(savedInstanceState);

        // 안드로이드 뒤로가기
        // 1) 웹 화면에 돌아갈 history가 있으면 WebView 뒤로가기 → popstate로 바텀시트·하위 화면을 닫거나 홈 탭으로 이동
        // 2) 홈 탭에서는 한 번 누르면 안내만 띄우고, 2초 안에 한 번 더 누르면 기본 동작(앱 나가기)
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                    return;
                }

                long now = SystemClock.uptimeMillis();
                if (now - lastBackPressedAt < EXIT_CONFIRM_WINDOW_MS) {
                    lastBackPressedAt = 0;
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                    return;
                }

                lastBackPressedAt = now;
                if (getBridge() != null) {
                    getBridge().triggerWindowJSEvent(EXIT_HINT_EVENT);
                } else {
                    Toast.makeText(MainActivity.this, "뒤로 버튼을 한 번 더 누르면 종료돼요", Toast.LENGTH_SHORT).show();
                }
            }
        });
    }
}
