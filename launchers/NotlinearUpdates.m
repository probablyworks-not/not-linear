#import "NotlinearUpdates.h"

static NSString *const NLReleaseFeed = @"https://github.com/probablyworks-not/not-linear/releases/latest/download/latest.json";

NSDictionary *NLValidateRelease(NSDictionary *feed, NSString *architecture, NSError **error) {
    BOOL valid = [feed isKindOfClass:NSDictionary.class];
    NSString *version = valid ? feed[@"version"] : nil;
    NSNumber *build = valid ? feed[@"build"] : nil;
    NSRegularExpression *versionPattern = [NSRegularExpression regularExpressionWithPattern:@"^[0-9]+\\.[0-9]+\\.[0-9]+$" options:0 error:nil];
    valid = valid && [feed[@"app"] isEqual:@"notlinear"] &&
        [version isKindOfClass:NSString.class] &&
        [versionPattern numberOfMatchesInString:version options:0 range:NSMakeRange(0, version.length)] == 1 &&
        [build isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)build) != CFBooleanGetTypeID() &&
        build.doubleValue == build.integerValue && build.integerValue > 0;
    NSDictionary *downloads = valid && [feed[@"downloads"] isKindOfClass:NSDictionary.class] ? feed[@"downloads"] : nil;
    NSDictionary *asset = [downloads[architecture] isKindOfClass:NSDictionary.class] ? downloads[architecture] : nil;
    NSString *link = [asset[@"url"] isKindOfClass:NSString.class] ? asset[@"url"] : nil;
    NSString *sha = [asset[@"sha256"] isKindOfClass:NSString.class] ? asset[@"sha256"] : nil;
    NSURL *url = link ? [NSURL URLWithString:link] : nil;
    NSRegularExpression *hashPattern = [NSRegularExpression regularExpressionWithPattern:@"^[a-f0-9]{64}$" options:0 error:nil];
    valid = valid && [url.scheme isEqual:@"https"] && [url.host isEqual:@"github.com"] &&
        !url.user && !url.password && !url.port && !url.query && !url.fragment &&
        [url.path hasPrefix:@"/probablyworks-not/not-linear/releases/download/"] &&
        [url.path hasSuffix:@".dmg"] && sha &&
        [hashPattern numberOfMatchesInString:sha options:0 range:NSMakeRange(0, sha.length)] == 1;
    if (!valid) {
        if (error) *error = [NSError errorWithDomain:@"NotlinearUpdates" code:1 userInfo:@{
            NSLocalizedDescriptionKey: @"The release information is invalid or has no download for this Mac."
        }];
        return nil;
    }
    return @{@"version": version, @"build": build, @"url": url, @"sha256": sha};
}

@interface NLUpdateChecker ()
@property(nonatomic, weak) NSWindow *window;
@property(nonatomic) BOOL checking;
@property(nonatomic) NSInteger lastNotifiedBuild;
@property(nonatomic, strong) NSTimer *timer;
@end

@implementation NLUpdateChecker
- (instancetype)initWithWindow:(NSWindow *)window {
    if ((self = [super init])) {
        _window = window;
        _timer = [NSTimer scheduledTimerWithTimeInterval:6 * 60 * 60 target:self
            selector:@selector(timerTick:) userInfo:nil repeats:YES];
    }
    return self;
}

- (void)timerTick:(NSTimer *)timer { [self checkForUpdates:NO]; }

- (void)showMessage:(NSString *)title detail:(NSString *)detail {
    if (self.window.attachedSheet) return;
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = title;
    alert.informativeText = detail;
    [alert addButtonWithTitle:@"OK"];
    if (self.window) [alert beginSheetModalForWindow:self.window completionHandler:nil];
}

- (void)checkForUpdates:(BOOL)userInitiated {
    if (self.checking) return;
    self.checking = YES;
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:NLReleaseFeed]];
    request.timeoutInterval = 15;
    request.cachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
    [request setValue:@"Notlinear-Update-Check" forHTTPHeaderField:@"User-Agent"];
    [request setValue:@"application/json" forHTTPHeaderField:@"Accept"];
    // No local keys, chat data, machine identifiers or credentials are sent.
    [[[NSURLSession sharedSession] dataTaskWithRequest:request completionHandler:
        ^(NSData *data, NSURLResponse *response, NSError *networkError) {
        NSInteger status = [(NSHTTPURLResponse *)response statusCode];
        NSDictionary *feed = data.length <= 65536 ? [NSJSONSerialization JSONObjectWithData:data ?: [NSData data] options:0 error:nil] : nil;
        #if defined(__arm64__)
        NSString *architecture = @"arm64";
        #else
        NSString *architecture = @"x86_64";
        #endif
        NSError *validationError = nil;
        NSDictionary *release = status == 200 ? NLValidateRelease(feed, architecture, &validationError) : nil;
        dispatch_async(dispatch_get_main_queue(), ^{
            self.checking = NO;
            if (!release || networkError) {
                if (userInitiated) [self showMessage:@"Could not check for updates"
                    detail:status == 404 ? @"No public release is available yet. Please try again later." :
                    (validationError.localizedDescription ?: @"Check your internet connection and try again.")];
                return;
            }
            NSInteger installed = [[[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleVersion"] integerValue];
            NSInteger available = [release[@"build"] integerValue];
            if (available <= installed) {
                if (userInitiated) [self showMessage:@"You're up to date" detail:@"You have the latest published build of Notlinear."];
                return;
            }
            if (!userInitiated && available == self.lastNotifiedBuild) return;
            if (self.window.attachedSheet) return;
            self.lastNotifiedBuild = available;
            NSAlert *alert = [[NSAlert alloc] init];
            alert.messageText = [NSString stringWithFormat:@"Notlinear %@ is available", release[@"version"]];
            alert.informativeText = @"Download the new DMG, quit Notlinear when you're ready, and replace the app in Applications. Your local data stays separate from the app. This download is not notarized by Apple and may require approval in Privacy & Security.";
            [alert addButtonWithTitle:@"Download Update"];
            [alert addButtonWithTitle:@"Later"];
            if (self.window) [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result) {
                if (result == NSAlertFirstButtonReturn) [[NSWorkspace sharedWorkspace] openURL:release[@"url"]];
            }];
        });
    }] resume];
}
@end
