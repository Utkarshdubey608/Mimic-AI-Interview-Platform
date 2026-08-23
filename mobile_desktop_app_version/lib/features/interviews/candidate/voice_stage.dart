// lib/features/interviews/candidate/voice_stage.dart
//
// Candidate-facing UI for the real-time VOICE INTERVIEW track (Gemini Live
// native audio, on-device). This is the mobile counterpart of the website's
// src/features/interview/screens/VoiceStage.tsx: a large talk/listen state, a
// reactive "orb", a live caption panel, and mute/end controls — all driven by
// GeminiLiveService's event stream.
//
// This screen owns mic PERMISSION (requested up-front via permission_handler)
// and the service lifecycle; it disposes the service + its subscription on
// unmount. It does NOT wire the finished transcript into scoring — that
// integration into the candidate flow is done separately.
//
// !!! QA: needs a real Gemini key + a physical device (mic + speaker) to run;
// it cannot be exercised in this environment. See gemini_live_service.dart.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import 'package:talbotiq/core/net/live_token.dart';
import 'package:talbotiq/core/services/gemini_live_service.dart';
import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/theme/status_tones.dart';

class VoiceStage extends StatefulWidget {
  /// A backend-minted token for this one session.
  ///
  /// It carries the whole session configuration — model, voice, and the
  /// interviewer's instruction — all resolved server-side from the interview, so
  /// none of those are parameters here. Mint it immediately before pushing this
  /// screen; the connect window is short.
  final LiveTokenGrant grant;

  /// Display name for the interviewer persona.
  final String personaName;

  /// Company name for the header.
  final String companyName;

  /// Recruiter-configured whole-interview time limit. Overrides
  /// GeminiLiveService's default cap so the call honours what the recruiter
  /// actually set, and drives the header countdown.
  final Duration? maxDuration;

  /// Called when the interview reaches a terminal state (ended or error), so
  /// the host flow can advance (e.g. to scoring / a thank-you screen). Receives
  /// the candidate's spoken responses (final caption lines) so the host can
  /// build a transcript and score it. Optional.
  final void Function(
      GeminiLiveState finalState, List<String> candidateResponses)? onFinished;

  const VoiceStage({
    super.key,
    required this.grant,
    this.personaName = 'AI Interviewer',
    this.companyName = 'Mimic',
    this.maxDuration,
    this.onFinished,
  });

  @override
  State<VoiceStage> createState() => _VoiceStageState();
}

/// Local screen phase, distinct from the service's call state so we can render
/// the pre-call intro / permission gate before any connection exists.
enum _Screen { intro, requestingPermission, permissionDenied, live }

