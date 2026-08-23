// lib/features/guide/mimic_guide_page.dart
//
// Chat UI for the "Mimic Guide" in-app help assistant. Message bubbles for the
// user + assistant, a keyboard-safe composer, loading indicator while awaiting a
// reply, inline error state, and an empty state with a few suggested prompts.
// Theme-aware and responsive; all setState calls after an await are mounted-guarded.

import 'package:flutter/material.dart';

import 'package:talbotiq/features/guide/mimic_guide_service.dart';

class MimicGuidePage extends StatefulWidget {
  const MimicGuidePage({super.key});

  @override
  State<MimicGuidePage> createState() => _MimicGuidePageState();
}

class _MimicGuidePageState extends State<MimicGuidePage> {
  final MimicGuideService _service = mimicGuideService;
  final TextEditingController _input = TextEditingController();
  final ScrollController _scroll = ScrollController();
  final FocusNode _inputFocus = FocusNode();

  final List<GuideMessage> _messages = [];
  bool _sending = false;
  String? _error;

  static const List<String> _suggestions = [
    'How do I create an interview template?',
    'How does candidate scoring work?',
    'Where do I read a candidate\'s report?',
  ];

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    _inputFocus.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    // Defer to after the frame so the new bubble is laid out before we measure.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 260),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _send([String? preset]) async {
    final text = (preset ?? _input.text).trim();
    if (text.isEmpty || _sending) return;

    setState(() {
      _messages.add(GuideMessage(role: 'user', text: text));
      _input.clear();
      _sending = true;
      _error = null;
    });
    _scrollToBottom();

    try {
      // Send the full running history (newest user turn included).
      final reply = await _service.sendMessage(List.unmodifiable(_messages));
      if (!mounted) return;
      setState(() {
        _messages.add(GuideMessage(role: 'assistant', text: reply));
        _sending = false;
      });
      _scrollToBottom();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      appBar: AppBar(
        backgroundColor: theme.colorScheme.surface,
        elevation: 0,
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.support_agent, color: theme.colorScheme.primary, size: 22),
            const SizedBox(width: 10),
            Text(
              'Help & Guide',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
                color: theme.colorScheme.onSurface,
              ),
            ),
          ],
        ),
      ),
      // resizeToAvoidBottomInset keeps the composer above the keyboard.
      resizeToAvoidBottomInset: true,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: _messages.isEmpty ? _buildEmptyState(theme) : _buildList(theme),
            ),
            if (_error != null) _buildError(theme),
            _buildComposer(theme),
          ],
        ),
      ),
    );
  }

  Widget _buildList(ThemeData theme) {
    return ListView.builder(
      controller: _scroll,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      // One extra slot for the "assistant is typing" indicator.
      itemCount: _messages.length + (_sending ? 1 : 0),
      itemBuilder: (context, index) {
        if (index >= _messages.length) return _buildTypingIndicator(theme);
        return _buildBubble(theme, _messages[index]);
      },
    );
  }

  Widget _buildBubble(ThemeData theme, GuideMessage m) {
    final isUser = m.isUser;
    final bg = isUser ? theme.colorScheme.primary : theme.colorScheme.surfaceContainerHighest;
    final fg = isUser ? theme.colorScheme.onPrimary : theme.colorScheme.onSurface;
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.82,
        ),
        margin: const EdgeInsets.symmetric(vertical: 5),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(isUser ? 16 : 4),
            bottomRight: Radius.circular(isUser ? 4 : 16),
          ),
        ),
        child: SelectableText(
          m.text,
          style: theme.textTheme.bodyMedium?.copyWith(color: fg, height: 1.35),
        ),
      ),
    );
  }

  Widget _buildTypingIndicator(ThemeData theme) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 5),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerHighest,
          borderRadius: const BorderRadius.only(
            topLeft: Radius.circular(16),
            topRight: Radius.circular(16),
            bottomLeft: Radius.circular(4),
            bottomRight: Radius.circular(16),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                valueColor:
                    AlwaysStoppedAnimation<Color>(theme.colorScheme.onSurfaceVariant),
              ),
            ),
            const SizedBox(width: 10),
            Text(
              'Mimic Guide is typing…',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState(ThemeData theme) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 24),
          Icon(Icons.auto_awesome,
              size: 44, color: theme.colorScheme.primary.withOpacity(0.9)),
          const SizedBox(height: 16),
          Text(
            'Mimic Guide',
            textAlign: TextAlign.center,
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w800,
              color: theme.colorScheme.onSurface,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Your product help assistant. Ask about templates, question sets, sessions, scoring and reports.',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 28),
          Text(
            'TRY ASKING',
            textAlign: TextAlign.center,
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.secondary,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 12),
          for (final s in _suggestions) _buildSuggestion(theme, s),
        ],
      ),
    );
  }

  Widget _buildSuggestion(ThemeData theme, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: _sending ? null : () => _send(text),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            color: theme.colorScheme.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: theme.colorScheme.outline.withOpacity(0.5)),
          ),
          child: Row(
            children: [
              Icon(Icons.chat_bubble_outline,
                  size: 18, color: theme.colorScheme.primary),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  text,
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(color: theme.colorScheme.onSurface),
                ),
              ),
              Icon(Icons.north_east,
                  size: 16, color: theme.colorScheme.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildError(ThemeData theme) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(16, 4, 16, 4),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: theme.colorScheme.error.withOpacity(0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.colorScheme.error.withOpacity(0.4)),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline, size: 18, color: theme.colorScheme.error),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _error!,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.error),
            ),
          ),
          TextButton(
            onPressed: _sending ? null : () => _send(_lastUserText()),
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  // The most recent user turn, used to retry after a failed reply. The failed
  // user message stays in the list, so re-sending the same history is correct.
  String _lastUserText() {
    for (var i = _messages.length - 1; i >= 0; i--) {
      if (_messages[i].isUser) return _messages[i].text;
    }
    return '';
  }

  Widget _buildComposer(ThemeData theme) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(
          top: BorderSide(color: theme.colorScheme.outline.withOpacity(0.4)),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: TextField(
              controller: _input,
              focusNode: _inputFocus,
              minLines: 1,
              maxLines: 5,
              textInputAction: TextInputAction.send,
              enabled: !_sending,
              onSubmitted: (_) => _send(),
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: theme.colorScheme.onSurface),
              decoration: InputDecoration(
                hintText: 'Ask about using Mimic…',
                isDense: true,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              ),
            ),
          ),
          const SizedBox(width: 8),
          _SendButton(sending: _sending, onTap: _send),
        ],
      ),
    );
  }
}

// Circular send button that shows a spinner while a reply is in flight.
class _SendButton extends StatelessWidget {
  final bool sending;
  final VoidCallback onTap;
  const _SendButton({required this.sending, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.primary,
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: sending ? null : onTap,
        child: SizedBox(
          width: 46,
          height: 46,
          child: sending
              ? Padding(
                  padding: const EdgeInsets.all(13),
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor:
                        AlwaysStoppedAnimation<Color>(theme.colorScheme.onPrimary),
                  ),
                )
              : Icon(Icons.arrow_upward,
                  color: theme.colorScheme.onPrimary, size: 22),
        ),
      ),
    );
  }
}
