package com.alpacaplayhouse.kiosk

import android.graphics.Bitmap
import android.net.http.SslError
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

class KioskWebViewClient(private val activity: MainActivity) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        // Keep all navigation within the WebView
        return false
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        // Inject CSS to hide any scrollbars
        view?.evaluateJavascript(
            """
            (function() {
                var style = document.createElement('style');
                style.textContent = '::-webkit-scrollbar { display: none; } body { overflow: hidden; }';
                document.head.appendChild(style);
            })();
            """.trimIndent(),
            null
        )
    }

    override fun onReceivedError(
        view: WebView?,
        request: WebResourceRequest?,
        error: WebResourceError?
    ) {
        super.onReceivedError(view, request, error)
        // Only handle main frame errors
        if (request?.isForMainFrame == true) {
            view?.loadData(
                getOfflineHtml(),
                "text/html",
                "UTF-8"
            )
        }
    }

    override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
        // In kiosk mode on local network, we may encounter self-signed certs
        // Only proceed for our known domains
        val url = error?.url ?: ""
        if (url.contains("alpacaplayhouse.com") || url.contains("localhost")) {
            handler?.proceed()
        } else {
            handler?.cancel()
        }
    }

    private fun getOfflineHtml(): String {
        return """
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    margin: 0;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    background: #1a1a2e;
                    color: #e0e0e0;
                    font-family: -apple-system, sans-serif;
                    text-align: center;
                }
                .container {
                    padding: 40px;
                }
                .icon {
                    font-size: 80px;
                    margin-bottom: 20px;
                }
                h1 {
                    font-size: 24px;
                    margin-bottom: 10px;
                    color: #ffffff;
                }
                p {
                    font-size: 16px;
                    color: #aaaaaa;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="icon">&#x1F999;</div>
                <h1>No Connection</h1>
                <p>Waiting for network...<br>The page will reload automatically.</p>
            </div>
        </body>
        </html>
        """.trimIndent()
    }
}
