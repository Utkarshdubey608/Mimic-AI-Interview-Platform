// lib/features/recruiter/voice/voice_picker.dart
//
// Reusable Voice & Persona picker for the recruiter.
//
// [VoicePicker] is an embeddable widget that takes the current [VoiceConfig]
// and an [onChanged] callback, and lets the recruiter choose an interviewer
// persona and a voice (with a short description of each), plus toggle barge-in.
// [VoicePicker.showBottomSheet] presents the same UI in a modal bottom sheet and
// resolves to the chosen [VoiceConfig] (or null if dismissed).
//
// Theme-aware (reads ColorScheme), responsive (scrolls, wraps, adapts to width),
// and disposes everything it creates.
//
// LIVE VOICE PREVIEW: the per-voice play button samples the voice on-device via
// [VoicePreviewService]. The backend mints a short-lived token locked to that
// voice, so the preview needs no key here and the button is always available —
// if Gemini is not configured server-side, the error surfaces on preview.state.
//
// !!! QA: the preview PLAYBACK path cannot be runtime-tested here — it needs a
// physical device speaker. See VoicePreviewService's QA
// notes. The UI states (disabled / loading / playing / error + retry) below are
// what to verify on-device.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/net/backend_client.dart';

import 'package:talbotiq/core/services/voice_preview_service.dart';
import 'package:talbotiq/features/recruiter/voice/voice_catalog.dart';
import 'package:talbotiq/features/recruiter/voice/voice_models.dart';

/// A reusable persona + voice selector bound to a [VoiceConfig].
///
/// The widget keeps an internal working copy so selections feel immediate; every
/// change is pushed up through [onChanged]. The parent owns the source of truth
/// and should pass the updated value back down (standard controlled-widget flow).
class VoicePicker extends StatefulWidget {
  /// The current configuration to display/edit.
  final VoiceConfig value;

  /// Called with a new [VoiceConfig] whenever the recruiter changes a field.
  final ValueChanged<VoiceConfig> onChanged;

  /// Available voices (defaults to the on-device [VoiceCatalog]).
  final List<VoiceOption> voices;

  /// Available personas (defaults to the on-device [VoiceCatalog]).
  final List<InterviewPersona> personas;

  /// Whether to show the "allow barge-in" (candidate can interrupt) toggle.
  final bool showBargeIn;

  /// Optional extra notification when the recruiter taps a voice's preview
  /// button (fired alongside the on-device sample). The audio itself is played
  /// by the internal [VoicePreviewService]; this hook is purely a
  /// "user previewed voice X" signal for the host.
  final ValueChanged<VoiceOption>? onPreviewVoice;


  const VoicePicker({
    super.key,
    required this.value,
    required this.onChanged,
    this.voices = VoiceCatalog.voices,
    this.personas = VoiceCatalog.personas,
    this.showBargeIn = true,
    this.onPreviewVoice,
  });

  /// Present the picker in a modal bottom sheet.
  ///
  /// Returns the chosen [VoiceConfig] when the recruiter taps "Use voice", or
  /// null if the sheet is dismissed.
  static Future<VoiceConfig?> showBottomSheet(
    BuildContext context, {
    required VoiceConfig initial,
    List<VoiceOption> voices = VoiceCatalog.voices,
    List<InterviewPersona> personas = VoiceCatalog.personas,
    bool showBargeIn = true,
    ValueChanged<VoiceOption>? onPreviewVoice,
  }) {
    return showModalBottomSheet<VoiceConfig>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      builder: (ctx) => _VoicePickerSheet(
        initial: initial,
        voices: voices,
        personas: personas,
        showBargeIn: showBargeIn,
        onPreviewVoice: onPreviewVoice,
      ),
    );
  }

  @override
  State<VoicePicker> createState() => _VoicePickerState();
}

class _VoicePickerState extends State<VoicePicker> {
  late VoiceConfig _config = widget.value;

  // On-device voice sample player; disposed in [dispose] so no socket/player
  // ever outlives this widget.
  final VoicePreviewService _preview = VoicePreviewService();

  @override
  void dispose() {
    _preview.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant VoicePicker oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Stay in sync if the parent pushes a different value down.
    if (widget.value != oldWidget.value && widget.value != _config) {
      _config = widget.value;
    }
  }

  void _emit(VoiceConfig next) {
    setState(() => _config = next);
    widget.onChanged(next);
  }

  void _selectPersona(InterviewPersona persona) {
    // Adopt the persona and its default voice; the recruiter can then override
    // the voice independently (voiceId overrides the persona default).
    _emit(_config.copyWith(
      personaId: persona.id,
      voiceId: persona.defaultVoiceId,
    ));
  }

