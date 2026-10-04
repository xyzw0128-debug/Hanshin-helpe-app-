package kr.ac.hs.lmsnotifier;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeAppLauncherPlugin.class);
        registerPlugin(BackgroundSyncPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

