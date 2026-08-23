// lib/features/settings/sections/my_recordings_section.dart
//
// Settings category: the interview audio this device is keeping.
//
// Everything here is genuinely the user's own: whether the app writes a local
// .wav at all, and what it does with the ones it already has. There is no cloud
// destination to configure — the S3 recording target is org infrastructure and
// lives in the backend environment, not in a text field on a phone.

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/core/services/recording_service.dart';
import 'package:talbotiq/shared/models/app_models.dart';
import 'package:talbotiq/shared/providers/app_store.dart';
import 'package:talbotiq/shared/widgets/apple_ui.dart';
import 'package:talbotiq/shared/widgets/custom_buttons.dart';

class MyRecordingsSection extends StatefulWidget {
  const MyRecordingsSection({super.key});

  @override
  State<MyRecordingsSection> createState() => _MyRecordingsSectionState();
}

class _MyRecordingsSectionState extends State<MyRecordingsSection> {
  final AudioPlayer _audioPlayer = AudioPlayer();
  final RecordingService _recordingService = RecordingService();
  String? _playingId;

  @override
  void initState() {
    super.initState();
    _audioPlayer.onPlayerComplete.listen((_) {
      if (mounted) setState(() => _playingId = null);
    });
  }

  @override
  void dispose() {
    _audioPlayer.dispose();
    super.dispose();
  }

  /// Toggles playback of a stored recording, stopping any other that is playing.
  Future<void> _togglePlay(SavedRecording rec) async {
    if (_playingId == rec.id) {
      await _audioPlayer.stop();
      if (mounted) setState(() => _playingId = null);
      return;
    }
    try {
      await _audioPlayer.stop();
      await _audioPlayer.play(DeviceFileSource(rec.path));
      if (mounted) setState(() => _playingId = rec.id);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Could not play recording: $e'),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    }
  }

  Future<bool> _confirm(String title, String message) async {
    final theme = Theme.of(context);
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text('Cancel',
                style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
          ),
          CustomButton(
            text: 'Delete',
            variant: ButtonVariant.danger,
            onPressed: () => Navigator.pop(context, true),
          ),
        ],
      ),
    );
    return result == true;
  }

  Future<void> _deleteRecording(SavedRecording rec) async {
    if (!await _confirm(
      'Delete recording?',
      'Permanently delete "${rec.name}" from this device?',
    )) {
      return;
    }
    await _stopIfPlaying(rec.id);
    await _recordingService.deleteFile(rec.path);
    if (!mounted) return;
    context.read<AppStore>().deleteRecording(rec.id);
  }

  /// Deletes every stored recording — the control someone actually looks for
  /// when they want their audio gone, rather than removing them one at a time.
  Future<void> _deleteAll(List<SavedRecording> recordings) async {
    // Resolved before the first await — reading a provider off `context` after
    // one is unsafe once this widget may have been unmounted.
    final store = context.read<AppStore>();

    if (!await _confirm(
      'Delete all recordings?',
      'Permanently delete all ${recordings.length} recording(s) from this '
          'device? This cannot be undone.',
    )) {
      return;
    }
    await _audioPlayer.stop();
    if (mounted) setState(() => _playingId = null);

    for (final rec in recordings) {
      // Delete the file first; if that fails the entry stays so the user can
      // retry, rather than the list claiming the audio is gone while it isn't.
      await _recordingService.deleteFile(rec.path);
      if (!mounted) return;
      store.deleteRecording(rec.id);
    }
  }

  Future<void> _stopIfPlaying(String id) async {
    if (_playingId != id) return;
    await _audioPlayer.stop();
    if (mounted) setState(() => _playingId = null);
  }

  Widget _buildRow(SavedRecording rec) {
    final theme = Theme.of(context);
    final playing = _playingId == rec.id;
    final sizeMb = (rec.sizeBytes / (1024 * 1024)).toStringAsFixed(1);
    final date =
        rec.savedAt.contains('T') ? rec.savedAt.split('T').first : rec.savedAt;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: theme.colorScheme.onSurface.withOpacity(0.04),
        border: Border.all(color: theme.colorScheme.outline.withOpacity(0.12)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          IconButton(
            icon: Icon(
              playing ? Icons.stop_circle : Icons.play_circle_fill,
              color: theme.colorScheme.primary,
              size: 32,
            ),
            tooltip: playing ? 'Stop' : 'Play',
            onPressed: () => _togglePlay(rec),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  rec.name,
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(fontWeight: FontWeight.w600),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  '$date · $sizeMb MB',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontSize: 11,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            icon: Icon(Icons.delete_outline, color: theme.colorScheme.error),
            tooltip: 'Delete',
            onPressed: () => _deleteRecording(rec),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final store = context.watch<AppStore>();
    final recordings = store.recordings;

    return AppleSectionCard(
      title: 'My recordings',
      subtitle: 'Interview audio is kept only on this device.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Save my interview recordings'),
            subtitle: Text(
              store.storeLocalRecordings
                  ? 'A copy of each interview is saved here so you can play it back.'
                  : 'Interviews are not saved to this device.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            value: store.storeLocalRecordings,
            onChanged: store.setStoreLocalRecordings,
          ),
          if (recordings.isNotEmpty) ...[
            Divider(color: theme.colorScheme.outline.withOpacity(0.12)),
            const SizedBox(height: 12),
            ...recordings.map(_buildRow),
            const SizedBox(height: 4),
            Align(
              alignment: Alignment.centerLeft,
              child: CustomButton(
                text: 'Delete all recordings',
                variant: ButtonVariant.secondary,
                height: 40,
                onPressed: () => _deleteAll(recordings),
              ),
            ),
          ] else ...[
            const SizedBox(height: 8),
            Text(
              'No recordings on this device.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ],
      ),
    );
  }
}
