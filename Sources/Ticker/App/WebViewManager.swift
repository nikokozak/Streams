import WebKit

/// Manages the WKWebView and Swift ↔ JS bridge
@MainActor
final class WebViewManager: NSObject {
    let webView: WKWebView
    private let bridgeService: BridgeService

    override init() {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        self.bridgeService = BridgeService()
        config.userContentController.add(bridgeService, name: "bridge")

        self.webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        bridgeService.webView = webView
        bridgeService.onMessage = { [weak self] message in
            self?.handleMessage(message)
        }

        loadWebContent()
    }

    private func loadWebContent() {
        // In development, load from Vite dev server
        // In production, load from bundled resources
        #if DEBUG
        if let url = URL(string: "http://localhost:5173") {
            webView.load(URLRequest(url: url))
        }
        #else
        if let resourceURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Resources") {
            webView.loadFileURL(resourceURL, allowingReadAccessTo: resourceURL.deletingLastPathComponent())
        }
        #endif
    }

    private func handleMessage(_ message: BridgeMessage) {
        Task {
            await processMessage(message)
        }
    }

    private func processMessage(_ message: BridgeMessage) async {
        switch message.type {
        case "loadStreams":
            // TODO: Load streams from persistence
            break

        case "loadStream":
            // TODO: Load single stream
            break

        case "createStream":
            // TODO: Create new stream
            break

        case "saveCell":
            // TODO: Save cell
            break

        case "deleteCell":
            // TODO: Delete cell
            break

        case "addSource":
            // TODO: Open file picker, add source
            break

        case "executeAction":
            // TODO: Execute AI action
            break

        case "exportMarkdown":
            // TODO: Export stream
            break

        default:
            print("Unknown message type: \(message.type)")
        }
    }
}
