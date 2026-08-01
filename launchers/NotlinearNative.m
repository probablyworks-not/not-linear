#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

// ---------------------------------------------------------------------------
// File-picker message handler
// JS calls: window.webkit.messageHandlers.notlinear.postMessage({
//   action: "pickFile", folder: true/false, callbackId: "<id>"
// })
// Native shows NSOpenPanel, reads files, then calls:
//   window.__nlNativeFileCallback("<id>", [{name,size,type,base64},...])
// ---------------------------------------------------------------------------
@interface NotlinearPickFileHandler : NSObject <WKScriptMessageHandler>
@end

@implementation NotlinearPickFileHandler

static const long long kMaxPdfBytes  = 20 * 1024 * 1024;
static const long long kMaxTextBytes =  2 * 1024 * 1024;

- (void)userContentController:(WKUserContentController *)ucc didReceiveScriptMessage:(WKScriptMessage *)msg {
    NSDictionary *body = msg.body;
    if (![body isKindOfClass:[NSDictionary class]]) return;

    if ([@"saveFile" isEqualToString:body[@"action"]]) {
        NSString *filename = body[@"filename"] ?: @"response.md";
        NSString *content  = body[@"content"]  ?: @"";
        WKWebView *wv = msg.webView;

        dispatch_async(dispatch_get_main_queue(), ^{
            NSWindow *win = wv.window;
            NSSavePanel *panel = [NSSavePanel savePanel];
            panel.nameFieldStringValue = filename;
            panel.canCreateDirectories = YES;

            void (^finish)(NSModalResponse) = ^(NSModalResponse r) {
                if (r != NSModalResponseOK || !panel.URL) return;
                NSData *data = [content dataUsingEncoding:NSUTF8StringEncoding];
                [data writeToURL:panel.URL atomically:YES];
            };

            if (win) {
                [panel beginSheetModalForWindow:win completionHandler:finish];
            } else {
                [panel beginWithCompletionHandler:finish];
            }
        });
        return;
    }

    if (![@"pickFile" isEqualToString:body[@"action"]]) return;

    BOOL folder     = [body[@"folder"] boolValue];
    NSString *cbId  = body[@"callbackId"] ?: @"_";
    WKWebView *wv   = msg.webView;
    NSWindow  *win  = wv.window;

    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.allowsMultipleSelection = !folder;
    panel.canChooseDirectories    = folder;
    panel.canChooseFiles          = !folder;

    void (^deliver)(NSArray<NSURL *> *) = ^(NSArray<NSURL *> *urls) {
        if (!urls.count) { [self fire:cbId files:@[] webView:wv]; return; }
        NSMutableArray *infos = [NSMutableArray array];
        if (folder && urls.count == 1) {
            [self collectFolder:urls.firstObject into:infos];
        } else {
            for (NSURL *u in urls) {
                NSDictionary *d = [self infoForURL:u name:u.lastPathComponent];
                if (d) [infos addObject:d];
            }
        }
        [self fire:cbId files:infos webView:wv];
    };

    if (win) {
        [panel beginSheetModalForWindow:win completionHandler:^(NSModalResponse r) {
            deliver(r == NSModalResponseOK ? panel.URLs : nil);
        }];
    } else {
        [panel beginWithCompletionHandler:^(NSModalResponse r) {
            deliver(r == NSModalResponseOK ? panel.URLs : nil);
        }];
    }
}

- (void)collectFolder:(NSURL *)dir into:(NSMutableArray *)out {
    NSFileManager *fm = [NSFileManager defaultManager];
    NSDirectoryEnumerator *en = [fm enumeratorAtURL:dir
                             includingPropertiesForKeys:@[NSURLIsRegularFileKey]
                                                options:NSDirectoryEnumerationSkipsHiddenFiles
                                           errorHandler:nil];
    NSString *folderName = dir.lastPathComponent;
    for (NSURL *u in en) {
        NSNumber *isFile; [u getResourceValue:&isFile forKey:NSURLIsRegularFileKey error:nil];
        if (!isFile.boolValue) continue;
        NSString *rel = [u.path substringFromIndex:dir.path.length];
        if ([rel hasPrefix:@"/"]) rel = [rel substringFromIndex:1];
        NSString *name = [folderName stringByAppendingPathComponent:rel];
        NSDictionary *d = [self infoForURL:u name:name];
        if (d) [out addObject:d];
    }
}

