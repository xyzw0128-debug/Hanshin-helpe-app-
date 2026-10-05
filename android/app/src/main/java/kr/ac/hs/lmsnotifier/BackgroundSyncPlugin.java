package kr.ac.hs.lmsnotifier;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import android.webkit.CookieManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;

@CapacitorPlugin(name = "BackgroundSync")
public class BackgroundSyncPlugin extends Plugin {
    public static final String UNIQUE_WORK_NAME = "lms_background_sync_work";

    @PluginMethod
    public void configure(PluginCall call) {
        Boolean enabledObj = call.getBoolean("enabled");
        boolean enabled = enabledObj != null ? enabledObj : true;

        Integer intervalObj = call.getInt("intervalMinutes");
        int intervalMinutes = intervalObj != null ? intervalObj : 30;

        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(BackgroundSyncWorker.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
                .putBoolean(BackgroundSyncWorker.PREF_ENABLED, enabled)
                .putInt(BackgroundSyncWorker.PREF_INTERVAL_MINUTES, intervalMinutes)
                .apply();

        try {
            android.webkit.CookieManager.getInstance().flush();
        } catch (Exception ignored) {
        }

        WorkManager wm = WorkManager.getInstance(context);
        if (!enabled || intervalMinutes <= 0) {
            wm.cancelUniqueWork(UNIQUE_WORK_NAME);
            wm.cancelUniqueWork(BackgroundSyncWorker.TEST_WORK_NAME);
            prefs.edit()
                    .remove(BackgroundSyncWorker.PREF_SEEN_ITEM_IDS)
                    .putBoolean(BackgroundSyncWorker.PREF_HAS_SEEDED, false)
                    .apply();
        } else if (BackgroundSyncWorker.isTestInterval(context, intervalMinutes)) {
            // 디버그 빌드 테스트 모드: 주기 작업 대신 n분 뒤 1회 실행을 워커가 계속 이어서 예약
            wm.cancelUniqueWork(UNIQUE_WORK_NAME);
            BackgroundSyncWorker.scheduleTestRun(context, intervalMinutes, ExistingWorkPolicy.REPLACE);
        } else {
            wm.cancelUniqueWork(BackgroundSyncWorker.TEST_WORK_NAME);
            // Android WorkManager 최소 허용 주기: 15분 (릴리스 빌드에서 15분 미만 값이 와도 15분으로)
            long interval = Math.max(BackgroundSyncWorker.MIN_PERIODIC_MINUTES, intervalMinutes);

            Constraints constraints = new Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build();

            PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                    BackgroundSyncWorker.class,
                    interval,
                    TimeUnit.MINUTES
            )
                    .setConstraints(constraints)
                    .build();

            // UPDATE: 앱 실행마다 호출돼도 기존 주기 타이밍을 유지 (CANCEL_AND_REENQUEUE는 매번 즉시 재실행)
            wm.enqueueUniquePeriodicWork(
                    UNIQUE_WORK_NAME,
                    ExistingPeriodicWorkPolicy.UPDATE,
                    request
            );
        }

        DebugLog.log(context, "plugin", "configure enabled=" + enabled + " interval=" + intervalMinutes + "min");
        JSObject ret = new JSObject();
        ret.put("success", true);
        ret.put("enabled", enabled);
        ret.put("intervalMinutes", intervalMinutes);
        call.resolve(ret);
    }

    /**
     * 현재 WebView CookieManager의 LMS 세션 쿠키 사본을 보관 (로그인/동기화 성공 직후 호출)
     */
    @PluginMethod
    public void saveSession(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(BackgroundSyncWorker.PREFS_NAME, Context.MODE_PRIVATE);
        String cookie = CookieManager.getInstance().getCookie(BackgroundSyncWorker.LMS_BASE);
        boolean saved = cookie != null && cookie.contains("JSESSIONID");
        if (saved) {
            // 로그인·동기화 성공 직후에만 호출되므로 세션 정상 시각도 기록하고, 동기화 멈춤 알림을 해제
            prefs.edit()
                    .putString(BackgroundSyncWorker.PREF_SESSION_COOKIE, cookie)
                    .putLong(BackgroundSyncWorker.PREF_SESSION_OK_AT, System.currentTimeMillis())
                    .apply();
            BackgroundSyncWorker.clearSyncStopped(getContext(), prefs);
        }
        DebugLog.log(getContext(), "plugin", "saveSession saved=" + saved);
        JSObject ret = new JSObject();
        ret.put("saved", saved);
        call.resolve(ret);
    }

