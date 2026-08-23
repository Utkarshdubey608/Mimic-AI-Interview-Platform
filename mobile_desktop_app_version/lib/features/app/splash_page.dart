// lib/views/splash_page.dart
import 'package:flutter/material.dart';
import 'package:talbotiq/features/auth/auth_gate.dart';
import 'package:talbotiq/shared/widgets/mimic_mark.dart';
import 'package:talbotiq/shared/widgets/mimic_wordmark.dart';

/// A clean, modern splash screen.
///
/// The Mimic mark and wordmark fade and ease up into place, with a subtle
/// accent underline that draws itself in. The mark is drawn (see [MimicMark]),
/// not a logo image, so it matches the OS app icon and the in-app branding
/// rather than being a third treatment of it. Colors are pulled
/// from the active [Theme], so the background is dark when the user has chosen
/// dark mode and light when they've chosen light mode — driven entirely by the
/// in-app theme preference rather than the OS.
class SplashPage extends StatefulWidget {
  const SplashPage({super.key});

  @override
  State<SplashPage> createState() => _SplashPageState();
}

class _SplashPageState extends State<SplashPage>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _fade;
  late final Animation<Offset> _slide;
  late final Animation<double> _underline;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    );

    // Wordmark: gentle fade + slight upward ease-out.
    _fade = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.0, 0.55, curve: Curves.easeOut),
    );
    _slide = Tween<Offset>(
      begin: const Offset(0, 0.18),
      end: Offset.zero,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.0, 0.6, curve: Curves.easeOutCubic),
    ));

    // Accent underline draws in after the wordmark settles.
    _underline = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.5, 1.0, curve: Curves.easeInOutCubic),
    );

    _controller.forward();

    // Hold briefly on the finished frame, then cross-fade into the app.
    Future.delayed(const Duration(milliseconds: 2200), _goToApp);
  }

  void _goToApp() {
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      PageRouteBuilder(
        transitionDuration: const Duration(milliseconds: 500),
        pageBuilder: (_, __, ___) => const AuthGate(),
        transitionsBuilder: (_, animation, __, child) =>
            FadeTransition(opacity: animation, child: child),
      ),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final onBg = theme.colorScheme.onSurface;
    final accent = theme.colorScheme.primary;

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      body: Center(
        child: FadeTransition(
          opacity: _fade,
          child: SlideTransition(
            position: _slide,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const MimicMark(size: 64),
                const SizedBox(height: 20),
                DefaultTextStyle(
                  style: TextStyle(color: onBg),
                  child: const MimicWordmark(fontSize: 40),
                ),
                const SizedBox(height: 14),
                // Accent underline that grows out from the center.
                AnimatedBuilder(
                  animation: _underline,
                  builder: (context, _) => Container(
                    height: 3,
                    width: 120 * _underline.value,
                    decoration: BoxDecoration(
                      color: accent,
                      borderRadius: BorderRadius.circular(3),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