- (NSDictionary *)infoForURL:(NSURL *)url name:(NSString *)name {
    NSString *ext  = [url.pathExtension lowercaseString];
    NSString *type = [self mimeForExt:ext];
    BOOL isPdf     = [ext isEqualToString:@"pdf"];
    long long cap  = isPdf ? kMaxPdfBytes : kMaxTextBytes;

    NSNumber *sz; [url getResourceValue:&sz forKey:NSURLFileSizeKey error:nil];
    if (sz.longLongValue > cap) return nil; // too large — silently skip

    NSData *data = [NSData dataWithContentsOfURL:url options:NSDataReadingMappedIfSafe error:nil];
    if (!data) return nil;

    return @{
        @"name":   name,
        @"size":   @(data.length),
        @"type":   type,
        @"base64": [data base64EncodedStringWithOptions:0],
    };
}

- (void)fire:(NSString *)cbId files:(NSArray *)files webView:(WKWebView *)wv {
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:files options:0 error:nil];
    NSString *json   = jsonData ? [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding] : @"[]";
    NSData *idData   = [NSJSONSerialization dataWithJSONObject:cbId options:0 error:nil];
    NSString *idJson = idData ? [[NSString alloc] initWithData:idData encoding:NSUTF8StringEncoding] : @"\"_\"";
    NSString *js     = [NSString stringWithFormat:@"window.__nlNativeFileCallback(%@,%@)", idJson, json];
    dispatch_async(dispatch_get_main_queue(), ^{ [wv evaluateJavaScript:js completionHandler:nil]; });
}

- (NSString *)mimeForExt:(NSString *)e {
    return @{
        @"pdf":@"application/pdf",
        @"txt":@"text/plain", @"md":@"text/markdown", @"markdown":@"text/markdown",
        @"json":@"application/json", @"js":@"text/javascript", @"jsx":@"text/javascript",
        @"ts":@"text/typescript", @"tsx":@"text/typescript",
        @"css":@"text/css", @"html":@"text/html", @"xml":@"text/xml",
        @"csv":@"text/csv", @"tsv":@"text/tab-separated-values",
        @"yml":@"text/yaml", @"yaml":@"text/yaml", @"log":@"text/plain",
    }[e] ?: @"application/octet-stream";
}

@end

// ---------------------------------------------------------------------------
// WKWebView subclass that accepts the very first click as a real click.
// Without this, the first mouse click after the window becomes key is
// consumed by window activation and never reaches the page — so a button
// can appear "unresponsive" until the user clicks a second time.
// ---------------------------------------------------------------------------
@interface NLWebView : WKWebView
@end

@implementation NLWebView
- (BOOL)acceptsFirstMouse:(NSEvent *)event {
    return YES;
}
@end

// ---------------------------------------------------------------------------
// App delegate
// ---------------------------------------------------------------------------
@interface NotlinearAppDelegate : NSObject <NSApplicationDelegate, WKUIDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSTask *serverTask;
@end

@implementation NotlinearAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [self createMenu];
    [self startServerIfNeeded];
    [self createWindow];

    // The dev server always serves fresh (Cache-Control: no-store), but this
    // WKWebView uses the persistent default data store so real app data
    // (IndexedDB/localStorage) survives relaunches. That same persistence
    // means WebKit's on-disk HTTP/module cache can keep a stale copy of a JS
    // file forever, immune to no-store, if it was ever cached before that
    // header existed. Purge only cache-type data (never IndexedDB/localStorage)
    // on every launch so edited files always show up.
    NSSet *cacheTypes = [NSSet setWithArray:@[
        WKWebsiteDataTypeDiskCache,
        WKWebsiteDataTypeMemoryCache,
        WKWebsiteDataTypeOfflineWebApplicationCache,
    ]];
    [[WKWebsiteDataStore defaultDataStore] removeDataOfTypes:cacheTypes
                                                modifiedSince:[NSDate distantPast]
                                            completionHandler:^{
        dispatch_async(dispatch_get_main_queue(), ^{
            [self loadNotlinear];
        });
    }];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return YES;
}

