// lib/views/settings_page.dart
import 'package:flutter/material.dart';
import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/utils/desktop_platform.dart';
import 'package:talbotiq/shared/widgets/apple_ui.dart';
import 'package:talbotiq/shared/widgets/desktop_page_container.dart';
import 'package:talbotiq/shared/widgets/section_header.dart';
import 'package:talbotiq/features/auth/app_role.dart';
import 'package:talbotiq/features/guide/mimic_guide_page.dart';
import 'package:talbotiq/features/settings/sections/appearance_section.dart';
import 'package:talbotiq/features/settings/sections/my_recordings_section.dart';
import 'package:talbotiq/features/settings/sections/preferences_section.dart';
import 'package:talbotiq/features/settings/sections/service_status_section.dart';
import 'package:talbotiq/core/theme/status_tones.dart';

/// Settings shell: an Apple-style large title, a category navigator (sidebar rail
/// on wide screens, scrollable pills on narrow) and the active category section.
///
/// Deliberately small, and DIFFERENT PER ROLE. Nothing here configures the
/// platform: every credential and every piece of org infrastructure (vendor API
/// keys, the S3 recording destination, mail delivery, Tavus session properties)
/// lives in the backend environment. What is left is what genuinely belongs to
/// the person holding the device.
///
///   candidate — how the app looks, and the interview audio kept on their phone
///   recruiter — how the app looks, and whether the server's AI features are up
///
/// Before adding a category, ask whether a user could get it wrong in a way that
/// breaks an interview. If so it belongs on the server.
class SettingsPage extends StatefulWidget {
  /// Which account type is viewing Settings.
  final AppRole role;

  const SettingsPage({super.key, required this.role});

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  int _category = 0;

  bool get _isRecruiter => widget.role == AppRole.recruiter;

  // Categories, paired with their section widget so the two lists can never
  // drift out of index alignment.
  late final List<_Category> _items = _isRecruiter
      ? [
          const _Category('Appearance', Icons.palette_outlined, AppColors.blockPeach,
              AppearanceSection()),
          // Font Size only has an effect on desktop (see main.dart's
          // MediaQuery.textScaler wiring) — hidden on recruiter mobile/web
          // rather than showing a control that would silently do nothing.
          if (isDesktopPlatform)
            const _Category('Preferences', Icons.tune_outlined, AppColors.pastelLavenderText,
                PreferencesSection()),
          const _Category('Service Status', Icons.dns_outlined, AppColors.pastelCyanText,
              ServiceStatusSection()),
        ]
      : const [
          _Category('Appearance', Icons.palette_outlined, AppColors.blockPeach,
              AppearanceSection()),
          _Category('My Recordings', Icons.mic_none_outlined, AppColors.danger,
              MyRecordingsSection()),
        ];

  List<_Category> get _categories => _items;

