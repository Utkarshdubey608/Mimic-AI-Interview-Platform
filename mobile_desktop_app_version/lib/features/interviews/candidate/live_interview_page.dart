// lib/features/interviews/candidate/live_interview_page.dart
//
// The live recruiter ↔ candidate call, from either side.
//
// Two states, one screen:
//
//   WAITING — the candidate has arrived before the interviewer. The backend
//             answers 409 until the recruiter opens the call, so this polls and
//             says so plainly. It is a normal part of the flow, not an error,
//             and the wording has to reflect that or people close the app.
//   IN CALL — the room, rendered by whichever engine the backend put us on.
//
// The recruiter takes the same screen with `isHost: true`, which opens the call
// instead of waiting for it, and gets the End button — ending deletes the room,
// which ejects the candidate too.
//
// TWO ENGINES, ONE SCREEN. `TWOWAY_ENGINE` on the backend decides, and the grant
// says which by its URL scheme (see [TwoWayGrant.isLiveKit]):
//
//   * LIVEKIT — the same engine the website runs on, and the default. LiveKit
//     hands out a `wss://` endpoint, not a page, so the call is rendered here
//     natively from [LiveKitCall]: remote video full-bleed, the local camera in
//     a corner, and our own controls. There is no lobby — a minted token is
//     already authorised — so the candidate goes straight in once the room
//     exists.
//   * DAILY — Daily serves a whole prebuilt call UI at the room URL, so that
//     path stays exactly what it was: load it in the locked-down WebView and let
//     Daily provide the lobby, the admit control and the call buttons.
//
// The Daily branch is kept rather than deleted so a deployment can still run
// `TWOWAY_ENGINE=daily`; it is not the path the product is on.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/utils/desktop_platform.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/services/livekit_call.dart';
import 'package:talbotiq/features/interviews/services/twoway_service.dart';
import 'package:talbotiq/shared/widgets/iframe_view.dart';

import 'package:livekit_client/livekit_client.dart'
    show Participant, TrackSource, VideoTrack, VideoTrackRenderer, VideoViewFit;

class LiveInterviewPage extends StatefulWidget {
  final Interview interview;

  /// True for the recruiter, who OPENS the call. The candidate waits for it.
  final bool isHost;

  const LiveInterviewPage({
    super.key,
    required this.interview,
    this.isHost = false,
  });

  @override
  State<LiveInterviewPage> createState() => _LiveInterviewPageState();
}

class _LiveInterviewPageState extends State<LiveInterviewPage> {
  /// How often the candidate re-asks whether the interviewer has arrived.
  ///
  /// Five seconds: fast enough that they are not left staring after the recruiter
  /// joins, slow enough that a candidate waiting ten minutes does not make 600
  /// requests. The call is minted per poll only on SUCCESS, so a wait costs
  /// nothing but the room check.
  static const _pollInterval = Duration(seconds: 5);

  TwoWayGrant? _grant;
  String? _error;
  bool _waiting = false;
  bool _ending = false;

  /// Set on dispose so the poll loop stops instead of running against a screen
  /// nobody is looking at.
  bool _disposed = false;

  /// The LiveKit room, built only once a LiveKit grant arrives — a Daily call
  /// never touches it. Owned by this screen, so it is torn down with it.
  LiveKitCall? _call;

  /// True once WE have started leaving, so the "the call ended without us"
  /// recovery below does not fire on our own teardown.
  bool _leaving = false;

  @override
  void initState() {
    super.initState();
    _connect();
  }

  @override
  void dispose() {
    _disposed = true;
    _call?.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    setState(() {
      _error = null;
      _waiting = !widget.isHost;
    });

    while (!_disposed) {
      try {
        final grant = widget.isHost
            ? await twoWayService.host(widget.interview.id)
            : await twoWayService.join(widget.interview.id);
        if (_disposed || !mounted) return;
        setState(() {
          _grant = grant;
          _waiting = false;
        });
        if (grant.isLiveKit) await _joinLiveKit(grant);
        return;
      } on TwoWayNotStarted {
        // Expected: the interviewer has not opened the call. Keep waiting.
        if (_disposed || !mounted) return;
        setState(() => _waiting = true);
        await Future<void>.delayed(_pollInterval);
      } catch (e) {
        if (_disposed || !mounted) return;
        setState(() {
          _error = e.toString().replaceAll('Exception: ', '');
          _waiting = false;
        });
        return;
      }
    }
  }

