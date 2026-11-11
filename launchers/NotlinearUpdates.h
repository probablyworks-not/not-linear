#import <Cocoa/Cocoa.h>

// Validates the public feed before exposing any link to the user.
NSDictionary *NLValidateRelease(NSDictionary *feed, NSString *architecture, NSError **error);

@interface NLUpdateChecker : NSObject
- (instancetype)initWithWindow:(NSWindow *)window;
- (void)checkForUpdates:(BOOL)userInitiated;
@end
