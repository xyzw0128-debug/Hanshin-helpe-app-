# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.

# Preserve line numbers for stack traces
-keepattributes SourceFile,LineNumberTable
-keepattributes *Annotation*

# Capacitor & Plugin reflection protection
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-keep public class * extends com.getcapacitor.Plugin
-keep public class * extends com.getcapacitor.Bridge
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public *;
    @com.getcapacitor.annotation.CapacitorPlugin public *;
    @android.webkit.JavascriptInterface <methods>;
}

# Android KeyStore / Secure Storage Protection
-keep class com.aparajita.capacitor.securestorage.** { *; }
-keep class androidx.security.crypto.** { *; }

# AndroidX WorkManager Worker Protection
-keep class * extends androidx.work.Worker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
-keep class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
