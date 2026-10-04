package kr.ac.hs.lmsnotifier;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONException;

@CapacitorPlugin(name = "NativeAppLauncher")
public class NativeAppLauncherPlugin extends Plugin {

    @PluginMethod
    public void launchApp(PluginCall call) {
        String primaryPackage = call.getString("packageName");
        JSArray fallbackArray = call.getArray("fallbackPackages");

        List<String> candidates = new ArrayList<>();
        if (primaryPackage != null && !primaryPackage.trim().isEmpty()) {
            candidates.add(primaryPackage.trim());
        }

        if (fallbackArray != null) {
            for (int i = 0; i < fallbackArray.length(); i++) {
                try {
                    String pkg = fallbackArray.getString(i);
                    if (pkg != null && !pkg.trim().isEmpty() && !candidates.contains(pkg.trim())) {
                        candidates.add(pkg.trim());
                    }
                } catch (JSONException ignored) {
                }
            }
        }

        if (candidates.isEmpty()) {
            call.reject("packageName is required");
            return;
        }

        Context context = getActivity() != null ? getActivity() : getContext();
        PackageManager pm = context.getPackageManager();

        try {
            // 1. 후보 패키지 목록을 순차적으로 탐색하여 설치된 앱 실행
            for (String pkg : candidates) {
                Intent launchIntent = pm.getLaunchIntentForPackage(pkg);
                if (launchIntent == null) {
                    try {
                        pm.getPackageInfo(pkg, 0);
                        launchIntent = new Intent(Intent.ACTION_MAIN);
                        launchIntent.addCategory(Intent.CATEGORY_LAUNCHER);
                        launchIntent.setPackage(pkg);
                    } catch (PackageManager.NameNotFoundException ignored) {
                        launchIntent = null;
                    }
                }

                if (launchIntent != null) {
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
                    context.startActivity(launchIntent);
                    JSObject ret = new JSObject();
                    ret.put("status", "launched");
                    ret.put("package", pkg);
                    call.resolve(ret);
                    return;
                }
            }

            // 2. 미설치 시 기본 대표 패키지로 구글 플레이스토어 안내
            String targetPkg = candidates.get(0);
            try {
                Intent marketIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + targetPkg));
                marketIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(marketIntent);
            } catch (Exception e) {
                Intent webIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + targetPkg));
                webIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(webIntent);
            }

            JSObject ret = new JSObject();
            ret.put("status", "market_opened");
            ret.put("package", targetPkg);
            call.resolve(ret);
        } catch (Exception ex) {
            call.reject("Failed to launch app or store: " + ex.getMessage());
        }
    }
}
