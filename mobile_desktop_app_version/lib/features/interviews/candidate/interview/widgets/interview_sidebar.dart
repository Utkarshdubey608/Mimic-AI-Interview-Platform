import 'package:flutter/material.dart';
import 'package:talbotiq/shared/providers/app_store.dart';
import 'package:talbotiq/features/interviews/candidate/interview/widgets/sidebar/questions_tab.dart';
import 'package:talbotiq/features/interviews/candidate/interview/widgets/sidebar/live_ai_tab.dart';
import 'package:talbotiq/features/interviews/candidate/interview/widgets/sidebar/transcript_tab.dart';

/// A stateful widget representing the interview sidebar, containing three tabs:
/// Questions list, Live AI metrics, and Live Speech Transcript.
class InterviewSidebar extends StatefulWidget {
  final AppStore store;
  final List<String> validQs;
  final int revealedIdx;
  final Function(int) onQuestionTap;
  final bool isMobile;
  final VoidCallback onEndInterview;
  final TextEditingController overrideController;
  final VoidCallback onSendOverride;

  /// When true (the candidate-facing video flow), the Questions tab shows only
  /// the current question and disables jumping to arbitrary questions, so a
  /// candidate cannot preview upcoming questions. Defaults to false so any
  /// non-candidate use keeps the full, navigable list.
  final bool candidateMode;

  const InterviewSidebar({
    super.key,
    required this.store,
    required this.validQs,
    required this.revealedIdx,
    required this.onQuestionTap,
    required this.isMobile,
    required this.onEndInterview,
    required this.overrideController,
    required this.onSendOverride,
    this.candidateMode = false,
  });

  @override
  State<InterviewSidebar> createState() => _InterviewSidebarState();
}

class _InterviewSidebarState extends State<InterviewSidebar> {
  String _activeTab = 'questions'; // 'questions', 'live', 'transcript'

  /// Renders a single tab selector button (QUESTIONS, LIVE AI, TRANSCRIPT).
  Widget _buildTabButton(String id, String title) {
    final theme = Theme.of(context);
    final active = _activeTab == id;
    return Expanded(
      child: InkWell(
        onTap: () => setState(() => _activeTab = id),
        child: Container(
          alignment: Alignment.center,
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: active ? theme.colorScheme.primary : Colors.transparent,
                width: 2,
              ),
            ),
          ),
          child: Text(
            title,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.bold,
              color: active
                  ? theme.colorScheme.primary
                  : theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ),
      ),
    );
  }

  /// Renders the content of the currently active tab.
  Widget _buildTabContent() {
    switch (_activeTab) {
      case 'questions':
        return QuestionsTab(
          store: widget.store,
          validQs: widget.validQs,
          revealedIdx: widget.revealedIdx,
          onQuestionTap: widget.onQuestionTap,
          candidateMode: widget.candidateMode,
        );
      case 'live':
        return LiveAiTab(
          store: widget.store,
          overrideController: widget.overrideController,
          onSendOverride: widget.onSendOverride,
        );
      case 'transcript':
        return const TranscriptTab();
      default:
        return const SizedBox.shrink();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: widget.isMobile ? null : 320,
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(
          left: widget.isMobile
              ? BorderSide.none
              : BorderSide(color: theme.colorScheme.outline.withOpacity(0.12)),
          top: widget.isMobile
              ? BorderSide(color: theme.colorScheme.outline.withOpacity(0.12))
              : BorderSide.none,
        ),
      ),
      child: Column(
        children: [
          // Sidebar tabs
          Container(
            height: 48,
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(
                  color: theme.colorScheme.outline.withOpacity(0.12),
                ),
              ),
            ),
            child: Row(
              children: [
                if (widget.isMobile)
                  IconButton(
                    icon: Icon(
                      Icons.close,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    onPressed: () => Navigator.pop(context),
                  ),
                _buildTabButton('questions', 'QUESTIONS'),
                _buildTabButton('live', 'LIVE AI'),
                _buildTabButton('transcript', 'TRANSCRIPT'),
              ],
            ),
          ),

          // Scrollable content
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: _buildTabContent(),
            ),
          ),

          // Sidebar status bar
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest.withOpacity(0.5),
              border: Border(
                top: BorderSide(
                  color: theme.colorScheme.outline.withOpacity(0.12),
                ),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primary.withOpacity(0.12),
                    border: Border.all(
                      color: theme.colorScheme.primary.withOpacity(0.24),
                    ),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    'ACTIVE',
                    style: TextStyle(
                      color: theme.colorScheme.primary,
                      fontSize: 9,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                TextButton(
                  onPressed: widget.onEndInterview,
                  child: Text(
                    'End interview',
                    style: TextStyle(
                      color: theme.colorScheme.error,
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
