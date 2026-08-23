import 'package:flutter/material.dart';
import 'package:talbotiq/shared/providers/app_store.dart';
import 'package:talbotiq/core/constants/colors.dart';

/// Bottom overlay for the interview call: a translucent scrim over the video
/// showing the current question as a caption, plus prev/end/next controls —
/// styled like a native video-call app's control bar (WhatsApp/FaceTime),
/// floating over the video rather than occupying a separate panel beneath it.
class QuestionBar extends StatelessWidget {
  final AppStore store;
  final List<String> validQs;
  final bool avatarSpeaking;
  final bool autoAdvance;
  final int revealedIdx;
  final VoidCallback onToggleAutoAdvance;
  final VoidCallback onShowNow;
  final VoidCallback onPrevQuestion;
  final VoidCallback onNextQuestion;
  final VoidCallback onEndInterview;

  const QuestionBar({
    super.key,
    required this.store,
    required this.validQs,
    required this.avatarSpeaking,
    required this.autoAdvance,
    required this.revealedIdx,
    required this.onToggleAutoAdvance,
    required this.onShowNow,
    required this.onPrevQuestion,
    required this.onNextQuestion,
    required this.onEndInterview,
  });

  /// A circular translucent control button (prev/next/end), matching the
  /// frosted-glass look of native call-app control bars.
  Widget _circleButton({
    required IconData icon,
    required VoidCallback? onPressed,
    double size = 44,
    Color background = const Color(0x33FFFFFF),
    Color iconColor = Colors.white,
  }) {
    final disabled = onPressed == null;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: disabled ? const Color(0x14FFFFFF) : background,
        shape: BoxShape.circle,
      ),
      child: IconButton(
        icon: Icon(
          icon,
          size: size * 0.42,
          color: disabled ? Colors.white38 : iconColor,
        ),
        onPressed: onPressed,
        padding: EdgeInsets.zero,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isRevealed = revealedIdx == store.currentQuestionIdx;

    return Container(
      padding: EdgeInsets.fromLTRB(
        20,
        32,
        20,
        16 + MediaQuery.of(context).padding.bottom,
      ),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Colors.transparent, Color(0xCC000000)],
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'QUESTION ${store.currentQuestionIdx + 1} OF ${validQs.length}',
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.2,
                ),
              ),
              if (avatarSpeaking) ...[
                const SizedBox(width: 10),
                Container(
                  width: 6,
                  height: 6,
                  decoration: const BoxDecoration(
                    color: AppColors.pastelMintText,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 4),
                const Text(
                  'Speaking',
                  style: TextStyle(
                    color: AppColors.pastelMintText,
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
              const Spacer(),
              GestureDetector(
                onTap: onToggleAutoAdvance,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: const Color(0x26FFFFFF),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 6,
                        height: 6,
                        decoration: BoxDecoration(
                          color: autoAdvance ? AppColors.pastelMintText : Colors.white54,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        autoAdvance ? 'Auto' : 'Manual',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          isRevealed
              ? Text(
                  validQs.isNotEmpty
                      ? validQs[store.currentQuestionIdx]
                      : 'Done',
                  style: const TextStyle(
                    fontSize: 15,
                    color: Colors.white,
                    fontWeight: FontWeight.w500,
                    height: 1.3,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                )
              : Row(
                  children: [
                    const Text(
                      'Waiting for avatar to ask…',
                      style: TextStyle(
                        color: Colors.white70,
                        fontStyle: FontStyle.italic,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(width: 12),
                    GestureDetector(
                      onTap: onShowNow,
                      child: const Text(
                        'Show now',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          decoration: TextDecoration.underline,
                        ),
                      ),
                    ),
                  ],
                ),
          const SizedBox(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _circleButton(
                icon: Icons.skip_previous,
                onPressed: store.currentQuestionIdx > 0 ? onPrevQuestion : null,
              ),
              const SizedBox(width: 28),
              _circleButton(
                icon: Icons.call_end,
                onPressed: onEndInterview,
                size: 60,
                background: const Color(0xFFE53935),
              ),
              const SizedBox(width: 28),
              _circleButton(
                icon: Icons.skip_next,
                onPressed: onNextQuestion,
              ),
            ],
          ),
        ],
      ),
    );
  }
}
