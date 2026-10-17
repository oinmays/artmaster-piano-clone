import SwiftUI
import UIKit
import WebKit

/// Full-screen WKWebView hosting the Keys web app, with CoreMIDI bridged in (see MIDIBridge).
struct KeysWebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // Keep WebKit's own UA (so the site's iPhone/iPad detection still works) and append ours.
        config.applicationNameForUserAgent = "Mobile/15E148 KeysApp/\(AppConfig.version)"

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never // the site uses env(safe-area-inset-*)
        webView.scrollView.bounces = false
        webView.allowsBackForwardNavigationGestures = false
        #if DEBUG
        webView.isInspectable = true // Safari → Develop → <device> for the web inspector
        #endif
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator

        context.coordinator.attach(webView)
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private let bridge = MIDIBridge()

        func attach(_ webView: WKWebView) {
            bridge.attach(webView)
        }

        // MARK: WKNavigationDelegate

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // The page may have reloaded: re-send the current device list.
            bridge.sendDevices()
            #if DEBUG
            // Confirms the bridge from the device log: `log stream --predicate 'eventMessage CONTAINS "Keys:"'`.
            webView.evaluateJavaScript("JSON.stringify(window.keysNative)") { result, error in
                NSLog("Keys: loaded \(webView.url?.absoluteString ?? "?") keysNative=\(result ?? error ?? "nil")")
            }
            #endif
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // Links that leave the site (user taps on other hosts) open in Safari.
            if navigationAction.navigationType == .linkActivated,
               let target = navigationAction.request.url,
               let host = target.host, host != AppConfig.siteHost,
               target.scheme == "https" || target.scheme == "http" {
                UIApplication.shared.open(target)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        // MARK: WKUIDelegate

        /// Grant mic access to the app's own site only, so its mic mode keeps working without a
        /// second WebKit prompt (iOS still asks once for the app's microphone permission).
        func webView(_ webView: WKWebView,
                     requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo,
                     type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            let ours = origin.protocol == "https" && origin.host == AppConfig.siteHost
            decisionHandler(ours && type == .microphone ? .grant : .prompt)
        }

        /// target="_blank" links: open in Safari rather than silently doing nothing.
        func webView(_ webView: WKWebView,
                     createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction,
                     windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let target = navigationAction.request.url {
                if target.host == AppConfig.siteHost {
                    webView.load(navigationAction.request)
                } else {
                    UIApplication.shared.open(target)
                }
            }
            return nil
        }
    }
}
