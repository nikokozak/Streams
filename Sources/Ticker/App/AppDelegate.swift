import AppKit
import WebKit

// Manual entry point for proper app initialization
@main
struct TickerApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    private var mainWindow: NSWindow?
    private var webViewManager: WebViewManager?

    // Quick Panel services
    private var hotkeyService: HotkeyService?
    private var quickPanelManager: QuickPanelManager?

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMenuBar()
        setupMainWindow()
        setupQuickPanel()
        NSApp.activate(ignoringOtherApps: true)
    }

    private func setupMenuBar() {
        let mainMenu = NSMenu()

        // App menu
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu
        appMenu.addItem(withTitle: "About Ticker", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit Ticker", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        // Edit menu (required for copy/paste to work)
        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenuItem.submenu = editMenu
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        NSApp.mainMenu = mainMenu
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
        mainWindow?.appearance = NSAppearance(named: .aqua)  // Force light mode

        webViewManager = WebViewManager()
        mainWindow?.contentView = webViewManager?.webView
        webViewManager?.load()

        mainWindow?.makeKeyAndOrderFront(nil)
    }

    // MARK: - Quick Panel Setup

    private func setupQuickPanel() {
        // Initialize Quick Panel manager on main actor
        Task { @MainActor in
            let manager = QuickPanelManager()
            self.quickPanelManager = manager

            // Configure with services from WebViewManager
            if let wvm = self.webViewManager,
               let persistence = wvm.persistence {
                manager.configure(persistence: persistence, bridgeService: wvm.bridgeService)
            }
        }

        // Initialize hotkey service
        hotkeyService = HotkeyService()

        // Register Quick Panel hotkey (Cmd+L)
        hotkeyService?.register(config: .quickPanel) { [weak self] in
            Task { @MainActor in
                self?.quickPanelManager?.toggle()
            }
        }

        // Register Screenshot hotkey (Cmd+;)
        hotkeyService?.register(config: .screenshot) { [weak self] in
            Task { @MainActor in
                self?.captureScreenshot()
            }
        }
    }

    /// Capture screenshot using system tool, then show Quick Panel
    private func captureScreenshot() {
        // Use screencapture to capture to clipboard
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        process.arguments = ["-ic"]  // Interactive, clipboard

        process.terminationHandler = { [weak self] _ in
            Task { @MainActor in
                // Short delay to allow clipboard to update
                try? await Task.sleep(nanoseconds: 100_000_000)  // 0.1s
                self?.quickPanelManager?.showAfterScreenshot()
            }
        }

        do {
            try process.run()
        } catch {
            print("Failed to run screencapture: \(error)")
        }
    }
}
