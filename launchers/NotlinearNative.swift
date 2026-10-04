import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var serverProcess: Process?

    // See NotlinearRepoRoot() in NotlinearNative.m for the same logic and the
    // reasoning. NOTLINEAR_ROOT in the environment wins; otherwise walk up from
    // the bundle looking for backend/server.py. (This Swift variant is not what
    // launchers/build-macos-app.command compiles — that builds the .m file.)
    private let appDirectory: String? = {
        let fm = FileManager.default
        let hasCheckout = { (dir: String) in
            fm.fileExists(atPath: (dir as NSString).appendingPathComponent("backend/server.py"))
        }
        if let fromEnv = ProcessInfo.processInfo.environment["NOTLINEAR_ROOT"], hasCheckout(fromEnv) {
            return fromEnv
        }
        var dir = Bundle.main.bundlePath
        while dir.count > 1 {
            if hasCheckout(dir) { return dir }
            dir = (dir as NSString).deletingLastPathComponent
        }
        return nil
    }()
    private let port = "8765"
    private let host = "127.0.0.1"

    func applicationDidFinishLaunching(_ notification: Notification) {
        startServerIfNeeded()
        createWindow()
        loadApp()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        serverProcess?.terminate()
    }

    private func startServerIfNeeded() {
        if isServerRunning() { return }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = ["backend/server.py", "--port", port, "--host", host]
        guard let appDirectory else {
            NSLog("notlinear: no checkout found — set NOTLINEAR_ROOT")
            return
        }
        process.currentDirectoryURL = URL(fileURLWithPath: appDirectory)
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            serverProcess = process
            Thread.sleep(forTimeInterval: 0.8)
        } catch {
            showError("Could not start Notlinear server: \(error.localizedDescription)")
        }
    }

    private func isServerRunning() -> Bool {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        process.arguments = ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN"]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus == 0
        } catch {
            return false
        }
    }

    private func createWindow() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()

        // Let JS know it's running inside the desktop app so file-picker logic
        // skips osascript and uses WKUIDelegate (runOpenPanelWith) directly.
        let desktopFlag = WKUserScript(
            source: "window.__notlinearDesktop = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(desktopFlag)

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Notlinear"
        window.minSize = NSSize(width: 900, height: 620)
        window.center()
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
    }

    private func loadApp() {
        let url = URL(string: "http://\(host):\(port)/frontend/index.html")!
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    // WKUIDelegate — required for file inputs to open the native file picker
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = !parameters.allowsDirectories
        panel.begin { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    // Open target="_blank" / window.open links in the default browser.
    // Without this, WKWebView silently drops the click and links appear dead.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Notlinear"
        alert.informativeText = message
        alert.alertStyle = .critical
        alert.runModal()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