    /**
     * Capacitor가 앱 시작 시 지운 LMS 세션 쿠키를 보관 사본에서 복원 (불필요한 SSO 재로그인 방지)
     */
    @PluginMethod
    public void restoreSession(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(BackgroundSyncWorker.PREFS_NAME, Context.MODE_PRIVATE);
        CookieManager cm = CookieManager.getInstance();
        String current = cm.getCookie(BackgroundSyncWorker.LMS_BASE);
        String saved = prefs.getString(BackgroundSyncWorker.PREF_SESSION_COOKIE, null);
        boolean restored = false;
        if ((current == null || !current.contains("JSESSIONID")) && saved != null && saved.contains("JSESSIONID")) {
            for (String pair : saved.split(";")) {
                String trimmed = pair.trim();
                if (!trimmed.isEmpty() && trimmed.contains("=")) {
                    cm.setCookie(BackgroundSyncWorker.LMS_BASE, trimmed + "; Path=/");
                }
            }
            cm.flush();
            restored = true;
        }
        DebugLog.log(getContext(), "plugin", "restoreSession restored=" + restored
                + " (cookieManagerHadSession=" + (current != null && current.contains("JSESSIONID"))
                + ", savedCopy=" + (saved != null && saved.contains("JSESSIONID")) + ")");
        JSObject ret = new JSObject();
        ret.put("restored", restored);
        // 복원했든 원래 있었든 세션 쿠키가 있는지 (없으면 끊긴 세션이 아니라 처음부터 세션이 없는 상태)
        ret.put("hasCookie", restored || (current != null && current.contains("JSESSIONID")));
        call.resolve(ret);
    }

