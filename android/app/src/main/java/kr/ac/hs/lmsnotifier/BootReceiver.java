package kr.ac.hs.lmsnotifier;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 재부팅·앱 업데이트·시간 변경 뒤 마감 알림을 다시 예약 (AlarmManager 예약은 재부팅 시 사라짐)
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        DebugLog.log(context, "reminder", "reschedule after " + action);
        DeadlineReminders.reschedule(context);
    }
}