class _VoiceStageState extends State<VoiceStage>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  GeminiLiveService? _service;
  StreamSubscription<GeminiLiveEvent>? _sub;
  late final AnimationController _pulse;

  _Screen _screen = _Screen.intro;
  GeminiLiveState _callState = GeminiLiveState.connecting;
  bool _muted = false;
  bool _showCaptions = false;
  String? _error;

  // Live captions. Streaming partials replace the speaker's most recent
  // non-final line in place; a final flush commits it (mirrors useVoiceSession).
  final List<_Caption> _captions = [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pulse.dispose();
    // Cancel our subscription BEFORE disposing the service so no event fires
    // into a torn-down State.
    _sub?.cancel();
    _service?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Re-check permission when returning from the OS Settings app.
    if (state == AppLifecycleState.resumed &&
        _screen == _Screen.permissionDenied) {
      _startFlow();
    }
  }

  // ---- start / permission -------------------------------------------------

  Future<void> _startFlow() async {
    setState(() {
      _screen = _Screen.requestingPermission;
      _error = null;
    });
    final status = await Permission.microphone.request();
    if (!mounted) return;
    if (!status.isGranted) {
      setState(() => _screen = _Screen.permissionDenied);
      return;
    }
    await _connect();
  }

  Future<void> _connect() async {
    final service = widget.maxDuration != null
        ? GeminiLiveService(maxDuration: widget.maxDuration!)
        : GeminiLiveService();
    _service = service;
    _sub = service.events.listen(_onEvent);
    if (!mounted) return;
    setState(() {
      _screen = _Screen.live;
      _callState = GeminiLiveState.connecting;
    });
    try {
      await service.connect(grant: widget.grant);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _callState = GeminiLiveState.error;
        _error = '$e';
      });
    }
  }

  // ---- service events -----------------------------------------------------

  void _onEvent(GeminiLiveEvent event) {
    if (!mounted) return;
    switch (event) {
      case GeminiLiveStateChanged(:final state):
        setState(() => _callState = state);
        // Notify the host on ANY terminal state. It is the host's job to score
        // ONLY a genuine graceful finish (ended); it must skip interrupted/error
        // (a dropped/aborted interview should stay retakeable, not scored).
        if (state == GeminiLiveState.ended ||
            state == GeminiLiveState.interrupted ||
            state == GeminiLiveState.error) {
          final responses = _captions
              .where((c) => c.role == CaptionRole.candidate)
              .map((c) => c.text.trim())
              .where((t) => t.isNotEmpty)
              .toList();
          widget.onFinished?.call(state, responses);
        }
      case GeminiLiveCaption(:final role, :final text, :final isFinal):
        setState(() => _applyCaption(role, text, isFinal));
      case GeminiLiveInterrupted():
        // Drop the interviewer's in-flight (non-final) caption line.
        setState(() {
          _captions.removeWhere(
            (c) => c.role == CaptionRole.interviewer && !c.isFinal,
          );
        });
      case GeminiLiveErrorEvent(:final message):
        setState(() => _error = message);
    }
  }

  void _applyCaption(CaptionRole role, String text, bool isFinal) {
    for (int i = _captions.length - 1; i >= 0; i--) {
      if (_captions[i].role == role && !_captions[i].isFinal) {
        _captions[i] = _Caption(role, text, isFinal);
        return;
      }
    }
    _captions.add(_Caption(role, text, isFinal));
  }

  // ---- controls -----------------------------------------------------------

  void _toggleMute() {
    final next = !_muted;
    _service?.mute(next);
    setState(() => _muted = next);
  }

  Future<void> _end() async {
    await _service?.end();
  }

  // ---- build --------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      body: SafeArea(
        child: switch (_screen) {
          _Screen.intro => _buildIntro(theme),
          _Screen.requestingPermission => _buildBusy(theme),
          _Screen.permissionDenied => _buildPermissionDenied(theme),
          _Screen.live => _buildLive(theme),
        },
      ),
    );
  }

  Widget _buildBusy(ThemeData theme) =>
      const Center(child: CircularProgressIndicator());

  Widget _buildIntro(ThemeData theme) {
    final cs = theme.colorScheme;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  color: cs.primary.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Icon(Icons.mic_none_rounded, size: 34, color: cs.primary),
              ),
              const SizedBox(height: 20),
              Text(
                'Voice interview',
                textAlign: TextAlign.center,
                style: theme.textTheme.headlineSmall
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 10),
              Text(
                'You will have a spoken conversation with ${widget.personaName}. '
                'Find a quiet spot — when you are ready, we will ask for your '
                'microphone and begin.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium
                    ?.copyWith(color: cs.onSurfaceVariant),
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: _startFlow,
                icon: const Icon(Icons.mic_rounded),
                label: const Text('Start voice interview'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(52),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPermissionDenied(ThemeData theme) {
    final cs = theme.colorScheme;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.mic_off_rounded, size: 44, color: cs.error),
              const SizedBox(height: 16),
              Text(
                'Microphone blocked',
                textAlign: TextAlign.center,
                style: theme.textTheme.titleLarge
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 10),
              Text(
                'A voice interview needs your microphone. Enable microphone '
                'access for this app in Settings, then return here.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium
                    ?.copyWith(color: cs.onSurfaceVariant),
              ),
              const SizedBox(height: 20),
              OutlinedButton(
                onPressed: openAppSettings,
                child: const Text('Open settings'),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: _startFlow,
                child: const Text('Try again'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildLive(ThemeData theme) {
    // Terminal states get their own full-screen treatment.
    if (_callState == GeminiLiveState.ended) return _buildEnded(theme);
    if (_callState == GeminiLiveState.interrupted) {
      return _buildInterrupted(theme);
    }
    if (_callState == GeminiLiveState.error) return _buildError(theme);

    final cs = theme.colorScheme;
    final connecting = _callState == GeminiLiveState.connecting;

    return Column(
      children: [
        // header
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  widget.companyName,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: cs.primary,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              if (_service?.remaining != null) ...[
                _CountdownBadge(service: _service!),
                const SizedBox(width: 10),
              ],
              _LiveDot(connecting: connecting),
              const SizedBox(width: 6),
              Text(
                connecting ? 'Connecting' : 'Live',
                style: theme.textTheme.labelMedium
                    ?.copyWith(color: cs.onSurfaceVariant),
              ),
            ],
          ),
        ),
        // stage
        Expanded(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _Orb(state: _callState, pulse: _pulse, scheme: cs),
                  const SizedBox(height: 20),
                  Text(
                    widget.personaName,
                    style: theme.textTheme.titleLarge
                        ?.copyWith(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _phaseLabel(_callState),
                    style: theme.textTheme.bodyMedium
                        ?.copyWith(color: cs.onSurfaceVariant),
                  ),
                  if (_showCaptions) ...[
                    const SizedBox(height: 20),
                    _CaptionPanel(
                      captions: _captions,
                      personaName: widget.personaName,
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
        // controls
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _RoundControl(
                icon: _muted ? Icons.mic_off_rounded : Icons.mic_rounded,
                onTap: connecting ? null : _toggleMute,
                tooltip: _muted ? 'Unmute microphone' : 'Mute microphone',
                foreground: _muted ? cs.error : cs.onSurface,
                background: cs.surfaceContainerHighest.withOpacity(0.4),
              ),
              const SizedBox(width: 20),
              _RoundControl(
                icon: Icons.call_end_rounded,
                onTap: _end,
                tooltip: 'End interview',
                foreground: cs.onError,
                background: cs.error,
                size: 68,
              ),
              const SizedBox(width: 20),
              _RoundControl(
                icon: Icons.closed_caption_rounded,
                onTap: () => setState(() => _showCaptions = !_showCaptions),
                tooltip: 'Toggle captions',
                foreground: _showCaptions ? cs.onPrimary : cs.onSurface,
                background: _showCaptions
                    ? cs.primary
                    : cs.surfaceContainerHighest.withOpacity(0.4),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildEnded(ThemeData theme) {
    final cs = theme.colorScheme;
    final timedOut = _service?.endedByTimeout ?? false;
    // Nothing the candidate said was ever transcribed. Claiming "All done,
    // thank you!" here is misleading — the interview effectively didn't happen,
    // and the recruiter will receive an unscored record. Say so, and point at
    // the usual cause (mic permission / muted).
    final capturedNothing = !_captions
        .any((c) => c.role == CaptionRole.candidate && c.text.trim().isNotEmpty);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                capturedNothing
                    ? Icons.mic_off_rounded
                    : Icons.check_circle_rounded,
                size: 48,
                color: capturedNothing ? cs.error : cs.primary,
              ),
              const SizedBox(height: 16),
              Text(
                capturedNothing
                    ? 'We didn’t hear any answers'
                    : timedOut
                        ? 'Time is up'
                        : 'All done, thank you!',
                textAlign: TextAlign.center,
                style: theme.textTheme.headlineSmall
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 10),
              Text(
                capturedNothing
                    ? 'The interview ended without capturing any spoken '
                        'answers. Check that your microphone is unmuted and '
                        'that this app has microphone permission, then ask '
                        '${widget.companyName} about retaking it.'
                    : timedOut
                        ? 'Time is up. Your interview has been automatically '
                            'submitted. Please wait while we process your '
                            'responses.'
                        : 'Your voice interview with ${widget.companyName} is '
                            'complete. The hiring team will be in touch about '
                            'next steps.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium
                    ?.copyWith(color: cs.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildError(ThemeData theme) {
    final cs = theme.colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline_rounded, size: 44, color: cs.error),
              const SizedBox(height: 16),
              Text(
                'Connection problem',
                textAlign: TextAlign.center,
                style: theme.textTheme.titleLarge
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 10),
              Text(
                _error ?? 'The voice interview could not continue.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium
                    ?.copyWith(color: cs.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildInterrupted(ThemeData theme) {
    final cs = theme.colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.wifi_off_rounded, size: 44, color: cs.error),
              const SizedBox(height: 16),
              Text(
                'Interview interrupted',
                textAlign: TextAlign.center,
                style: theme.textTheme.titleLarge
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 10),
              Text(
                _error ??
                    'The connection was lost before the interview finished. '
                        'Your progress was not scored — you can try the '
                        'interview again.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium
                    ?.copyWith(color: cs.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _phaseLabel(GeminiLiveState s) => switch (s) {
        GeminiLiveState.connecting => 'Connecting…',
        GeminiLiveState.greeting => 'Interviewer is speaking',
        GeminiLiveState.speaking => 'Interviewer is speaking',
        GeminiLiveState.listening => 'Listening…',
        GeminiLiveState.ended => 'Interview complete',
        GeminiLiveState.interrupted => 'Connection lost',
        GeminiLiveState.error => 'Something went wrong',
      };
}

// ---- private view models / widgets ---------------------------------------

class _Caption {
  final CaptionRole role;
  final String text;
  final bool isFinal;
  const _Caption(this.role, this.text, this.isFinal);
}

/// Header countdown for the recruiter-configured limit. Owns its own ticker so
/// only this chip repaints each second — driving it from the parent would
/// rebuild the whole live screen (orb, captions, controls) every second.
class _CountdownBadge extends StatefulWidget {
  final GeminiLiveService service;
  const _CountdownBadge({required this.service});

  @override
  State<_CountdownBadge> createState() => _CountdownBadgeState();
}

class _CountdownBadgeState extends State<_CountdownBadge> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final remaining = widget.service.remaining;
    if (remaining == null) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    final warning = remaining.inSeconds <= 60;
    final color = warning ? cs.error : cs.onSurfaceVariant;
    final m = remaining.inSeconds ~/ 60;
    final s = remaining.inSeconds % 60;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.hourglass_bottom, size: 14, color: color),
        const SizedBox(width: 4),
        Text(
          '$m:${s.toString().padLeft(2, '0')}',
          style: theme.textTheme.labelMedium?.copyWith(
            color: color,
            fontWeight: FontWeight.bold,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ],
    );
  }
}

class _LiveDot extends StatelessWidget {
  final bool connecting;
  const _LiveDot({required this.connecting});
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: connecting
            ? StatusTone.pending(context)
            : StatusTone.ready(context),
      ),
    );
  }
}

/// Reactive orb: ripples/scales while the interviewer speaks, gently pulses
/// (green) while listening. Purely decorative and theme-aware.
class _Orb extends StatelessWidget {
  final GeminiLiveState state;
  final AnimationController pulse;
  final ColorScheme scheme;
  const _Orb({required this.state, required this.pulse, required this.scheme});

  @override
  Widget build(BuildContext context) {
    final speaking = state == GeminiLiveState.speaking ||
        state == GeminiLiveState.greeting;
    final listening = state == GeminiLiveState.listening;
    final color =
        listening ? StatusTone.ready(context) : (speaking ? scheme.primary : scheme.outline);

    return SizedBox(
      width: 200,
      height: 200,
      child: AnimatedBuilder(
        animation: pulse,
        builder: (context, _) {
          final t = pulse.value; // 0..1
          final active = speaking || listening;
          final ringScale = active ? 1.0 + t * (speaking ? 0.9 : 0.6) : 1.0;
          final coreScale = active ? 1.0 + t * (speaking ? 0.06 : 0.03) : 1.0;
          return Stack(
            alignment: Alignment.center,
            children: [
              if (active)
                Opacity(
                  opacity: (1.0 - t) * 0.4,
                  child: Transform.scale(
                    scale: ringScale,
                    child: Container(
                      width: 140,
                      height: 140,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: color.withOpacity(0.25),
                      ),
                    ),
                  ),
                ),
              Transform.scale(
                scale: coreScale,
                child: Container(
                  width: 120,
                  height: 120,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [color, color.withOpacity(0.75)],
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: color.withOpacity(0.35),
                        blurRadius: 24,
                        spreadRadius: 2,
                      ),
                    ],
                  ),
                  child: Icon(
                    listening ? Icons.hearing_rounded : Icons.graphic_eq_rounded,
                    color: Colors.white.withOpacity(0.9),
                    size: 40,
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _CaptionPanel extends StatelessWidget {
  final List<_Caption> captions;
  final String personaName;
  const _CaptionPanel({required this.captions, required this.personaName});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    final recent = captions.length > 12
        ? captions.sublist(captions.length - 12)
        : captions;
    return Container(
      constraints: const BoxConstraints(maxWidth: 520, maxHeight: 200),
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest.withOpacity(0.3),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: cs.outlineVariant.withOpacity(0.4)),
      ),
      child: recent.isEmpty
          ? Text(
              'Captions will appear here as you talk.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: cs.onSurfaceVariant),
            )
          : ListView.separated(
              shrinkWrap: true,
              reverse: true,
              itemCount: recent.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, i) {
                // reverse:true -> render newest at the bottom.
                final c = recent[recent.length - 1 - i];
                final isCandidate = c.role == CaptionRole.candidate;
                return Column(
                  crossAxisAlignment: isCandidate
                      ? CrossAxisAlignment.end
                      : CrossAxisAlignment.start,
                  children: [
                    Text(
                      isCandidate ? 'You' : personaName,
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: cs.onSurfaceVariant,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.5,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      c.text,
                      textAlign:
                          isCandidate ? TextAlign.right : TextAlign.left,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: isCandidate ? cs.onSurface : cs.onSurfaceVariant,
                      ),
                    ),
                  ],
                );
              },
            ),
    );
  }
}

class _RoundControl extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onTap;
  final String tooltip;
  final Color foreground;
  final Color background;
  final double size;
  const _RoundControl({
    required this.icon,
    required this.onTap,
    required this.tooltip,
    required this.foreground,
    required this.background,
    this.size = 56,
  });

  @override
  Widget build(BuildContext context) {
    final disabled = onTap == null;
    return Tooltip(
      message: tooltip,
      child: Opacity(
        opacity: disabled ? 0.4 : 1.0,
        child: Material(
          color: background,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: SizedBox(
              width: size,
              height: size,
              child: Icon(icon, color: foreground, size: size * 0.42),
            ),
          ),
        ),
      ),
    );
  }
}
