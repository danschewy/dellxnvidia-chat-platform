#import <Cocoa/Cocoa.h>
#import <Carbon/Carbon.h>
#import <WebKit/WebKit.h>

static NSString *const EveDefaultHubURL = @"http://10.0.0.88:3100/";

@interface EveHubViewController : NSViewController <WKNavigationDelegate>
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, assign) BOOL hubLoaded;
@property(nonatomic, assign) NSUInteger reloadCount;
- (void)reloadHub;
@end

@implementation EveHubViewController

- (void)loadView {
    NSVisualEffectView *background = [[NSVisualEffectView alloc] initWithFrame:NSZeroRect];
    background.material = NSVisualEffectMaterialPopover;
    background.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    background.state = NSVisualEffectStateActive;

    WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
    configuration.websiteDataStore = WKWebsiteDataStore.defaultDataStore;
    self.webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:configuration];
    self.webView.navigationDelegate = self;
    self.webView.translatesAutoresizingMaskIntoConstraints = NO;
    [background addSubview:self.webView];
    [NSLayoutConstraint activateConstraints:@[
        [self.webView.leadingAnchor constraintEqualToAnchor:background.leadingAnchor],
        [self.webView.trailingAnchor constraintEqualToAnchor:background.trailingAnchor],
        [self.webView.topAnchor constraintEqualToAnchor:background.topAnchor],
        [self.webView.bottomAnchor constraintEqualToAnchor:background.bottomAnchor],
    ]];
    self.view = background;
}

- (void)viewDidAppear {
    [super viewDidAppear];
    if (!self.hubLoaded) {
        [self reloadHub];
    }
}

- (void)reloadHub {
    NSString *configured = [NSUserDefaults.standardUserDefaults stringForKey:@"EveHubURL"];
    if (configured.length == 0) {
        configured = NSProcessInfo.processInfo.environment[@"EVE_HUB_URL"];
    }
    if (configured.length == 0) {
        configured = EveDefaultHubURL;
    }
    NSURL *url = [NSURL URLWithString:configured];
    if (url == nil) return;
    self.hubLoaded = YES;
    self.reloadCount += 1;
    NSURLRequest *request = [NSURLRequest requestWithURL:url
                                            cachePolicy:NSURLRequestReloadRevalidatingCacheData
                                        timeoutInterval:30.0];
    [self.webView loadRequest:request];
}

@end

@interface EveAppDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) NSStatusItem *statusItem;
@property(nonatomic, strong) NSPopover *popover;
@property(nonatomic, strong) EveHubViewController *hubController;
@property(nonatomic, assign) EventHotKeyRef hotKeyRef;
@property(nonatomic, assign) BOOL hotKeyRegistered;
- (void)togglePopover:(id)sender;
@end

static OSStatus EveHotKeyHandler(
    EventHandlerCallRef nextHandler,
    EventRef event,
    void *userData
) {
    EveAppDelegate *delegate = (__bridge EveAppDelegate *)userData;
    dispatch_async(dispatch_get_main_queue(), ^{
        [delegate togglePopover:nil];
    });
    return noErr;
}

@implementation EveAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];

    self.statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
    NSStatusBarButton *button = self.statusItem.button;
    button.image = [NSImage imageWithSystemSymbolName:@"sparkles"
                             accessibilityDescription:@"Eve"];
    button.toolTip = @"Eve — Option+Space";
    button.target = self;
    button.action = @selector(togglePopover:);

    self.hubController = [EveHubViewController new];
    self.popover = [NSPopover new];
    self.popover.behavior = NSPopoverBehaviorTransient;
    self.popover.animates = YES;
    self.popover.contentSize = NSMakeSize(520.0, 720.0);
    self.popover.contentViewController = self.hubController;

    EventTypeSpec eventType = { kEventClassKeyboard, kEventHotKeyPressed };
    InstallEventHandler(
        GetApplicationEventTarget(),
        EveHotKeyHandler,
        1,
        &eventType,
        (__bridge void *)self,
        NULL
    );
    EventHotKeyID hotKeyID = { 'EVE ', 1 };
    OSStatus hotKeyStatus = RegisterEventHotKey(
        kVK_Space,
        optionKey,
        hotKeyID,
        GetApplicationEventTarget(),
        0,
        &_hotKeyRef
    );
    self.hotKeyRegistered = hotKeyStatus == noErr;

    if ([NSProcessInfo.processInfo.environment[@"EVE_SELF_TEST"] isEqualToString:@"1"]) {
        self.popover.animates = NO;
        dispatch_after(
            dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)),
            dispatch_get_main_queue(),
            ^{
                [self togglePopover:nil];
                BOOL opened = self.popover.shown;
                NSUInteger reloadCount = self.hubController.reloadCount;
                [self togglePopover:nil];
                dispatch_after(
                    dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.4 * NSEC_PER_SEC)),
                    dispatch_get_main_queue(),
                    ^{
                        BOOL collapsed = !self.popover.shown
                            && self.statusItem.button != nil;
                        [self togglePopover:nil];
                        BOOL reopened = self.popover.shown;
                        BOOL statePreserved = self.hubController.reloadCount == reloadCount;
                        BOOL passed = self.statusItem.button != nil
                            && self.hotKeyRegistered
                            && opened
                            && collapsed
                            && reopened
                            && statePreserved;
                        fprintf(
                            stdout,
                            "EVE_SELF_TEST_%s statusItem=true hotKey=%s opened=%s collapsed=%s reopened=%s statePreserved=%s\n",
                            passed ? "OK" : "FAILED",
                            self.hotKeyRegistered ? "true" : "false",
                            opened ? "true" : "false",
                            collapsed ? "true" : "false",
                            reopened ? "true" : "false",
                            statePreserved ? "true" : "false"
                        );
                        fflush(stdout);
                        [NSApp terminate:nil];
                    }
                );
            }
        );
    }
}

- (void)applicationWillTerminate:(NSNotification *)notification {
    if (self.hotKeyRef != NULL) {
        UnregisterEventHotKey(self.hotKeyRef);
    }
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return NO;
}

- (void)togglePopover:(id)sender {
    if (self.popover.shown) {
        [self.popover performClose:sender];
        return;
    }
    NSStatusBarButton *button = self.statusItem.button;
    if (button == nil) return;
    [self.popover showRelativeToRect:button.bounds ofView:button preferredEdge:NSRectEdgeMinY];
    [self.popover.contentViewController.view.window makeKeyWindow];
    [NSApp activateIgnoringOtherApps:YES];
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = NSApplication.sharedApplication;
        EveAppDelegate *delegate = [EveAppDelegate new];
        application.delegate = delegate;
        [application run];
    }
    return 0;
}
