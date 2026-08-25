// lib/core/net/backend_config.dart
//
// Where the TalbotIQ backend lives. One URL for everything the app asks the
// server for: the AI proxy, Gemini Live token minting, and the mailer.
//
// This is a BUILD-TIME constant, never a Settings field. The whole point of the
// migration is that credentials and endpoints are not user-editable: a URL a
// user can retype is a URL an attacker can point at their own server, and that
// server would receive the Firebase ID token the client attaches to every
// request.
//
//   flutter run   --dart-define=BACKEND_BASE_URL=https://api.talbotiq.com
//   flutter build --dart-define=BACKEND_BASE_URL=https://api.talbotiq.com
//
// Or keep them in a file and pass it once:
//
//   flutter run --dart-define-from-file=config/dev.json

import 'package:flutter/foundation.dart';

class BackendConfig {
  BackendConfig._();

  /// Supplied at build time. Empty in a plain `flutter run`, which falls back to
  /// the local dev default below.
  static const String _fromEnvironment =
      String.fromEnvironment('BACKEND_BASE_URL');

  /// Port `uvicorn app.main:app` listens on by default.
  static const int _devPort = 8000;

  /// Deployed production backend. Used as the release-build default so a
  /// distributed build (e.g. `flutter build windows --release`) works out of
  /// the box without requiring testers to pass `--dart-define`. An explicit
  /// `--dart-define=BACKEND_BASE_URL=...` still overrides this, so release
  /// builds against a different backend (staging, etc.) remain possible.
  static const String _releaseDefault =
      'https://inteview-backend-14029160874.asia-south1.run.app';

  /// The backend root, without a trailing slash.
  static String get baseUrl {
    final explicit = _fromEnvironment.trim();
    if (explicit.isNotEmpty) return _stripTrailingSlash(explicit);
    return kReleaseMode ? _releaseDefault : _devDefault;
  }

  static bool get isConfigured => baseUrl.isNotEmpty;

  /// True when running against a developer's own machine rather than a deploy.
  static bool get isLocal =>
      baseUrl.contains('localhost') ||
      baseUrl.contains('127.0.0.1') ||
      baseUrl.contains('10.0.2.2');

  /// Local default for debug builds, per platform.
  ///
  /// The Android emulator cannot reach the host's `localhost` — that resolves to
  /// the emulated device itself. `10.0.2.2` is the emulator's alias for the host
  /// loopback. A physical device can reach neither, so it needs an explicit
  /// `--dart-define` with the host's LAN address.
  static String get _devDefault {
    if (kIsWeb) return 'http://localhost:$_devPort';
    return defaultTargetPlatform == TargetPlatform.android
        ? 'http://10.0.2.2:$_devPort'
        : 'http://localhost:$_devPort';
  }

  /// Human-readable reason the backend is unreachable, or null when it looks
  /// usable. Surfaced in diagnostics rather than guessed at by each caller.
  static String? get configHint {
    if (isConfigured) return null;
    return 'BACKEND_BASE_URL was not set at build time. Rebuild with '
        '--dart-define=BACKEND_BASE_URL=https://your-backend';
  }

  static String _stripTrailingSlash(String url) =>
      url.endsWith('/') ? url.substring(0, url.length - 1) : url;
}
