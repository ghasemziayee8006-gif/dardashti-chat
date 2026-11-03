package com.dardashti.chat;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;

/**
 * دردشتي — تطبيق أندرويد (عميل رفيع)
 * يعرض تطبيق الويب الحقيقي من الخادم: حسابات فعلية، دردشة لحظية،
 * مكالمات فيديو وصوت ومشاركة شاشة بين المستخدمين.
 *
 * - يعمل بدون إنترنت: تظهر صفحة عربية أنيقة مع زر إعادة المحاولة.
 * - عنوان الخادم قابل للتغيير من داخل التطبيق (يُحفظ على الجهاز).
 * - الكاميرا والمايك ممنوحان لواجهة الويب لمكالمات الفيديو.
 */
public class MainActivity extends Activity {

    /** عنوان الخادم الافتراضي — يُستخدم أول مرة ويمكن تغييره من صفحة الإعدادات */
    private static final String DEFAULT_SERVER = "https://ws-70d3f316-58f6-4a8d-908e-1585b00e4748.space-z.ai/";
    private static final String PREFS = "dardashti_prefs";
    private static final String KEY_SERVER = "server_url";

    private WebView webView;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestAppPermissions();
        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        // يسمح للتطبيق الويب بالحفظ الدائم للجلسة (بقاء تسجيل الدخول)
        s.setUserAgentString(s.getUserAgentString() + " DardashtiApp/1.0");

        webView.setBackgroundColor(0xFF0E1621);
        webView.addJavascriptInterface(new Bridge(), "Android");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // منح الكاميرا/المايك لصفحة التطبيق (مكالمات الفيديو)
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        request.grant(request.getResources());
                    }
                });
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (failingUrl != null && failingUrl.startsWith("http")) {
                    view.loadUrl("file:///android_asset/offline.html");
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && request.getUrl().toString().startsWith("http")) {
                    view.loadUrl("file:///android_asset/offline.html");
                }
            }
        });

        setContentView(webView);
        loadMain();
    }

    private void loadMain() {
        webView.loadUrl(prefs.getString(KEY_SERVER, DEFAULT_SERVER));
    }

    /** جسر بسيط بين صفحات HTML المحلية والتطبيق */
    private class Bridge {
        @JavascriptInterface
        public void retry() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { loadMain(); }
            });
        }

        @JavascriptInterface
        public void saveServerUrl(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    String u = url == null ? "" : url.trim();
                    if (!u.startsWith("http")) u = "https://" + u;
                    while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
                    prefs.edit().putString(KEY_SERVER, u).apply();
                    loadMain();
                }
            });
        }

        @JavascriptInterface
        public String currentUrl() {
            return prefs.getString(KEY_SERVER, DEFAULT_SERVER);
        }
    }

    private void requestAppPermissions() {
        if (Build.VERSION.SDK_INT >= 23) {
            String[] needed = new String[]{ Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO };
            boolean missing = false;
            for (String p : needed) {
                if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing = true;
            }
            if (missing) requestPermissions(needed, 100);
        }
    }

    @Override
    public void onBackPressed() {
        String u = webView.getUrl();
        if (u != null && u.startsWith("file:")) {
            // من صفحة عدم الاتصال/الإعدادات: الرجوع يعيد محاولة الاتصال
            loadMain();
            return;
        }
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
