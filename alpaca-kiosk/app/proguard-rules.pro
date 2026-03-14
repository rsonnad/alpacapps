# NanoHTTPD
-keep class fi.iki.elonen.** { *; }

# Supabase
-keep class io.github.jan.supabase.** { *; }

# Ktor
-keep class io.ktor.** { *; }

# Keep JS bridge methods accessible from WebView
-keepclassmembers class com.alpacaplayhouse.kiosk.JsBridge {
    @android.webkit.JavascriptInterface <methods>;
}
