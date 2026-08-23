// lib/features/interviews/candidate/system_check_page.dart
//
// Pre-join system check for VIDEO interviews. Requests camera + microphone
// BEFORE the Tavus WebRTC call opens, so a denial is handled here with a clear
// retry / open-settings path instead of a dead video panel mid-interview.
// Proceeds (via [onReady]) only when both permissions are granted.

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import 'package:talbotiq/shared/widgets/custom_buttons.dart';
import 'package:talbotiq/core/constants/colors.dart';

class SystemCheckPage extends StatefulWidget {
  /// Called once camera + microphone are both granted and the candidate taps
  /// "Join interview".
  final VoidCallback onReady;
  final String title;

  const SystemCheckPage({
    super.key,
    required this.onReady,
    this.title = 'System check',
  });

  @override
  State<SystemCheckPage> createState() => _SystemCheckPageState();
}

class _SystemCheckPageState extends State<SystemCheckPage>
    with WidgetsBindingObserver {
  PermissionStatus? _cam;
  PermissionStatus? _mic;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _requestAll();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Re-read statuses when the candidate returns from the OS Settings app.
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    final cam = await Permission.camera.status;
    final mic = await Permission.microphone.status;
    if (!mounted) return;
    setState(() {
      _cam = cam;
      _mic = mic;
    });
  }

  Future<void> _requestAll() async {
    setState(() => _busy = true);
    final statuses =
        await [Permission.camera, Permission.microphone].request();
    if (!mounted) return;
    setState(() {
      _cam = statuses[Permission.camera];
      _mic = statuses[Permission.microphone];
      _busy = false;
    });
  }

  bool get _bothGranted =>
      (_cam?.isGranted ?? false) && (_mic?.isGranted ?? false);

  bool get _anyPermanentlyDenied =>
      (_cam?.isPermanentlyDenied ?? false) ||
      (_mic?.isPermanentlyDenied ?? false) ||
      (_cam?.isRestricted ?? false) ||
      (_mic?.isRestricted ?? false);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      appBar: AppBar(title: Text(widget.title)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'This is a video interview. We need access to your camera and '
                'microphone before you join.',
                style: theme.textTheme.bodyMedium
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: 20),
              _statusTile(theme, Icons.videocam_outlined, 'Camera', _cam),
              const SizedBox(height: 12),
              _statusTile(theme, Icons.mic_none_outlined, 'Microphone', _mic),
              const SizedBox(height: 24),
              if (!_bothGranted && _anyPermanentlyDenied)
                CustomButton(
                  text: 'Open Settings',
                  variant: ButtonVariant.outline,
                  onPressed: openAppSettings,
                )
              else if (!_bothGranted)
                CustomButton(
                  text: 'Allow access',
                  variant: ButtonVariant.outline,
                  isLoading: _busy,
                  onPressed: _busy ? () {} : _requestAll,
                ),
              if (!_bothGranted && _anyPermanentlyDenied) ...[
                const SizedBox(height: 8),
                Text(
                  'Access was blocked. Enable Camera and Microphone for this app '
                  'in Settings, then return here.',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.error),
                ),
              ],
              const SizedBox(height: 12),
              // Dimmed + explains itself when it can't proceed. CustomButton's
              // onPressed is non-nullable, so the old `: () {}` fallback gave a
              // button that looked fully enabled but silently did nothing —
              // candidates tapped "Join interview", got no response, backed
              // out, and landed back on their interview list as if the app had
              // crashed.
              Opacity(
                opacity: _bothGranted ? 1.0 : 0.45,
                child: CustomButton(
                  text: 'Join interview',
                  onPressed: _bothGranted
                      ? widget.onReady
                      : () {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text(
                                'Camera and microphone access are both required '
                                'before you can join. Tap "Allow access" above.',
                              ),
                              duration: Duration(seconds: 5),
                            ),
                          );
                        },
                ),
              ),
              if (!_bothGranted) ...[
                const SizedBox(height: 8),
                Text(
                  'Grant both permissions to continue.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _statusTile(
      ThemeData theme, IconData icon, String label, PermissionStatus? status) {
    final granted = status?.isGranted ?? false;
    final cs = theme.colorScheme;
    final color = granted ? AppColors.pastelMintText : cs.onSurfaceVariant;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest.withOpacity(0.3),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: cs.outlineVariant.withOpacity(0.4)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Text(label,
                style: theme.textTheme.bodyLarge
                    ?.copyWith(fontWeight: FontWeight.w600)),
          ),
          Icon(
            granted ? Icons.check_circle : Icons.radio_button_unchecked,
            color: granted ? AppColors.pastelMintText : cs.onSurfaceVariant.withOpacity(0.5),
            size: 22,
          ),
        ],
      ),
    );
  }
}