  // Kept alive so state survives switching category.
  List<Widget> get _sections =>
      _items.map((c) => c.section).toList(growable: false);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (isDesktopPlatform) return _buildDesktop(theme);
    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      body: LayoutBuilder(
        builder: (context, constraints) {
          final bool isWide = constraints.maxWidth > 840;
          return SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 32, 24, 40),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 920),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AppleLargeTitle(
                      eyebrow: 'Platform Config',
                      title: 'Settings',
                      subtitle: isWide
                          ? 'Manage platform behaviour by category.'
                          : null,
                    ),
                    const SizedBox(height: 24),
                    if (isWide) _buildWide(theme) else _buildNarrow(theme),
                    const SizedBox(height: 24),
                    _buildGuideEntry(theme),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  /// Desktop is already hosted inside RecruiterShell's own Scaffold, under
  /// the persistent top nav — this used to wrap itself in a second Scaffold
  /// with `colorScheme.surface` as its background, which is a visibly
  /// different (lighter) shade than the shell's own `scaffoldBackgroundColor`,
  /// producing a color seam right under the top nav. Rendering the content
  /// directly (no nested Scaffold) lets it inherit the same background as
  /// Home/Library/Analytics, and swapping the centered Apple-style large
  /// title for the same [SectionHeader] those pages use keeps the header
  /// treatment consistent instead of looking like a different app screen.
  Widget _buildDesktop(ThemeData theme) {
    return DesktopPageContainer(
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SectionHeader(
              title: 'Settings',
              subtitle: 'Manage platform behaviour by category.',
              isPageTitle: true,
            ),
            const SizedBox(height: 24),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 920),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildWide(theme),
                  const SizedBox(height: 24),
                  _buildGuideEntry(theme),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // Wide layout: fixed sidebar rail + the active section.
  Widget _buildWide(ThemeData theme) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(width: 232, child: _buildRail(theme)),
        const SizedBox(width: 28),
        Expanded(
          child: IndexedStack(index: _category, children: _sections),
        ),
      ],
    );
  }

  // Narrow layout: horizontal category pills stacked above the active section.
  Widget _buildNarrow(ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          height: 40,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: _categories.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (_, i) => _buildPill(theme, i),
          ),
        ),
        const SizedBox(height: 24),
        IndexedStack(index: _category, children: _sections),
      ],
    );
  }


  // Single entry point into the Mimic Guide help assistant.
  Widget _buildGuideEntry(ThemeData theme) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: theme.colorScheme.outline),
      ),
      child: ListTile(
        leading: AppleIconBadge(
          icon: Icons.support_agent,
          color: StatusTone.ready(context),
          size: 32,
        ),
        title: Text(
          'Help & Guide',
          style: theme.textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.w700,
            color: theme.colorScheme.onSurface,
          ),
        ),
        subtitle: Text(
          'Ask the Mimic Guide how to use templates, sessions, scoring and reports.',
          style: theme.textTheme.bodySmall
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        trailing: Icon(Icons.chevron_right,
            size: 20, color: theme.colorScheme.onSurfaceVariant),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const MimicGuidePage()),
        ),
      ),
    );
  }

  // Sidebar rail: a grouped list of selectable category rows (macOS style).
  Widget _buildRail(ThemeData theme) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: theme.colorScheme.outline),
      ),
      child: Column(
        children: [
          for (int i = 0; i < _categories.length; i++)
            _buildRailRow(theme, i),
        ],
      ),
    );
  }

  Widget _buildRailRow(ThemeData theme, int i) {
    final meta = _categories[i];
    final selected = i == _category;
    return InkWell(
      onTap: () => setState(() => _category = i),
      child: Container(
        color: selected ? theme.colorScheme.primary.withValues(alpha: 0.10) : null,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
        child: Row(
          children: [
            AppleIconBadge(icon: meta.icon, color: meta.color, size: 28),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                meta.label,
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  color: selected
                      ? theme.colorScheme.primary
                      : theme.colorScheme.onSurface,
                ),
              ),
            ),
            if (selected)
              Icon(Icons.chevron_right,
                  size: 18, color: theme.colorScheme.primary.withValues(alpha: 0.7)),
          ],
        ),
      ),
    );
  }

  // A single category pill for the narrow layout.
  Widget _buildPill(ThemeData theme, int i) {
    final meta = _categories[i];
    final selected = i == _category;
    return GestureDetector(
      onTap: () => setState(() => _category = i),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(horizontal: 16),
        decoration: BoxDecoration(
          color: selected
              ? theme.colorScheme.primary
              : theme.colorScheme.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: selected
                ? theme.colorScheme.primary
                : theme.colorScheme.outline.withValues(alpha: 0.6),
          ),
        ),
        child: Row(
          children: [
            Icon(meta.icon,
                size: 16,
                color: selected
                    ? theme.colorScheme.onPrimary
                    : theme.colorScheme.onSurfaceVariant),
            const SizedBox(width: 8),
            Text(
              meta.label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: selected
                    ? theme.colorScheme.onPrimary
                    : theme.colorScheme.onSurface,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One settings category: its label, icon, accent colour, and the widget it
/// shows. Bundling the section with its metadata is what stops the label list
/// and the widget list from drifting out of alignment.
class _Category {
  final String label;
  final IconData icon;
  final Color color;
  final Widget section;
  const _Category(this.label, this.icon, this.color, this.section);
}