  /// Connect to the LiveKit room the grant points at.
  ///
  /// The controller carries its own state and error, so failures here surface in
  /// the call UI rather than through [_error] — that one is for failing to get a
  /// grant at all, which is a different problem with a different remedy.
  Future<void> _joinLiveKit(TwoWayGrant grant) async {
    var call = _call;
    if (call == null) {
      call = LiveKitCall();
      call.addListener(_onCallChanged);
      _call = call;
    }
    await call.join(grant.roomUrl, grant.token);
  }

  /// Rebuild on every room change, and catch the call ending without us.
  ///
  /// The far side hanging up — the recruiter ending the interview, which deletes
  /// the room — reaches us as a disconnect. Without this the candidate would sit
  /// on a dead call with no explanation.
  void _onCallChanged() {
    if (_disposed || !mounted) return;
    setState(() {});
    if (_call?.callState != CallState.left || _leaving || _ending) return;

    _leaving = true;
    // Both taken BEFORE the pop: after it this State is off the tree and
    // `context` can no longer find either of them.
    final messenger = ScaffoldMessenger.of(context);
    Navigator.of(context).pop();
    messenger.showSnackBar(
      const SnackBar(content: Text('The interview has ended.')),
    );
  }

  /// Rejoin after a failure. Drops the dead controller first — a [LiveKitCall]
  /// that errored still holds the room it could not join.
  Future<void> _retry() async {
    final call = _call;
    _call = null;
    if (call != null) {
      call.removeListener(_onCallChanged);
      call.dispose();
    }
    setState(() => _grant = null);
    await _connect();
  }

