package kr.ac.hs.lmsnotifier;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // 첫 번째 뒤로가기 후 이 시간 안에 한 번 더 누르면 종료 (ExitHint.tsx의 EXIT_HINT_MS와 같은 값)
    private static final long EXIT_CONFIRM_WINDOW_MS = 2000;
    // 웹 화면(ExitHint.tsx)에 "한 번 더 누르면 종료" 안내를 띄우는 이벤트
    private static final String EXIT_HINT_EVENT = "hsBackExitHint";
    // 웹 화면(backNav.ts)에 뒤로가기를 넘기는 이벤트: 열린 창 닫기 → 이전 화면 → 홈
    private static final String BACK_EVENT = "hsBackButton";
    // 알림을 눌러 이미 실행 중인 앱이 열렸을 때 웹 화면에 이동할 곳이 생겼음을 알리는 이벤트
    static final String OPEN_TARGET_EVENT = "hsOpenTarget";

    static final String EXTRA_OPEN = "hs_open";
    static final String EXTRA_ITEM = "hs_item";

    /** 웹 화면이 알려 주는 "뒤로 갈 곳이 있는지" (AppShellPlugin.setBackState) */
    static volatile boolean webCanGoBack = false;
    /** 알림·위젯을 눌러 열었을 때 웹 화면이 가져갈 이동 대상 (AppShellPlugin.consumeOpenTarget) */
    static volatile String pendingOpenTarget = null;
    static volatile String pendingOpenItem = null;

    private long lastBackPressedAt = 0;

    /** 알림·위젯에서 앱의 특정 화면을 여는 인텐트. target 예: "lms:assignments", itemId: 열 항목 ID(없으면 null) */
    static Intent openIntent(Context context, String target, String itemId) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (target != null) intent.putExtra(EXTRA_OPEN, target);
        if (itemId != null) intent.putExtra(EXTRA_ITEM, itemId);
        return intent;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeAppLauncherPlugin.class);
        registerPlugin(BackgroundSyncPlugin.class);
        registerPlugin(AppShellPlugin.class);
        super.onCreate(savedInstanceState);
        if (savedInstanceState == null) captureOpenTarget(getIntent());

        // 안드로이드 뒤로가기
        // 1) 웹 화면에 돌아갈 곳(열린 바텀시트·하위 화면·시간표 상세, 이전 탭, 홈이 아닌 탭)이 있으면 웹 화면에 맡김
        // 2) 홈에서는 한 번 누르면 안내만 띄우고, 2초 안에 한 번 더 누르면 기본 동작(앱 나가기)
        // WebView history(canGoBack)에 기대지 않음: 사용자 동작 없이 쌓인 항목은 Chromium이 건너뛰어 바로 종료될 수 있음
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                boolean toWeb = webCanGoBack && getBridge() != null;
                DebugLog.log(MainActivity.this, "back", toWeb ? "to web" : "exit check");
                if (toWeb) {
                    lastBackPressedAt = 0;
                    getBridge().triggerWindowJSEvent(BACK_EVENT);
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
                armExit();
            }
        });
    }

    /** 다음 뒤로가기(2초 안)에 앱을 나가도록 준비하고 안내를 띄움. 웹 화면이 닫을 것이 없다고 답할 때도 사용 */
    void armExit() {
        lastBackPressedAt = SystemClock.uptimeMillis();
        if (getBridge() != null) {
            getBridge().triggerWindowJSEvent(EXIT_HINT_EVENT);
        } else {
            Toast.makeText(this, "뒤로 버튼을 한 번 더 누르면 종료돼요", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (captureOpenTarget(intent) && getBridge() != null) {
            getBridge().triggerWindowJSEvent(OPEN_TARGET_EVENT);
        }
    }

    private static boolean captureOpenTarget(Intent intent) {
        if (intent == null) return false;
        String target = intent.getStringExtra(EXTRA_OPEN);
        if (target == null || target.isEmpty()) return false;
        pendingOpenTarget = target;
        pendingOpenItem = intent.getStringExtra(EXTRA_ITEM);
        // 같은 인텐트로 화면이 다시 만들어질 때(회전 등) 반복 이동하지 않도록 비움
        intent.removeExtra(EXTRA_OPEN);
        intent.removeExtra(EXTRA_ITEM);
        return true;
    }
}