  void _selectVoice(VoiceOption voice) => _emit(_config.copyWith(voiceId: voice.id));

  void _toggleBargeIn(bool v) => _emit(_config.copyWith(allowBargeIn: v));

  @override
  Widget build(BuildContext context) {
    return _VoicePickerBody(
      config: _config,
      voices: widget.voices,
      personas: widget.personas,
      showBargeIn: widget.showBargeIn,
      onPreviewVoice: widget.onPreviewVoice,
      preview: _preview,
      onSelectPersona: _selectPersona,
      onSelectVoice: _selectVoice,
      onToggleBargeIn: _toggleBargeIn,
    );
  }
}

/// Bottom-sheet host: owns a scroll controller + draft config and returns the
/// result on confirm.
class _VoicePickerSheet extends StatefulWidget {
  final VoiceConfig initial;
  final List<VoiceOption> voices;
  final List<InterviewPersona> personas;
  final bool showBargeIn;
  final ValueChanged<VoiceOption>? onPreviewVoice;

  const _VoicePickerSheet({
    required this.initial,
    required this.voices,
    required this.personas,
    required this.showBargeIn,
    required this.onPreviewVoice,
  });

  @override
  State<_VoicePickerSheet> createState() => _VoicePickerSheetState();
}

class _VoicePickerSheetState extends State<_VoicePickerSheet> {
  final ScrollController _scrollController = ScrollController();
  late VoiceConfig _config = widget.initial;

  // On-device voice sample player; disposed with the sheet so a preview that is
  // still connecting/playing when the sheet closes is fully torn down.
  final VoicePreviewService _preview = VoicePreviewService();

  @override
  void dispose() {
    _preview.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _update(VoiceConfig next) => setState(() => _config = next);

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // Cap the sheet to a sensible fraction of the screen so it stays usable on
    // both phones and larger/landscape layouts.
    final maxHeight = MediaQuery.of(context).size.height * 0.9;

    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: maxHeight),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
            child: Row(
              children: [
                Icon(Icons.record_voice_over_outlined, color: scheme.primary),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Interviewer voice',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w600,
                          fontFamily: 'Inter',
                        ),
                  ),
                ),
              ],
            ),
          ),
          Flexible(
            child: SingleChildScrollView(
              controller: _scrollController,
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
              child: _VoicePickerBody(
                config: _config,
                voices: widget.voices,
                personas: widget.personas,
                showBargeIn: widget.showBargeIn,
                onPreviewVoice: widget.onPreviewVoice,
                preview: _preview,
                onSelectPersona: (p) => _update(_config.copyWith(
                  personaId: p.id,
                  voiceId: p.defaultVoiceId,
                )),
                onSelectVoice: (v) => _update(_config.copyWith(voiceId: v.id)),
                onToggleBargeIn: (v) =>
                    _update(_config.copyWith(allowBargeIn: v)),
              ),
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                      ),
                      child: const Text('Cancel'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      onPressed: () => Navigator.of(context).pop(_config),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                      ),
                      child: const Text('Use voice'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The stateless visual body shared by the embedded widget and the sheet.
class _VoicePickerBody extends StatelessWidget {
  final VoiceConfig config;
  final List<VoiceOption> voices;
  final List<InterviewPersona> personas;
  final bool showBargeIn;
  final ValueChanged<VoiceOption>? onPreviewVoice;
  final VoicePreviewService preview;
  final ValueChanged<InterviewPersona> onSelectPersona;
  final ValueChanged<VoiceOption> onSelectVoice;
  final ValueChanged<bool> onToggleBargeIn;

  const _VoicePickerBody({
    required this.config,
    required this.voices,
    required this.personas,
    required this.showBargeIn,
    required this.onPreviewVoice,
    required this.preview,
    required this.onSelectPersona,
    required this.onSelectVoice,
    required this.onToggleBargeIn,
  });

  @override
  Widget build(BuildContext context) {
    final selectedPersona = personas
        .cast<InterviewPersona?>()
        .firstWhere((p) => p?.id == config.personaId, orElse: () => null);
    final selectedVoice = voices
        .cast<VoiceOption?>()
        .firstWhere((v) => v?.id == config.voiceId, orElse: () => null);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        _SectionLabel('Persona'),
        const SizedBox(height: 8),
        if (personas.isEmpty)
          _EmptyHint('No personas available')
        else
          ...personas.map(
            (p) => _PersonaTile(
              persona: p,
              selected: p.id == config.personaId,
              onTap: () => onSelectPersona(p),
            ),
          ),
        const SizedBox(height: 20),
        _SectionLabel('Voice'),
        const SizedBox(height: 8),
        if (voices.isEmpty)
          _EmptyHint('No voices available')
        else
          _VoiceDropdown(
            voices: voices,
            selectedId: config.voiceId,
            onSelected: onSelectVoice,
          ),
        if (selectedVoice != null) ...[
          const SizedBox(height: 10),
          _VoiceSummary(
            voice: selectedVoice,
            isPersonaDefault: selectedPersona?.defaultVoiceId == selectedVoice.id,
            onPreview: onPreviewVoice,
            preview: preview,
          ),
        ],
        if (showBargeIn) ...[
          const SizedBox(height: 12),
          _BargeInToggle(
            value: config.allowBargeIn,
            onChanged: onToggleBargeIn,
          ),
        ],
      ],
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Text(
      text.toUpperCase(),
      style: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.6,
        color: scheme.onSurfaceVariant,
        fontFamily: 'Inter',
      ),
    );
  }
}