  Future<void> _end() async {
    final leaving = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(widget.isHost ? 'End this interview?' : 'Leave the call?'),
        content: Text(
          widget.isHost
              // Ending deletes the room, so it is not just the recruiter leaving.
              ? 'This ends the call for the candidate too. You can then score it '
                  'from the round\'s candidate list.'
              : 'You can rejoin while the interviewer is still in the call.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Stay')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(widget.isHost ? 'End interview' : 'Leave'),
          ),
        ],
      ),
    );
    if (leaving != true || !mounted) return;

    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);

    // Set BEFORE leaving the room: disconnecting fires the "ended without us"
    // path above, which must not also pop the screen.
    _leaving = true;

    if (!widget.isHost) {
      await _call?.leave();
      navigator.pop();
      return;
    }

    setState(() => _ending = true);
    try {
      await twoWayService.complete(widget.interview.id);
      await _call?.leave();
      if (!mounted) return;
      navigator.pop();
      messenger.showSnackBar(const SnackBar(
        content: Text('Interview ended. Score it from the candidate list.'),
      ));
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _ending = false;
        _leaving = false;
      });
      // The call may well have ended for both parties even though recording that
      // failed — say what is actually known.
      messenger.showSnackBar(SnackBar(
        content: Text('Could not end the interview cleanly: '
            '${e.toString().replaceAll('Exception: ', '')}'),
      ));
    }
  }

  /// Whether the body is already showing a hang-up control of its own.
  ///
  /// The LiveKit stage has one in its control bar, and two End buttons on the
  /// same screen is one too many — the Daily WebView, by contrast, gives us
  /// nothing, so there the app bar is the only way out.
  bool get _stageHasOwnControls =>
      (_grant?.isLiveKit ?? false) && _call?.callState == CallState.joined;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return PopScope(
      // Backing out of a live call by accident is easy and costly, so the
      // confirm runs first.
      canPop: _grant == null,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _end();
      },
      child: Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: Colors.black,
          foregroundColor: Colors.white,
          title: Text(widget.interview.title),
          actions: [
            if (_grant != null && !_stageHasOwnControls)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: TextButton.icon(
                  onPressed: _ending ? null : _end,
                  icon: Icon(
                      widget.isHost ? Icons.call_end : Icons.logout,
                      size: 18,
                      color: theme.colorScheme.error),
                  label: Text(widget.isHost ? 'End' : 'Leave',
                      style: TextStyle(color: theme.colorScheme.error)),
                ),
              ),
          ],
        ),
        body: _body(theme),
      ),
    );
  }

  Widget _body(ThemeData theme) {
    final grant = _grant;
    if (_error != null) return _errorView(theme, _error!);
    if (grant == null) return _waitingView(theme);
    if (!grant.isLiveKit) return buildIframe(grant.joinUrl);

    final call = _call;
    if (call == null) return _waitingView(theme);
    switch (call.callState) {
      case CallState.error:
        return _errorView(theme, call.error ?? 'The call could not be joined.');
      case CallState.joined:
        return _LiveKitStage(
          call: call,
          isHost: widget.isHost,
          otherPartyName: widget.isHost
              ? (widget.interview.candidateName ?? 'the candidate')
              : (widget.interview.recruiterName ?? 'your interviewer'),
          ending: _ending,
          onEnd: _end,
        );
      case CallState.idle:
      case CallState.joining:
      case CallState.left:
        return _connectingView(theme);
    }
  }

  Widget _connectingView(ThemeData theme) => Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const CircularProgressIndicator(color: Colors.white70),
            const SizedBox(height: 24),
            Text('Connecting to the interview room…',
                style: theme.textTheme.titleMedium?.copyWith(
                    color: Colors.white, fontWeight: FontWeight.bold)),
          ],
        ),
      );

  Widget _waitingView(ThemeData theme) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const CircularProgressIndicator(color: Colors.white70),
              const SizedBox(height: 24),
              Text(
                widget.isHost
                    ? 'Opening the call…'
                    : 'Waiting for your interviewer',
                textAlign: TextAlign.center,
                style: theme.textTheme.titleMedium
                    ?.copyWith(color: Colors.white, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 10),
              Text(
                widget.isHost
                    ? 'Setting up the room.'
                    // Says plainly that waiting is normal and that they do not
                    // need to do anything — otherwise people close the app.
                    : '${widget.interview.recruiterName ?? 'Your interviewer'} '
                        'has not started this interview yet. Keep this screen '
                        'open — you will join automatically as soon as they do.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium
                    ?.copyWith(color: Colors.white70),
              ),
              if (!widget.isHost && _waiting) ...[
                const SizedBox(height: 20),
                Text('Checking every ${_pollInterval.inSeconds} seconds…',
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: Colors.white38)),
              ],
            ],
          ),
        ),
      );

  Widget _errorView(ThemeData theme, String message) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.error_outline,
                  size: 44, color: theme.colorScheme.error),
              const SizedBox(height: 16),
              Text(
                widget.isHost
                    ? 'Could not open the call'
                    : 'Could not join the call',
                style: theme.textTheme.titleMedium
                    ?.copyWith(color: Colors.white, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 10),
              Text(message,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(color: Colors.white70)),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: _retry,
                icon: const Icon(Icons.refresh, size: 18),
                label: const Text('Try again'),
              ),
            ],
          ),
        ),
      );
}

/// The call itself: the other person full-bleed, you in the corner, controls
/// along the bottom.
///
/// The layout is the website's TwoWayStage in phone form — one remote tile
/// because a two-way round has exactly one other participant, so there is no
/// grid to lay out and the video can simply fill the screen.
class _LiveKitStage extends StatelessWidget {
  const _LiveKitStage({
    required this.call,
    required this.isHost,
    required this.otherPartyName,
    required this.ending,
    required this.onEnd,
  });

  final LiveKitCall call;
  final bool isHost;
  final String otherPartyName;
  final bool ending;
  final VoidCallback onEnd;

