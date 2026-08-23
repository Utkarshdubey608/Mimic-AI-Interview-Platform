// lib/features/recruiter/views/management/replicas_page.dart
//
// Recruiter-side: view the Tavus replicas (avatars) available on the configured
// account, grouped into custom vs stock, with status and training progress.
// READ-ONLY management surface over the EXISTING, unmodified
// the shared `AvatarCatalog` (cached 10h; Refresh forces a refetch). It does
// not touch any
// interview code.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:flutter/services.dart';

import 'package:talbotiq/core/services/avatar_catalog.dart';
import 'package:talbotiq/shared/models/app_models.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';

class ReplicasPage extends StatefulWidget {
  const ReplicasPage({super.key});

  @override
  State<ReplicasPage> createState() => _ReplicasPageState();
}

class _ReplicasPageState extends State<ReplicasPage> {
  bool _loading = true;
  String? _error;
  List<TavusReplica> _replicas = [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  /// Cached read. The catalog only hits Tavus when its 10-hour window has
  /// elapsed, so re-opening this page costs nothing.
  Future<void> _load() async => _run(() => _catalog.ensureLoaded());

  /// Explicit user action — always refetches.
  Future<void> _refresh() async => _run(() => _catalog.refresh());

  AvatarCatalog get _catalog => context.read<AvatarCatalog>();

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    await action();
    if (!mounted) return;
    setState(() {
      _loading = false;
      _replicas = _catalog.replicas;
      // The catalog keeps serving cached data on a failed fetch, so only report
      // an error when there is genuinely nothing to show.
      _error = _replicas.isEmpty ? _catalog.error : null;
    });
  }

  bool _isStock(TavusReplica r) =>
      (r.replicaType ?? '').toLowerCase().contains('system') ||
      (r.replicaType ?? '').toLowerCase() == 'stock';

  @override
  Widget build(BuildContext context) {
    return RecruiterScaffold(
      appBar: AppBar(
        title: const Text('Replicas'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh),
            onPressed: _loading ? null : _refresh,
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: SafeArea(child: _body()),
    );
  }

  Widget _body() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return RecruiterEmptyState(
        icon: Icons.key_off_outlined,
        title: 'Unavailable',
        description: _error!,
        action: FilledButton(onPressed: _load, child: const Text('Retry')),
      );
    }
    if (_replicas.isEmpty) {
      return const RecruiterEmptyState(
        icon: Icons.smart_display_outlined,
        title: 'No replicas',
        description:
            'This Tavus account has no replicas yet. Create one in the Tavus '
            'dashboard, then refresh.',
      );
    }
    final custom = _replicas.where((r) => !_isStock(r)).toList();
    final stock = _replicas.where(_isStock).toList();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
        children: [
          const RecruiterPageHeader(
            kicker: 'Avatar',
            title: 'Replicas',
            subtitle: 'Avatars available on your Tavus account.',
          ),
          const SizedBox(height: 20),
          if (custom.isNotEmpty) ...[
            const RecruiterSectionTitle('Custom'),
            const SizedBox(height: 12),
            for (final r in custom) _ReplicaTile(replica: r),
          ],
          if (stock.isNotEmpty) ...[
            const SizedBox(height: 12),
            const RecruiterSectionTitle('Stock'),
            const SizedBox(height: 12),
            for (final r in stock) _ReplicaTile(replica: r),
          ],
        ],
      ),
    );
  }
}

class _ReplicaTile extends StatelessWidget {
  final TavusReplica replica;
  const _ReplicaTile({required this.replica});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final r = replica;
    final ready = r.status.toLowerCase() == 'ready' ||
        r.status.toLowerCase() == 'completed';
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: RecruiterPanel(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              backgroundColor: theme.colorScheme.primaryContainer,
              child: Text(
                r.replicaName.isNotEmpty ? r.replicaName[0].toUpperCase() : '?',
                style:
                    TextStyle(color: theme.colorScheme.onPrimaryContainer),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    r.replicaName.isEmpty ? '(unnamed)' : r.replicaName,
                    style: theme.textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      RecruiterBadge(
                        text: r.status,
                        color: ready
                            ? theme.colorScheme.primary
                            : warningColor(context),
                      ),
                      if (r.trainingProgress != null &&
                          r.trainingProgress! < 100) ...[
                        const SizedBox(width: 8),
                        Text('${r.trainingProgress!.round()}%',
                            style: theme.textTheme.bodySmall),
                      ],
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          r.replicaId,
                          style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      IconButton(
                        tooltip: 'Copy replica ID',
                        visualDensity: VisualDensity.compact,
                        icon: const Icon(Icons.copy, size: 16),
                        onPressed: () {
                          Clipboard.setData(ClipboardData(text: r.replicaId));
                          ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Copied.')));
                        },
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
