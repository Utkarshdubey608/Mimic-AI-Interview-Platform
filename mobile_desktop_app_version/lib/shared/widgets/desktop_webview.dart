// lib/shared/widgets/desktop_webview.dart
//
// Desktop (Windows/macOS/Linux) counterpart of iframe_view_stub.dart's mobile
// WebView. webview_flutter has no desktop backend at all, so the Tavus/Daily
// video-interview call — embedded as a plain web page either way — needs a
// WebView engine that actually exists on desktop: flutter_inappwebview, which
// uses WebView2 on Windows and WKWebView on macOS.
//
// Mirrors _MobileWebView's exact security posture:
//   - camera/mic requested from the OS first, like a native app would
//   - only camera + microphone are ever granted to the embedded page —
//     everything else the page might ask for (MIDI, clipboard, downloads,
//     geolocation, notifications, ...) is denied
//   - top-level navigation is restricted to the initial host plus the known
//     Tavus/Daily.co video infrastructure a live call relies on

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:permission_handler/permission_handler.dart';

import 'package:talbotiq/shared/widgets/iframe_host_allowlist.dart';
import 'package:talbotiq/core/constants/colors.dart';

class DesktopWebView extends StatefulWidget {
  final String url;
  const DesktopWebView({super.key, required this.url});

  @override
  State<DesktopWebView> createState() => _DesktopWebViewState();
}

class _DesktopWebViewState extends State<DesktopWebView> {
  String? _error;
  bool _permissionsGranted = false;
  String? _initialHost;

  // Not `const`/`static`: PermissionResourceType's constants are `static
  // final` (resolved per-platform at runtime via defaultTargetPlatform), not
  // compile-time constants.
  static final _grantableResources = <PermissionResourceType>{
    PermissionResourceType.CAMERA,
    PermissionResourceType.MICROPHONE,
    PermissionResourceType.CAMERA_AND_MICROPHONE,
  };

  @override
  void initState() {
    super.initState();
    _initialHost = Uri.tryParse(widget.url)?.host.toLowerCase();
    _requestPermissions();
  }

  Future<void> _requestPermissions() async {
    final statuses = await [Permission.camera, Permission.microphone].request();
    final camOk = statuses[Permission.camera]?.isGranted ?? false;
    final micOk = statuses[Permission.microphone]?.isGranted ?? false;
    if (!mounted) return;
    if (!camOk || !micOk) {
      setState(() {
        _error = 'Camera and microphone access are required for the interview. '
            'Please grant the permissions in your system settings and try again.';
      });
      return;
    }
    setState(() => _permissionsGranted = true);
  }

  Future<NavigationActionPolicy> _decideNavigation(
      InAppWebViewController controller, NavigationAction action) async {
    final uri = action.request.url;
    if (uri == null) return NavigationActionPolicy.CANCEL;
    if (uri.scheme == 'about' || uri.scheme == 'blob' || uri.scheme == 'data') {
      return NavigationActionPolicy.ALLOW;
    }
    if ((uri.scheme == 'http' || uri.scheme == 'https') &&
        isAllowedIframeHost(_initialHost, uri.host)) {
      return NavigationActionPolicy.ALLOW;
    }
    debugPrint('Blocked desktop WebView navigation to $uri');
    return NavigationActionPolicy.CANCEL;
  }

  Future<PermissionResponse> _decidePermission(
      InAppWebViewController controller, PermissionRequest request) async {
    final onlyCameraAndMic = request.resources.isNotEmpty &&
        request.resources.every(_grantableResources.contains);
    return PermissionResponse(
      resources: onlyCameraAndMic ? request.resources : const [],
      action: onlyCameraAndMic ? PermissionResponseAction.GRANT : PermissionResponseAction.DENY,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.videocam_off, color: AppColors.danger, size: 40),
              const SizedBox(height: 12),
              Text(
                _error!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 16),
              ElevatedButton.icon(
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'),
                onPressed: () {
                  setState(() => _error = null);
                  _requestPermissions();
                },
              ),
              TextButton(
                onPressed: openAppSettings,
                child: const Text('Open system settings'),
              ),
            ],
          ),
        ),
      );
    }

    if (!_permissionsGranted) {
      return const Center(child: CircularProgressIndicator());
    }

    return InAppWebView(
      initialUrlRequest: URLRequest(url: WebUri(widget.url)),
      initialSettings: InAppWebViewSettings(
        mediaPlaybackRequiresUserGesture: false,
        transparentBackground: false,
      ),
      shouldOverrideUrlLoading: _decideNavigation,
      onPermissionRequest: _decidePermission,
      onReceivedError: (controller, request, error) {
        debugPrint('Web resource error in desktop Tavus WebView: ${error.description}');
      },
    );
  }
}