class _EmptyHint extends StatelessWidget {
  final String text;
  const _EmptyHint(this.text);

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Text(
      text,
      style: TextStyle(color: scheme.onSurfaceVariant, fontFamily: 'Inter'),
    );
  }
}

class _PersonaTile extends StatelessWidget {
  final InterviewPersona persona;
  final bool selected;
  final VoidCallback onTap;

  const _PersonaTile({
    required this.persona,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: selected
            ? scheme.primary.withValues(alpha: 0.10)
            : scheme.surfaceContainerHighest.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(20),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: selected
                    ? scheme.primary
                    : scheme.outline.withValues(alpha: 0.4),
                width: selected ? 1.5 : 1,
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  selected
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                  size: 20,
                  color: selected ? scheme.primary : scheme.onSurfaceVariant,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        persona.name,
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: scheme.onSurface,
                          fontFamily: 'Inter',
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        persona.description,
                        style: TextStyle(
                          fontSize: 13,
                          height: 1.3,
                          color: scheme.onSurfaceVariant,
                          fontFamily: 'Inter',
                        ),
                      ),
                    ],
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

class _VoiceDropdown extends StatelessWidget {
  final List<VoiceOption> voices;
  final String selectedId;
  final ValueChanged<VoiceOption> onSelected;

  const _VoiceDropdown({
    required this.voices,
    required this.selectedId,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // Guard against a selectedId that isn't in the list (avoids assertion).
    final value = voices.any((v) => v.id == selectedId) ? selectedId : null;

    return DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      borderRadius: BorderRadius.circular(20),
      decoration: InputDecoration(
        filled: true,
        fillColor: scheme.surfaceContainerHighest.withValues(alpha: 0.35),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(20),
          borderSide: BorderSide(color: scheme.outline.withValues(alpha: 0.4)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(20),
          borderSide: BorderSide(color: scheme.outline.withValues(alpha: 0.4)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(20),
          borderSide: BorderSide(color: scheme.primary, width: 1.5),
        ),
      ),
      items: [
        for (final v in voices)
          DropdownMenuItem<String>(
            value: v.id,
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    v.label,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 15,
                      color: scheme.onSurface,
                      fontFamily: 'Inter',
                    ),
                  ),
                ),
                if (v.gender != null)
                  Text(
                    v.gender!.label,
                    style: TextStyle(
                      fontSize: 12,
                      color: scheme.onSurfaceVariant,
                      fontFamily: 'Inter',
                    ),
                  ),
              ],
            ),
          ),
      ],
      onChanged: (id) {
        if (id == null) return;
        final v = voices.firstWhere((e) => e.id == id);
        onSelected(v);
      },
    );
  }
}

class _VoiceSummary extends StatelessWidget {
  final VoiceOption voice;
  final bool isPersonaDefault;

  /// Optional "user previewed voice X" notification (fired alongside audio).
  final ValueChanged<VoiceOption>? onPreview;

  /// Gemini key that enables on-device sampling; null/empty disables the button.

  /// The shared, host-owned sample player.
  final VoicePreviewService preview;

  const _VoiceSummary({
    required this.voice,
    required this.isPersonaDefault,
    required this.onPreview,
    required this.preview,
  });

