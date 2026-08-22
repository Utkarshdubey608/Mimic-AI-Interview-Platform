// lib/features/recruiter/views/management/recruiter_library_page.dart
//
// Recruiter management hub. A single additive entry point (opened from the
// recruiter dashboard app bar) that links to the reusable-config management
// screens. Purely navigational — no interview-execution code is touched.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/utils/desktop_platform.dart';
import 'package:talbotiq/shared/widgets/desktop_card.dart';
import 'package:talbotiq/shared/widgets/desktop_page_container.dart';
import 'package:talbotiq/shared/widgets/responsive_grid.dart';
import 'package:talbotiq/shared/widgets/section_header.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';
import 'generate_from_resume_page.dart';
import 'personas_page.dart';
import 'mcq_sets_page.dart';
import 'question_sets_page.dart';
import 'replicas_page.dart';
import 'templates_page.dart';

class _LibrarySection {
  final IconData icon;
  final String title;
  final String subtitle;
  final WidgetBuilder pageBuilder;
  const _LibrarySection({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.pageBuilder,
  });
}

const _sections = [
  _LibrarySection(
    icon: Icons.dashboard_customize_outlined,
    title: 'Templates',
    subtitle: 'Reusable interview configurations and scoring rubrics.',
    pageBuilder: _templatesPage,
  ),
  _LibrarySection(
    icon: Icons.list_alt_outlined,
    title: 'Question sets',
    subtitle: 'Reusable fixed questions with categories and ideal-answer notes.',
    pageBuilder: _questionSetsPage,
  ),
  _LibrarySection(
    icon: Icons.fact_check_outlined,
    title: 'Assessments',
    subtitle:
        'Multiple-choice papers. Scored exactly, with no model in the loop.',
    pageBuilder: _mcqSetsPage,
  ),
  _LibrarySection(
    icon: Icons.auto_awesome_outlined,
    title: 'Generate from résumé',
    subtitle: 'Upload a candidate PDF and generate a tailored question set.',
    pageBuilder: _generateFromResumePage,
  ),
  _LibrarySection(
    icon: Icons.face_retouching_natural_outlined,
    title: 'Personas',
    subtitle: 'Interviewer personalities on your Tavus account.',
    pageBuilder: _personasPage,
  ),
  _LibrarySection(
    icon: Icons.smart_display_outlined,
    title: 'Replicas',
    subtitle: 'Avatars available on your Tavus account.',
    pageBuilder: _replicasPage,
  ),
];

Widget _templatesPage(BuildContext _) => const TemplatesPage();
Widget _questionSetsPage(BuildContext _) => const QuestionSetsPage();
Widget _mcqSetsPage(BuildContext _) => const McqSetsPage();
Widget _generateFromResumePage(BuildContext _) => const GenerateFromResumePage();
Widget _personasPage(BuildContext _) => const PersonasPage();
Widget _replicasPage(BuildContext _) => const ReplicasPage();

class RecruiterLibraryPage extends StatelessWidget {
  const RecruiterLibraryPage({super.key});

  void _open(BuildContext context, _LibrarySection s) {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: s.pageBuilder));
  }

  @override
  Widget build(BuildContext context) {
    if (isDesktopPlatform) return _buildDesktop(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Manage')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
          children: [
            const RecruiterPageHeader(
              kicker: 'Recruiter',
              title: 'Management',
              subtitle:
                  'Reusable configuration for how roles are interviewed and '
                  'scored.',
            ),
            const SizedBox(height: 20),
            for (final s in _sections)
              _HubTile(
                icon: s.icon,
                title: s.title,
                subtitle: s.subtitle,
                onTap: () => _open(context, s),
              ),
          ],
        ),
      ),
    );
  }

  /// The same destinations as mobile, same navigation targets — just a
  /// compact grid instead of tall full-width rows, since a desktop window
  /// has the horizontal room for it and drilling through a single-column
  /// list is a phone-navigation pattern.
  Widget _buildDesktop(BuildContext context) {
    return DesktopPageContainer(
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SectionHeader(
              title: 'Library',
              subtitle: 'Reusable configuration for how roles are interviewed and scored.',
              isPageTitle: true,
            ),
            const SizedBox(height: 24),
            ResponsiveGrid(
              tileMinWidth: 260,
              maxPerRow: 3,
              children: [
                for (final s in _sections)
                  _LibraryGridTile(section: s, onTap: () => _open(context, s)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _LibraryGridTile extends StatelessWidget {
  final _LibrarySection section;
  final VoidCallback onTap;
  const _LibraryGridTile({required this.section, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: DesktopCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: theme.colorScheme.primary.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(section.icon, color: theme.colorScheme.primary, size: 20),
            ),
            const SizedBox(height: 14),
            Text(section.title,
                style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Text(
              section.subtitle,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

class _HubTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _HubTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: RecruiterPanel(
        onTap: onTap,
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: theme.colorScheme.primary.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: theme.colorScheme.primary),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: theme.textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 4),
                  Text(subtitle,
                      style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant)),
                ],
              ),
            ),
            Icon(Icons.chevron_right, color: theme.colorScheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }
}
