// lib/features/recruiter/views/management/recruiter_library_page.dart
//
// Recruiter management hub. A single additive entry point (opened from the
// recruiter dashboard app bar) that links to the reusable-config management
// screens. Purely navigational — no interview-execution code is touched.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/theme/design_tokens.dart';
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

  /// The pastel tinting this row's icon chip. One per section, so the list is
  /// scannable by colour without any row becoming a coloured block.
  final Color tint;

  const _LibrarySection({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.pageBuilder,
    required this.tint,
  });
}

const _sections = [
  _LibrarySection(
    icon: Icons.dashboard_customize_outlined,
    title: 'Templates',
    subtitle: 'Reusable interview configurations and scoring rubrics.',
    pageBuilder: _templatesPage,
    tint: AppColors.pastelCyanText,
  ),
  _LibrarySection(
    icon: Icons.list_alt_outlined,
    title: 'Question sets',
    subtitle: 'Reusable fixed questions with categories and ideal-answer notes.',
    pageBuilder: _questionSetsPage,
    tint: AppColors.pastelLavenderText,
  ),
  _LibrarySection(
    icon: Icons.fact_check_outlined,
    title: 'Assessments',
    subtitle:
        'Multiple-choice papers. Scored exactly, with no model in the loop.',
    pageBuilder: _mcqSetsPage,
    tint: AppColors.pastelMintText,
  ),
  _LibrarySection(
    icon: Icons.auto_awesome_outlined,
    title: 'Generate from résumé',
    subtitle: 'Upload a candidate PDF and generate a tailored question set.',
    pageBuilder: _generateFromResumePage,
    tint: AppColors.blockPeach,
  ),
  _LibrarySection(
    icon: Icons.face_retouching_natural_outlined,
    title: 'Personas',
    subtitle: 'Interviewer personalities on your Tavus account.',
    pageBuilder: _personasPage,
    tint: AppColors.pastelPeach,
  ),
  _LibrarySection(
    icon: Icons.smart_display_outlined,
    title: 'Replicas',
    subtitle: 'Avatars available on your Tavus account.',
    pageBuilder: _replicasPage,
    tint: AppColors.pastelCyanText,
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
    return RecruiterScaffold(
      appBar: AppBar(title: const Text('Library')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
          children: [
            const RecruiterPageHeader(
              kicker: 'Recruiter',
              title: 'Library',
              subtitle:
                  'Reusable configuration for how roles are interviewed and '
                  'scored.',
            ),
            const SizedBox(height: 20),
            // Thin-separated rows inside one panel — the reference's folder
            // list — rather than a card per destination.
            RecruiterPanel(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
              child: Column(
                children: [
                  for (var k = 0; k < _sections.length; k++) ...[
                    if (k > 0) const RecruiterRowSeparator(),
                    RecruiterListRow(
                      icon: _sections[k].icon,
                      iconColor: _sections[k].tint,
                      title: _sections[k].title,
                      subtitle: _sections[k].subtitle,
                      onTap: () => _open(context, _sections[k]),
                    ),
                  ],
                ],
              ),
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
      borderRadius: BorderRadius.circular(20),
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