- (void)applicationWillTerminate:(NSNotification *)notification {
    if (self.serverTask && self.serverTask.isRunning) {
        [self.serverTask terminate];
    }
}

- (BOOL)isServerRunning {
    NSTask *task = [[NSTask alloc] init];
    task.launchPath = @"/usr/sbin/lsof";
    task.arguments = @[@"-nP", @"-iTCP:8765", @"-sTCP:LISTEN"];
    task.standardOutput = [NSPipe pipe];
    task.standardError = [NSFileHandle fileHandleWithNullDevice];
    @try {
        [task launch];
        [task waitUntilExit];
        return task.terminationStatus == 0;
    } @catch (NSException *exception) {
        return NO;
    }
}

- (void)killExistingServer {
    NSTask *task = [[NSTask alloc] init];
    task.launchPath = @"/usr/bin/pkill";
    task.arguments = @[@"-f", @"notlinear_server.py"];
    task.standardOutput = [NSFileHandle fileHandleWithNullDevice];
    task.standardError = [NSFileHandle fileHandleWithNullDevice];
    @try { [task launch]; [task waitUntilExit]; } @catch (NSException *e) {}
    [NSThread sleepForTimeInterval:0.3];
}

- (void)startServerIfNeeded {
    [self killExistingServer];

    NSTask *task = [[NSTask alloc] init];
    task.launchPath = @"/usr/bin/python3";
    task.arguments = @[@"notlinear_server.py", @"--port", @"8765", @"--host", @"127.0.0.1"];
    task.currentDirectoryPath = @"/Users/yash/Downloads/notlinear";
    task.standardOutput = [NSFileHandle fileHandleWithNullDevice];
    task.standardError = [NSFileHandle fileHandleWithNullDevice];

    @try {
        [task launch];
        self.serverTask = task;
        [NSThread sleepForTimeInterval:0.8];
    } @catch (NSException *exception) {
        NSAlert *alert = [[NSAlert alloc] init];
        alert.messageText = @"Notlinear";
        alert.informativeText = [NSString stringWithFormat:@"Could not start local server: %@", exception.reason];
        alert.alertStyle = NSAlertStyleCritical;
        [alert runModal];
    }
}

- (void)createMenu {
    NSMenu *mainMenu = [[NSMenu alloc] initWithTitle:@""];

    NSMenuItem *appMenuItem = [[NSMenuItem alloc] initWithTitle:@"" action:nil keyEquivalent:@""];
    [mainMenu addItem:appMenuItem];
    NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"Notlinear"];
    [appMenu addItemWithTitle:@"Quit Notlinear" action:@selector(terminate:) keyEquivalent:@"q"];
    appMenuItem.submenu = appMenu;

    NSMenuItem *editMenuItem = [[NSMenuItem alloc] initWithTitle:@"" action:nil keyEquivalent:@""];
    [mainMenu addItem:editMenuItem];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
    [editMenu addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
    [editMenu addItemWithTitle:@"Redo" action:@selector(redo:) keyEquivalent:@"Z"];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"Paste and Match Style" action:@selector(pasteAsPlainText:) keyEquivalent:@"V"];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
    editMenuItem.submenu = editMenu;

    NSMenuItem *viewMenuItem = [[NSMenuItem alloc] initWithTitle:@"" action:nil keyEquivalent:@""];
    [mainMenu addItem:viewMenuItem];
    NSMenu *viewMenu = [[NSMenu alloc] initWithTitle:@"View"];
    [viewMenu addItemWithTitle:@"Zoom In" action:@selector(zoomIn:) keyEquivalent:@"="];
    NSMenuItem *zoomInAlt = [viewMenu addItemWithTitle:@"Zoom In" action:@selector(zoomIn:) keyEquivalent:@"+"];
    zoomInAlt.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
    zoomInAlt.hidden = YES;
    [viewMenu addItemWithTitle:@"Zoom Out" action:@selector(zoomOut:) keyEquivalent:@"-"];
    [viewMenu addItemWithTitle:@"Actual Size" action:@selector(actualSizeZoom:) keyEquivalent:@"0"];
    viewMenuItem.submenu = viewMenu;

    NSApp.mainMenu = mainMenu;
}