  @override
  Widget build(BuildContext context) {
    final remote = call.participants.isEmpty ? null : call.participants.first;
    final remoteTrack = _cameraTrackOf(remote);
    final localTrack = _cameraTrackOf(call.localParticipant);

    return Stack(
      fit: StackFit.expand,
      children: [
        if (remoteTrack != null)
          VideoTrackRenderer(remoteTrack, fit: VideoViewFit.cover)
        else
          _Placeholder(
            icon: remote == null ? Icons.hourglass_empty : Icons.videocam_off,
            // Two genuinely different situations, and telling them apart is the
            // difference between waiting patiently and thinking it is broken.
            message: remote == null
                ? 'Waiting for $otherPartyName to join…'
                : '${remote.name.isEmpty ? otherPartyName : remote.name} '
                    'has their camera off',
          ),

        // Your own camera, small and out of the way. Hidden entirely when off —
        // a black rectangle in the corner reads as a fault.
        if (localTrack != null)
          Positioned(
            top: 16,
            right: 16,
            width: 104,
            height: 148,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: ColoredBox(
                color: Colors.black54,
                child: VideoTrackRenderer(localTrack, fit: VideoViewFit.cover),
              ),
            ),
          ),

        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: _Controls(
            call: call,
            isHost: isHost,
            ending: ending,
            onEnd: onEnd,
          ),
        ),
      ],
    );
  }

  /// The participant's CAMERA track, if it is live.
  ///
  /// Skips a screen share (also a video track) and a muted publication, whose
  /// track can still be non-null but carries nothing to draw.
  static VideoTrack? _cameraTrackOf(Participant? participant) {
    if (participant == null) return null;
    for (final publication in participant.videoTrackPublications) {
      if (publication.source != TrackSource.camera || publication.muted) {
        continue;
      }
      final track = publication.track;
      if (track is VideoTrack) return track;
    }
    return null;
  }
}

/// Mic / camera / flip / hang up. Sits over the video on a scrim so the icons
/// stay readable against whatever is behind them.
class _Controls extends StatelessWidget {
  const _Controls({
    required this.call,
    required this.isHost,
    required this.ending,
    required this.onEnd,
  });

  final LiveKitCall call;
  final bool isHost;
  final bool ending;
  final VoidCallback onEnd;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        top: 20,
        bottom: 20 + MediaQuery.of(context).padding.bottom,
      ),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Colors.transparent, Colors.black87],
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          _CircleButton(
            icon: call.muted ? Icons.mic_off : Icons.mic,
            tooltip: call.muted ? 'Unmute' : 'Mute',
            active: !call.muted,
            onPressed: call.toggleMic,
          ),
          const SizedBox(width: 16),
          _CircleButton(
            icon: call.camOff ? Icons.videocam_off : Icons.videocam,
            tooltip: call.camOff ? 'Turn camera on' : 'Turn camera off',
            active: !call.camOff,
            onPressed: call.toggleCam,
          ),
          // Desktop machines have one camera and no notion of front/back.
          if (!isDesktopPlatform && !call.camOff) ...[
            const SizedBox(width: 16),
            _CircleButton(
              icon: Icons.cameraswitch,
              tooltip: 'Switch camera',
              active: true,
              onPressed: call.switchCamera,
            ),
          ],
          const SizedBox(width: 16),
          _CircleButton(
            icon: isHost ? Icons.call_end : Icons.logout,
            tooltip: isHost ? 'End interview' : 'Leave',
            active: false,
            danger: true,
            onPressed: ending ? null : onEnd,
          ),
        ],
      ),
    );
  }
}

class _CircleButton extends StatelessWidget {
  const _CircleButton({
    required this.icon,
    required this.tooltip,
    required this.active,
    required this.onPressed,
    this.danger = false,
  });

  final IconData icon;
  final String tooltip;

  /// Whether the thing this button controls is currently ON. An off control is
  /// shown filled rather than merely dimmed — "my mic is muted" has to be
  /// readable at a glance mid-sentence.
  final bool active;
  final bool danger;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final error = Theme.of(context).colorScheme.error;
    final background = danger
        ? error
        : active
            ? Colors.white12
            : Colors.white;
    final foreground = danger
        ? Colors.white
        : active
            ? Colors.white
            : Colors.black;

    return Tooltip(
      message: tooltip,
      child: Material(
        color: onPressed == null ? Colors.white24 : background,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onPressed,
          child: SizedBox(
            width: 56,
            height: 56,
            child: Icon(icon, color: foreground, size: 24),
          ),
        ),
      ),
    );
  }
}

class _Placeholder extends StatelessWidget {
  const _Placeholder({required this.icon, required this.message});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: const Color(0xFF101014),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 40, color: Colors.white38),
              const SizedBox(height: 14),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white70, fontSize: 15),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
