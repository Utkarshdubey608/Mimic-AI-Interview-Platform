// lib/shared/widgets/app_message_state.dart
//
// The four states a list can be in, named — matching the web client's
// `components/ui/feedback.tsx` so the two halves of the product behave the same way
// when there is nothing to show.
//
// [AppMessageState] is the original: an icon, a title, a subtitle. It stays, because
// sixteen call sites use it and it is exactly right for a plain message.
//
// What it could not express is the distinction that matters:
//
//   AppEmptyState    nothing here YET — and what to do about it
//   AppNoResults     a filter matched nothing, which is not the same as empty, and
//                    the fix is to clear the filter rather than to create something
//   AppErrorState    the load FAILED — with a retry, because the data is fine and
//                    the screen is not
//   AppSkeleton      loading, shaped like the content
//
// Collapsing error into "empty" is the one that actually costs something: a recruiter
// told "no candidates" by a failed request goes looking for deleted data. Web named
// these four; mobile had one message widget and a bare spinner.

import 'package:flutter/material.dart';

class AppMessageState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  const AppMessageState({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(height: 12),
            Text(title, style: theme.textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(subtitle,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ],
        ),
      ),
    );
  }
}


/// Nothing here YET, with the action that changes that.
///
/// Distinct from [AppNoResults]: an empty collection wants a way to create the first
/// thing, while a filter that matched nothing wants the filter cleared. Offering
/// "create" to somebody who has fifty records behind a search box is noise.
class AppEmptyState extends StatelessWidget {
  const AppEmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.description,
    this.action,
  });

  final IconData icon;
  final String title;
  final String description;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(height: 14),
            Text(title, style: theme.textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(
              description,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            if (action != null) ...[const SizedBox(height: 18), action!],
          ],
        ),
      ),
    );
  }
}

/// A search or filter matched nothing.
///
/// Names the query back, because "no results" without it leaves somebody unsure
/// whether they mistyped or the thing genuinely is not there.
class AppNoResults extends StatelessWidget {
  const AppNoResults({super.key, this.query, this.onClear});

  final String? query;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final typed = (query ?? '').trim();
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.search_off_outlined,
                size: 44, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(height: 14),
            Text(
              typed.isEmpty ? 'Nothing matches' : 'Nothing matches “$typed”',
              style: theme.textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            if (onClear != null) ...[
              const SizedBox(height: 14),
              // The fix is clearing the filter, not creating something new.
              TextButton(onPressed: onClear, child: const Text('Clear the search')),
            ],
          ],
        ),
      ),
    );
  }
}

/// The load FAILED — and the data is fine.
///
/// **Never render this as an empty state.** A recruiter told "no candidates" by a
/// failed request goes looking for deleted data, and the true cause (a 503, an expired
/// sign-in) is invisible. Name the failure, say the data is safe, and offer the retry —
/// which is the whole reason this is not [AppMessageState] with a different icon.
class AppErrorState extends StatelessWidget {
  const AppErrorState({
    super.key,
    required this.title,
    required this.detail,
    this.onRetry,
  });

  final String title;

  /// What actually went wrong. Prefer the server's own message: it is the truest
  /// thing available, and "check your connection" over a 503 that said precisely what
  /// was misconfigured sends people debugging the wrong thing.
  final String detail;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline,
                size: 44, color: theme.colorScheme.error),
            const SizedBox(height: 14),
            Text(title, style: theme.textTheme.titleMedium, textAlign: TextAlign.center),
            const SizedBox(height: 6),
            Text(
              detail,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 18),
              FilledButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh, size: 18),
                label: const Text('Try again'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A placeholder shaped like the content that is coming.
///
/// Preferred over a centred spinner for a LIST: it shows how much is arriving and
/// where, so the page does not jump when it lands. A spinner is right for a single
/// action, not for a page of rows.
class AppSkeleton extends StatefulWidget {
  const AppSkeleton({
    super.key,
    this.height = 14,
    this.width,
    this.borderRadius = 8,
  });

  final double height;
  final double? width;
  final double borderRadius;

  @override
  State<AppSkeleton> createState() => _AppSkeletonState();
}

class _AppSkeletonState extends State<AppSkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.onSurfaceVariant;
    return FadeTransition(
      // A slow pulse rather than a sweep: a moving highlight across a list of rows
      // reads as several things loading at different rates.
      opacity: Tween<double>(begin: 0.10, end: 0.22).animate(
        CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
      ),
      child: Container(
        height: widget.height,
        width: widget.width,
        decoration: BoxDecoration(
          color: base,
          borderRadius: BorderRadius.circular(widget.borderRadius),
        ),
      ),
    );
  }
}

/// A few [AppSkeleton] rows, for a list that is loading.
class AppSkeletonList extends StatelessWidget {
  const AppSkeletonList({super.key, this.rows = 3});

  final int rows;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < rows; i++)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: const [
                AppSkeleton(height: 15, width: 200),
                SizedBox(height: 8),
                AppSkeleton(height: 12, width: 130),
              ],
            ),
          ),
      ],
    );
  }
}
