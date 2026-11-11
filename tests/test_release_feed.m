#import <Cocoa/Cocoa.h>
#import "NotlinearUpdates.h"

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSDictionary *asset = @{@"url": @"https://github.com/probablyworks-not/not-linear/releases/download/v0.2.0/Notlinear-0.2.0-arm64.dmg",
                                 @"sha256": [@"a" stringByPaddingToLength:64 withString:@"a" startingAtIndex:0]};
        NSDictionary *good = @{@"app": @"notlinear", @"version": @"0.2.0", @"build": @3, @"downloads": @{@"arm64": asset}};
        NSCAssert(NLValidateRelease(good, @"arm64", nil) != nil, @"valid feed rejected");
        NSCAssert(NLValidateRelease(good, @"x86_64", nil) == nil, @"unsupported architecture accepted");
        NSArray *invalidFields = @[
            @{@"app": @"another-app"}, @{@"version": @"<script>"}, @{@"version": @[]},
            @{@"build": @YES}, @{@"build": @(-1)}, @{@"build": @1.5}, @{@"build": @"4"},
            @{@"downloads": @[]}
        ];
        for (NSDictionary *field in invalidFields) {
            NSMutableDictionary *feed = [good mutableCopy]; [feed addEntriesFromDictionary:field];
            NSCAssert(NLValidateRelease(feed, @"arm64", nil) == nil, @"invalid metadata accepted");
        }
        for (NSString *link in @[@"http://github.com/probablyworks-not/not-linear/releases/download/v1/app.dmg",
            @"https://evil.example/app.dmg", @"https://github.com/another/repo/releases/download/v1/app.dmg",
            @"https://github.com/probablyworks-not/not-linear/releases/download/v1/app.dmg?token=bad",
            @"https://user@github.com/probablyworks-not/not-linear/releases/download/v1/app.dmg",
            @"https://github.com/probablyworks-not/not-linear/releases/download/v1/app.zip"]) {
            NSMutableDictionary *feed = [good mutableCopy];
            feed[@"downloads"] = @{@"arm64": @{@"url": link, @"sha256": asset[@"sha256"]}};
            NSCAssert(NLValidateRelease(feed, @"arm64", nil) == nil, @"unsafe download link accepted");
        }
        NSCAssert(NLValidateRelease((id)@[], @"arm64", nil) == nil, @"non-object feed accepted");
        NSCAssert(NLValidateRelease(nil, @"arm64", nil) == nil, @"missing feed accepted");
        if (argc > 1) {
            NSData *data = [NSData dataWithContentsOfFile:[NSString stringWithUTF8String:argv[1]]];
            NSDictionary *feed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
            NSCAssert(NLValidateRelease(feed, @"arm64", nil) != nil, @"prepared release manifest rejected");
        }
        puts("Release feed validation passed (valid metadata, malformed fields, architecture and unsafe links).");
    }
    return 0;
}
