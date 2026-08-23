// lib/main.dart
import 'dart:async';
import 'dart:ui';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:window_manager/window_manager.dart';
import 'package:talbotiq/core/utils/desktop_platform.dart';
import 'package:talbotiq/firebase_options.dart';
import 'package:talbotiq/core/services/avatar_catalog.dart';
import 'package:talbotiq/shared/providers/app_store.dart';
import 'package:talbotiq/features/recruiter/store/recruiter_store.dart';
import 'package:talbotiq/features/auth/auth_service.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';
import 'package:talbotiq/core/deep_link/deep_link_service.dart';
import 'package:talbotiq/core/theme/accent_palette.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';
import 'package:talbotiq/core/theme/app_theme.dart';
import 'package:talbotiq/features/app/splash_page.dart';

/// App-wide navigator key so the deep-link handler can drive navigation from
/// outside the widget tree (it lives for the whole app lifetime).
final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

/// Desktop (Windows/macOS/Linux) only: a phone-shaped default window helps
/// no one. Set a sensible desktop starting size and enforce a minimum below
/// which the sidebar-nav/analytics-dashboard layouts stop making sense.
Future<void> _initDesktopWindow() async {
  await windowManager.ensureInitialized();
  const windowOptions = WindowOptions(
    size: Size(1440, 900),
    minimumSize: Size(1024, 700),
    center: true,
    title: 'Talbotiq',
  );
  await windowManager.waitUntilReadyToShow(windowOptions, () async {
    await windowManager.show();
    await windowManager.focus();
  });
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  if (isDesktopPlatform) {
    await _initDesktopWindow();
  }

  // Safety net: log framework-caught errors (build/layout/paint) instead of
  // relying only on the default console dump, and — more importantly — catch
  // errors from OUTSIDE the Flutter framework's own error zone (e.g. an
  // unawaited Future that nobody attached a catch/catchError to, such as a
  // Firestore write racing a flaky connection). Without an onError handler
  // here, that class of error is truly uncaught and can present to a user as
  // an app crash even though the isolate itself is fine. Returning `true`
  // from PlatformDispatcher.onError tells the engine "handled, don't
  // terminate the app." This does NOT excuse leaving a Future unguarded —
  // fire-and-forget calls should still catch their own errors (see
  // candidate_video_shell.dart/candidate_home.dart) — it's a last-resort net
  // for whatever this doesn't catch.
  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    debugPrint('FlutterError: ${details.exceptionAsString()}');
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    debugPrint('Uncaught async error: $error\n$stack');
    return true;
  };

  // Firebase powers auth + the recruiter→candidate interview assignments.
  // Requires `flutterfire configure` to generate firebase_options.dart; the
  // placeholder throws until then (see lib/firebase_options.dart).
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );

  final store = AppStore();
  await store.loadFromPrefs();

  // Recruiter module state — separate store, own SharedPreferences key, so it
  // stays fully isolated from the protected video-interview AppStore.
  final recruiterStore = RecruiterStore();
  await recruiterStore.load();

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: store),
        ChangeNotifierProvider.value(value: recruiterStore),
        Provider<AuthService>(create: (_) => AuthService()),
        Provider<InterviewRepository>(create: (_) => InterviewRepository()),
        // Shared so a refresh on one screen is visible on all of them.
        ChangeNotifierProvider(create: (_) => AvatarCatalog()),
      ],
      child: const MyApp(),
    ),
  );
}

class MyApp extends StatefulWidget {
  const MyApp({super.key});

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  final DeepLinkService _deepLinks = DeepLinkService();
  StreamSubscription<DeepLinkTarget>? _linkSub;

  @override
  void initState() {
    super.initState();
    _initDeepLinks();
  }

  /// Wire both entry points:
  ///   - the cold-start link the app was launched with (getInitialTarget), and
  ///   - links that arrive while the app is already running (targetStream).
  /// Never throws: the service swallows platform errors and only emits valid,
  /// parsed targets, so a bad link can't break startup.
  Future<void> _initDeepLinks() async {
    _linkSub = _deepLinks.targetStream.listen(
      _handleTarget,
      onError: (Object e) => debugPrint('DeepLink stream error: $e'),
    );

    final initial = await _deepLinks.getInitialTarget();
    if (initial != null) _handleTarget(initial);
  }

