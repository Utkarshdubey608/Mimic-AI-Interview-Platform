import 'package:flutter/material.dart';
import 'package:talbotiq/shared/providers/app_store.dart';
import 'package:talbotiq/shared/widgets/iframe_view.dart';
import 'package:talbotiq/features/interviews/candidate/interview/widgets/pulsing_avatar.dart';

/// Full-bleed video surface for the candidate's live interview call.
///
/// The Tavus/Daily call embed (or the demo placeholder) fills the entire
/// screen edge to edge, like a native video-call app — no card, border, or
/// margin around it. [QuestionBar] floats on top of this as a translucent
/// overlay rather than sitting in a separate panel beneath it.
class VideoPanel extends StatelessWidget {
  final AppStore store;
  final List<String> validQs;

  const VideoPanel({
    super.key,
    required this.store,
    required this.validQs,
  });

  /// A thin progress line flush with the top edge, showing progress through
  /// the question list.
  Widget _buildProgressBar(int currentQ) {
    final double pct = validQs.isEmpty ? 0 : (currentQ + 1) / validQs.length;
    return Container(
      height: 3,
      width: double.infinity,
      color: Colors.white.withOpacity(0.15),
      child: Align(
        alignment: Alignment.centerLeft,
        child: FractionallySizedBox(
          widthFactor: pct,
          child: Container(color: Colors.white.withOpacity(0.85)),
        ),
      ),
    );
  }

  /// Placeholder visual when there is no active video stream (Demo Mode).
  Widget _buildDemoPlaceholder(ThemeData theme) {
    return Container(
      color: Colors.black,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const PulsingAvatar(),
          const SizedBox(height: 16),
          Text(
            'Demo mode',
            style: theme.textTheme.titleMedium?.copyWith(
              color: Colors.white,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Avatar speech and transcripts are simulated.\nPress next (⏭) to advance questions.',
            style: theme.textTheme.bodyMedium?.copyWith(color: Colors.white70),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasUrl = store.currentConversation?.conversationUrl.isNotEmpty ?? false;

    return Container(
      color: Colors.black,
      child: Stack(
        fit: StackFit.expand,
        children: [
          (hasUrl && store.currentRoute == '/interview')
              ? buildIframe(store.currentConversation!.conversationUrl)
              : _buildDemoPlaceholder(theme),
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: _buildProgressBar(store.currentQuestionIdx),
          ),
        ],
      ),
    );
  }
}