- (void)zoomIn:(id)sender {
    if (@available(macOS 14.0, *)) {
        self.webView.pageZoom = MIN(self.webView.pageZoom + 0.1, 3.0);
    }
}

- (void)zoomOut:(id)sender {
    if (@available(macOS 14.0, *)) {
        self.webView.pageZoom = MAX(self.webView.pageZoom - 0.1, 0.25);
    }
}

- (void)actualSizeZoom:(id)sender {
    if (@available(macOS 14.0, *)) {
        self.webView.pageZoom = 1.0;
    }
}

- (void)createWindow {
    WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
    configuration.websiteDataStore = [WKWebsiteDataStore defaultDataStore];

    // Register native file-picker handler (JS → native → JS callback)
    NotlinearPickFileHandler *fileHandler = [[NotlinearPickFileHandler alloc] init];
    [configuration.userContentController addScriptMessageHandler:fileHandler name:@"notlinear"];

    self.webView = [[NLWebView alloc] initWithFrame:NSZeroRect configuration:configuration];
    self.webView.UIDelegate = self;
    if (@available(macOS 13.3, *)) {
        self.webView.inspectable = YES;
    }

    NSRect frame = NSMakeRect(0, 0, 1280, 860);
    self.window = [[NSWindow alloc] initWithContentRect:frame
                                              styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable)
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];
    self.window.title = @"Notlinear";
    self.window.minSize = NSMakeSize(900, 620);
    self.window.contentView = self.webView;
    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
}

// WKUIDelegate fallback — kept for completeness, but the JS-side triggerFilePicker
// uses the message handler above and never reaches this path in the native app.
- (void)webView:(WKWebView *)webView runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSArray<NSURL *> * _Nullable))completionHandler {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection;
    panel.canChooseDirectories    = parameters.allowsDirectories;
    panel.canChooseFiles          = !parameters.allowsDirectories;
    NSWindow *win = webView.window;
    if (win) {
        [panel beginSheetModalForWindow:win completionHandler:^(NSModalResponse r) {
            completionHandler(r == NSModalResponseOK ? panel.URLs : nil);
        }];
    } else {
        [panel beginWithCompletionHandler:^(NSModalResponse r) {
            completionHandler(r == NSModalResponseOK ? panel.URLs : nil);
        }];
    }
}

// Open target="_blank" / window.open links in the default browser.
// Without this, WKWebView silently drops the click and links appear dead.
- (WKWebView *)webView:(WKWebView *)webView
createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
   forNavigationAction:(WKNavigationAction *)navigationAction
        windowFeatures:(WKWindowFeatures *)windowFeatures {
    NSURL *url = navigationAction.request.URL;
    if (url) {
        [[NSWorkspace sharedWorkspace] openURL:url];
    }
    return nil;
}

- (void)loadNotlinear {
    NSURL *url = [NSURL URLWithString:@"http://127.0.0.1:8765/notlinear.html"];
    NSURLRequest *request = [NSURLRequest requestWithURL:url
                                             cachePolicy:NSURLRequestReloadIgnoringLocalCacheData
                                         timeoutInterval:30.0];
    [self.webView loadRequest:request];
}

@end

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        NotlinearAppDelegate *delegate = [[NotlinearAppDelegate alloc] init];
        app.delegate = delegate;
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        [app activateIgnoringOtherApps:YES];
        [app run];
    }
    return 0;
}
