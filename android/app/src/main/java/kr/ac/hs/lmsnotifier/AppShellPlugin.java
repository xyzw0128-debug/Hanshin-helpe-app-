package kr.ac.hs.lmsnotifier;

import android.app.AlarmManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.CalendarContract;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 앱 화면(웹)과 안드로이드 사이의 기본 기능: 뒤로가기 상태, 알림·위젯으로 연 화면, 배터리·알림 권한 설정, 캘린더 추가
 */
@CapacitorPlugin(name = "AppShell")
public class AppShellPlugin extends Plugin {

    /** 웹 화면에 뒤로 갈 곳이 있는지 (있으면 뒤로가기를 웹 화면에 넘기고, 없으면 두 번 눌러 종료) */
    @PluginMethod
    public void setBackState(PluginCall call) {
        MainActivity.webCanGoBack = Boolean.TRUE.equals(call.getBoolean("canGoBack", false));
        call.resolve();
    }

    /** 웹 화면이 뒤로가기를 받았지만 닫을 것이 없었음 → 종료 안내를 띄우고 다음 뒤로가기에 종료 */
    @PluginMethod
    public void armExit(PluginCall call) {
        MainActivity.webCanGoBack = false;
        if (getActivity() instanceof MainActivity) {
            MainActivity activity = (MainActivity) getActivity();
            activity.runOnUiThread(activity::armExit);
        }
        call.resolve();
    }

    /** 알림·위젯을 눌러 열었을 때 이동할 화면 (한 번 가져가면 비움) */
    @PluginMethod
    public void consumeOpenTarget(PluginCall call) {
        JSObject ret = new JSObject();
        String target = MainActivity.pendingOpenTarget;
        String item = MainActivity.pendingOpenItem;
        MainActivity.pendingOpenTarget = null;
        MainActivity.pendingOpenItem = null;
        if (target != null) ret.put("target", target);
        if (item != null) ret.put("itemId", item);
        call.resolve(ret);
    }

    /** 알림이 늦거나 안 오는 원인 점검: 알림 권한, 배터리 최적화 제외, 정확한 알람 허용 */
    @PluginMethod
    public void getSystemStatus(PluginCall call) {
        Context context = getContext();
        JSObject ret = new JSObject();
        ret.put("notificationsEnabled", NotificationManagerCompat.from(context).areNotificationsEnabled());

        boolean ignoringBattery = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            ignoringBattery = pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName());
        }
        ret.put("ignoringBatteryOptimizations", ignoringBattery);

        boolean exactAlarms = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            exactAlarms = am != null && am.canScheduleExactAlarms();
        }
        ret.put("exactAlarmsAllowed", exactAlarms);
        ret.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        call.resolve(ret);
    }

    /** 배터리 최적화 제외 요청 (백그라운드 확인이 절전 기능에 멈추지 않도록) */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Context context = getContext();
        Uri pkg = Uri.parse("package:" + context.getPackageName());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (start(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg))
                    || start(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))) {
                call.resolve();
                return;
            }
        }
        openAppDetails(call);
    }

    /** 정확한 알람 허용 화면 (Android 12+, 마감 알림을 제시간에) */
    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && start(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName())))) {
            call.resolve();
            return;
        }
        openAppDetails(call);
    }

    /** 이 앱의 알림 설정 화면 (알림 권한을 거절했을 때) */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            if (start(intent)) {
                call.resolve();
                return;
            }
        }
        openAppDetails(call);
    }

    /** 기기 캘린더 앱의 일정 추가 화면을 채워서 엶 (저장은 사용자가 캘린더 앱에서 직접) */
    @PluginMethod
    public void addCalendarEvent(PluginCall call) {
        String title = call.getString("title", "");
        String description = call.getString("description", "");
        // 밀리초 값은 JSON에서 Long으로 들어와 call.getDouble로는 읽히지 않음 (Integer·Double만 처리)
        long begin = call.getData().optLong("beginMs", 0L);
        long end = call.getData().optLong("endMs", 0L);
        if (begin <= 0 || end <= 0) {
            call.reject("일정 시간이 없습니다.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_INSERT)
                .setData(CalendarContract.Events.CONTENT_URI)
                .putExtra(CalendarContract.Events.TITLE, title)
                .putExtra(CalendarContract.Events.DESCRIPTION, description)
                .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, begin)
                .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end);
        if (start(intent)) {
            call.resolve();
        } else {
            call.reject("캘린더 앱을 찾을 수 없습니다.");
        }
    }

    private void openAppDetails(PluginCall call) {
        if (start(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName())))) {
            call.resolve();
        } else {
            call.reject("설정 화면을 열 수 없습니다.");
        }
    }

    private boolean start(Intent intent) {
        try {
            if (getActivity() != null) {
                getActivity().startActivity(intent);
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            DebugLog.log(getContext(), "shell", "cannot open " + intent.getAction() + ": " + e.getClass().getSimpleName());
            return false;
        }
    }
}
