package kr.ac.hs.lmsnotifier;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 마감 알림 알람 수신 → DeadlineReminders.fire */
public class DeadlineReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !DeadlineReminders.ACTION_REMIND.equals(intent.getAction())) return;
        String itemId = intent.getStringExtra(DeadlineReminders.EXTRA_ITEM_ID);
        String slot = intent.getStringExtra(DeadlineReminders.EXTRA_SLOT);
        if (itemId == null || slot == null) return;
        DeadlineReminders.fire(context, itemId, slot);
    }
}