  Future<void> _startPreview() async {
    onPreview?.call(voice); // notify host (analytics / "previewed X")
    // The backend mints a token locked to this voice and line; play() only
    // throws for a stale grant, and we connect immediately. Failures surface on
    // preview.state, so nothing is swallowed by the fire-and-forget call site.
    try {
      final grant = await backendClient.mintPreviewToken(voiceName: voice.id);
      await preview.play(grant: grant, voiceName: voice.id);
    } on BackendException catch (e) {
      preview.reportError(e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final descParts = <String>[
      if (voice.description != null && voice.description!.isNotEmpty)
        voice.description!,
      voice.language,
      if (voice.accent != null && voice.accent!.isNotEmpty) voice.accent!,
    ];

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.25),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: scheme.outline.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            voice.label,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: scheme.onSurface,
                              fontFamily: 'Inter',
                            ),
                          ),
                        ),
                        if (isPersonaDefault) ...[
                          const SizedBox(width: 8),
                          _Badge('Persona default'),
                        ],
                      ],
                    ),
                    if (descParts.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        descParts.join(' · '),
                        style: TextStyle(
                          fontSize: 13,
                          height: 1.3,
                          color: scheme.onSurfaceVariant,
                          fontFamily: 'Inter',
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              // The trailing control rebuilds off the shared preview state so it
              // shows a spinner while THIS voice is sampling, a stop toggle while
              // it plays, an error affordance on failure, and a plain play icon
              // otherwise (or a disabled affordance when there's no key).
              ValueListenableBuilder<VoicePreviewState>(
                valueListenable: preview.state,
                builder: (context, state, _) =>
                    _buildControl(context, scheme, state),
              ),
            ],
          ),
          // Inline error + retry, scoped to THIS voice.
          ValueListenableBuilder<VoicePreviewState>(
            valueListenable: preview.state,
            builder: (context, state, _) {
              final showError = state.status == VoicePreviewStatus.error &&
                  state.isFor(voice.id);
              if (!showError) return const SizedBox.shrink();
              return Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Icon(Icons.error_outline,
                        size: 16, color: scheme.error),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        state.error ?? 'Preview failed.',
                        style: TextStyle(
                          fontSize: 12,
                          height: 1.3,
                          color: scheme.error,
                          fontFamily: 'Inter',
                        ),
                      ),
                    ),
                    const SizedBox(width: 4),
                    TextButton(
                      onPressed: _startPreview,
                      style: TextButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                        padding:
                            const EdgeInsets.symmetric(horizontal: 8),
                        minimumSize: const Size(0, 32),
                      ),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildControl(
    BuildContext context,
    ColorScheme scheme,
    VoicePreviewState state,
  ) {
    // Always enabled: there is no client-side key to gate on. If Gemini is not
    // configured on the server, the mint fails and the error surfaces below.
    final isThisVoice = state.isFor(voice.id);

    // Loading THIS voice -> spinner (tap to cancel).
    if (isThisVoice && state.status == VoicePreviewStatus.loading) {
      return Tooltip(
        message: 'Preparing sample… tap to cancel',
        child: IconButton(
          onPressed: () => preview.stop(),
          visualDensity: VisualDensity.compact,
          icon: SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: scheme.primary,
            ),
          ),
        ),
      );
    }

    // Playing THIS voice -> stop toggle.
    if (isThisVoice && state.status == VoicePreviewStatus.playing) {
      return Tooltip(
        message: 'Stop sample',
        child: IconButton(
          onPressed: () => preview.stop(),
          icon: const Icon(Icons.stop_circle_outlined),
          color: scheme.primary,
          visualDensity: VisualDensity.compact,
        ),
      );
    }

    // Error THIS voice -> keep the play icon actionable (inline row shows retry).
    // Idle / busy for ANOTHER voice -> plain play (tapping supersedes the other).
    return Tooltip(
      message: 'Play a short sample',
      child: IconButton(
        onPressed: _startPreview,
        icon: const Icon(Icons.play_circle_outline),
        color: scheme.primary,
        visualDensity: VisualDensity.compact,
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String text;
  const _Badge(this.text);

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: scheme.primary.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(100),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: scheme.primary,
          fontFamily: 'Inter',
        ),
      ),
    );
  }
}

class _BargeInToggle extends StatelessWidget {
  final bool value;
  final ValueChanged<bool> onChanged;

  const _BargeInToggle({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Allow barge-in',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: scheme.onSurface,
                    fontFamily: 'Inter',
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Candidate can interrupt the interviewer while it speaks.',
                  style: TextStyle(
                    fontSize: 13,
                    height: 1.3,
                    color: scheme.onSurfaceVariant,
                    fontFamily: 'Inter',
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Switch(value: value, onChanged: onChanged),
        ],
      ),
    );
  }
}