    /**
     * 로그아웃 시 보관 중인 세션 쿠키와 알림 이력 삭제
     */
    @PluginMethod
    public void clearSession(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(BackgroundSyncWorker.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
                .remove(BackgroundSyncWorker.PREF_SESSION_COOKIE)
                .remove(BackgroundSyncWorker.PREF_SEEN_ITEM_IDS)
                .putBoolean(BackgroundSyncWorker.PREF_HAS_SEEDED, false)
                .apply();
        DebugLog.log(getContext(), "plugin", "clearSession");
        call.resolve();
    }

    /**
     * 백그라운드 워커가 이미 알린 항목 ID 목록 (포그라운드 중복 알림 방지용)
     */
    @PluginMethod
    public void getSeenItems(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(BackgroundSyncWorker.PREFS_NAME, Context.MODE_PRIVATE);
        Set<String> seen = prefs.getStringSet(BackgroundSyncWorker.PREF_SEEN_ITEM_IDS, new HashSet<>());
        JSObject ret = new JSObject();
        ret.put("ids", new JSArray(seen));
        call.resolve(ret);
    }

    /**
     * 포그라운드 동기화에서 확인한 항목 ID를 워커의 알림 이력에 병합 (워커 중복 알림 방지용)
     */
    @PluginMethod
    public void markItemsSeen(PluginCall call) {
        JSArray ids = call.getArray("ids");
        SharedPreferences prefs = getContext().getSharedPreferences(BackgroundSyncWorker.PREFS_NAME, Context.MODE_PRIVATE);
        Set<String> seen = new HashSet<>(prefs.getStringSet(BackgroundSyncWorker.PREF_SEEN_ITEM_IDS, new HashSet<>()));
        if (ids != null) {
            JSONArray arr = ids;
            for (int i = 0; i < arr.length(); i++) {
                String id = arr.optString(i, "");
                if (!id.isEmpty()) seen.add(id);
            }
        }
        prefs.edit()
                .putStringSet(BackgroundSyncWorker.PREF_SEEN_ITEM_IDS, seen)
                .putBoolean(BackgroundSyncWorker.PREF_HAS_SEEDED, true)
                .apply();
        DebugLog.log(getContext(), "plugin", "markItemsSeen +" + (ids != null ? ids.length() : 0) + " (total " + seen.size() + ")");
        call.resolve();
    }

    /**
     * 디버그 빌드 여부 및 네이티브 로그 (릴리스 빌드에서는 enabled=false, log="")
     */
    @PluginMethod
    public void getDebugLog(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", DebugLog.isEnabled(getContext()));
        ret.put("debugBuild", DebugLog.isDebugBuild(getContext()));
        ret.put("log", DebugLog.read(getContext()));
        call.resolve(ret);
    }

    /**
     * 배포 앱의 "문제 신고용 로그" 켜기/끄기 (디버그 빌드는 항상 켜짐)
     */
    @PluginMethod
    public void setReportLog(PluginCall call) {
        Boolean enabledObj = call.getBoolean("enabled");
        DebugLog.setReportEnabled(getContext(), enabledObj != null && enabledObj);
        JSObject ret = new JSObject();
        ret.put("enabled", DebugLog.isEnabled(getContext()));
        call.resolve(ret);
    }

    /**
     * 앱이 "다른 PC 에서 로그인" 응답을 받았을 때 워커에도 기록 (멈춤 알림 문구와 재로그인 판단에 사용)
     */
    @PluginMethod
    public void recordSessionKicked(PluginCall call) {
        getContext().getSharedPreferences(BackgroundSyncWorker.PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putLong(BackgroundSyncWorker.PREF_SESSION_KICKED_AT, System.currentTimeMillis()).apply();
        call.resolve();
    }

    @PluginMethod
    public void clearDebugLog(PluginCall call) {
        DebugLog.clear(getContext());
        call.resolve();
    }

    /**
     * 텍스트를 안드로이드 공유 시트로 전달 (카카오톡/메일 등으로 로그 전송)
     */
    @PluginMethod
    public void shareText(PluginCall call) {
        String text = call.getString("text", "");
        String title = call.getString("title", "LMS 디버그 로그");
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_SUBJECT, title);
        send.putExtra(Intent.EXTRA_TEXT, text);
        Intent chooser = Intent.createChooser(send, title);
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().startActivity(chooser);
                call.resolve();
            } catch (Exception e) {
                call.reject("공유를 시작할 수 없습니다: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(BackgroundSyncWorker.PREFS_NAME, Context.MODE_PRIVATE);

        String lastSyncTime = prefs.getString(BackgroundSyncWorker.PREF_LAST_SYNC_TIME, "동기화 이력 없음");
        String lastStatus = prefs.getString(BackgroundSyncWorker.PREF_LAST_STATUS, "대기 중");
        boolean enabled = prefs.getBoolean(BackgroundSyncWorker.PREF_ENABLED, true);
        int intervalMinutes = prefs.getInt(BackgroundSyncWorker.PREF_INTERVAL_MINUTES, 30);

        JSObject ret = new JSObject();
        ret.put("lastSyncTime", lastSyncTime);
        ret.put("lastStatus", lastStatus);
        ret.put("enabled", enabled);
        ret.put("intervalMinutes", intervalMinutes);
        // 앱의 PC 세션 보호 판단(sessionGuard.ts)이 워커 기록도 함께 보도록 전달
        ret.put("sessionOkAt", prefs.getLong(BackgroundSyncWorker.PREF_SESSION_OK_AT, 0L));
        ret.put("sessionKickedAt", prefs.getLong(BackgroundSyncWorker.PREF_SESSION_KICKED_AT, 0L));
        ret.put("sessionExpiredAt", prefs.getLong(BackgroundSyncWorker.PREF_SESSION_EXPIRED_AT, 0L));
        call.resolve(ret);
    }
}