  /// Parks the interview id for the candidate flow to consume after auth, then
  /// ensures the app is foregrounded on the home tree. We deliberately do NOT
  /// force-route to a candidate screen here: SplashPage → AuthGate already
  /// decides login vs. candidate/recruiter home based on auth + role. If the
  /// user is signed out, AuthGate shows login and the parked id persists until
  /// after sign-in (see PendingDeepLink consumption hook in candidate_home).
  void _handleTarget(DeepLinkTarget target) {
    PendingDeepLink.instance.set(target.interviewId);

    // Never yank the candidate out of a LIVE interview. This stream can fire
    // more than once for the same launch intent — e.g. Android/iOS can
    // re-deliver it when a native permission-style UI surfaces mid-call (this
    // is exactly what was popping candidates straight back to the home
    // screen the instant they tapped "Join" on Tavus's prejoin screen: the
    // video interview runs as a PUSHED route on this same root navigator, so
    // an unconditional popUntil(isFirst) tore it down with no dialog, no
    // error, no trace). The id is already parked above, so if this really is
    // a fresh link for a different interview, it's picked up normally once
    // the candidate finishes and returns to their home list — nothing is
    // lost by deferring it.
    final store = navigatorKey.currentContext?.read<AppStore>();
    final busy = store != null &&
        (store.interviewActive ||
            store.currentRoute == '/interview' ||
            store.currentRoute == '/results');
    if (busy) return;

    // Pop back to the root of the app so the AuthGate-driven home is visible.
    // Guarded: the navigator may not be mounted yet on a cold start (the
    // initial link is handled after the first frame in practice, but be safe).
    final nav = navigatorKey.currentState;
    if (nav != null && nav.canPop()) {
      nav.popUntil((route) => route.isFirst);
    }
  }

  @override
  void dispose() {
    _linkSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Only the theme mode drives MaterialApp; select on it so the whole app
    // tree doesn't rebuild on unrelated AppStore notifications (keys, session
    // config, integrity counters, etc.).
    final themeMode = context.select<AppStore, ThemeMode>((s) => s.themeMode);
    // The block language now covers the whole app, so it is installed here
    // rather than per screen — a route pushed from anywhere builds under this
    // MaterialApp and inherits it. (RecruiterScaffold still installs it too;
    // that is now a harmless re-install of identical values, and it keeps
    // those screens correct if the app theme is ever split by role again.)
    final accent = context.select<AppStore, AppAccent>((s) => s.accent);
    final secondaryAccent =
        context.select<AppStore, AppAccent>((s) => s.secondaryAccent);
    // Desktop-only text scale (Settings → Preferences → Font Size). Applied
    // once here via MediaQuery.textScaler rather than in every individual
    // widget, so it's a single source of truth that automatically reaches
    // every screen, dialog and dynamically created page — including ones
    // built long after this widget. Gated to desktop only: this preference
    // doesn't exist on mobile/web, so their text scale must stay whatever
    // the OS/browser already provides (e.g. an iOS accessibility setting),
    // never overridden by a desktop-only recruiter preference.
    final desktopFontScale =
        context.select<AppStore, double>((s) => s.desktopFontScale);
    return MaterialApp(
      title: 'TalbotIQ AI Screenings',
      debugShowCheckedModeBanner: false,
      navigatorKey: navigatorKey,
      theme: WarmSurfaces.theme(
        AppTheme.lightTheme,
        accent: accent,
        secondary: secondaryAccent,
      ),
      darkTheme: WarmSurfaces.theme(
        AppTheme.darkTheme,
        accent: accent,
        secondary: secondaryAccent,
      ),
      themeMode: themeMode,
      builder: (context, child) {
        if (!isDesktopPlatform || child == null) return child ?? const SizedBox.shrink();
        return MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: TextScaler.linear(desktopFontScale)),
          child: child,
        );
      },
      home: const SplashPage(),
    );
  }
}
