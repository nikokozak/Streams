import AppKit
import WebKit

@main
class AppDelegate: NSObject, NSApplicationDelegate {
    private var mainWindow: NSWindow?
    private var webViewManager: WebViewManager?

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMainWindow()
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Cleanup
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func setupMainWindow() {
        let windowRect = NSRect(x: 0, y: 0, width: 900, height: 700)

        mainWindow = NSWindow(
            contentRect: windowRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )

        mainWindow?.title = "Ticker"
        mainWindow?.center()
        mainWindow?.minSize = NSSize(width: 600, height: 400)

        // Set up WebView
        webViewManager = WebViewManager()
        mainWindow?.contentView = webViewManager?.webView

        mainWindow?.makeKeyAndOrderFront(nil)
    }
}
