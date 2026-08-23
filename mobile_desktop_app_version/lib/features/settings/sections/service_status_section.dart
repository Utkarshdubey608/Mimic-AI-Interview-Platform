// lib/features/settings/sections/service_status_section.dart
//
// Settings category (recruiter): which AI features are actually available.
//
// Read-only on purpose. Every credential lives in the backend environment, so a
// recruiter can neither configure nor test one from here — but they DO need the
// answer to "is it me, or is this just not set up?" when a feature misbehaves.
// This reads `GET /health`, which is the server's own view, so it cannot be
// wrong in the way a client-side key check used to be.
//
// A failing row says "contact your administrator". It must never suggest adding
// a key: there is nowhere in the app to add one, and telling a recruiter
// otherwise sends them looking for a screen that does not exist.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/net/backend_client.dart';
import 'package:talbotiq/core/net/backend_config.dart';
import 'package:talbotiq/shared/widgets/apple_ui.dart';
import 'package:talbotiq/shared/widgets/custom_buttons.dart';

/// One capability, named the way a recruiter thinks about it rather than by
/// vendor. `key` matches the field in /health's `providers` map.
class _Capability {
  const _Capability(this.key, this.label, this.detail);
  final String key;
  final String label;
  final String detail;
}

const List<_Capability> _capabilities = [
  _Capability('tavus', 'Video interviews', 'AI avatar interviews with candidates'),
  _Capability('gemini', 'Scoring & questions',
      'Scorecards, question generation and résumé analysis'),
  _Capability('deepgram', 'Transcription', 'Written transcript of spoken answers'),
  _Capability('email', 'Candidate emails', 'Sending interview invitations'),
];

class ServiceStatusSection extends StatefulWidget {
  const ServiceStatusSection({super.key});

  @override
  State<ServiceStatusSection> createState() => _ServiceStatusSectionState();
}

class _ServiceStatusSectionState extends State<ServiceStatusSection> {
  Map<String, bool>? _status;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    // providerReadiness never throws — an empty map means the backend could not
    // be reached, which is itself the answer worth showing.
    final status = await backendClient.providerReadiness();
    if (!mounted) return;
    setState(() {
      _status = status;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = _status;
    final unreachable = !_loading && (status == null || status.isEmpty);

    return AppleSectionCard(
      title: 'Service status',
      subtitle: 'Configured by your administrator on the server.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            )
          else if (unreachable)
            _unreachable(theme)
          else
            ..._capabilities.map((c) => _row(theme, c, status![c.key] == true)),

          if (!_loading && !unreachable) ...[
            const SizedBox(height: 12),
            Text(
              'Something missing? Contact your administrator — these are set up '
              'on the server, not in the app.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
          const SizedBox(height: 16),
          Align(
            alignment: Alignment.centerLeft,
            child: CustomButton(
              text: 'Refresh',
              variant: ButtonVariant.outline,
              height: 40,
              isLoading: _loading,
              onPressed: _loading ? () {} : _load,
            ),
          ),
        ],
      ),
    );
  }

  Widget _row(ThemeData theme, _Capability capability, bool ok) {
    final colour = ok ? theme.colorScheme.primary : theme.colorScheme.error;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            ok ? Icons.check_circle_outline : Icons.error_outline,
            size: 20,
            color: colour,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  capability.label,
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 2),
                Text(
                  ok
                      ? capability.detail
                      : 'Not set up — contact your administrator.',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _unreachable(ThemeData theme) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.cloud_off_outlined, size: 20, color: theme.colorScheme.error),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Cannot reach the Mimic server',
                style: theme.textTheme.bodyMedium
                    ?.copyWith(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 2),
              Text(
                BackendConfig.isConfigured
                    ? 'Check your connection, then refresh. If it persists, '
                        'contact your administrator.'
                    : BackendConfig.configHint ?? '',
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
