// lib/features/interviews/recruiter/widgets/add_candidates_sheet.dart
//
// "Who joins this round?" — the pick-list behind every add-candidates action.
//
// It replaces an all-or-nothing confirm dialog ("add the 40 people in this
// pipeline to round 2?"). Two things were wrong with that. A recruiter who
// wants to bring ONE late applicant into round 2 had no way to say so, and a
// recruiter who wanted everyone had to read a number and trust it, with no idea
// who was already in.
//
// Deliberately dumb: given the pipeline's people and who is already in the
// round, it returns the ticked emails and nothing else. No repository, no
// writes, no navigation — so the picking rules are testable without Firestore,
// and the caller stays the one place that decides what "add" means.
//
// Anyone already in the round is listed, ticked-looking but locked. Hiding them
// would leave "12 candidates" reading as 12 additions when it is really 3, and
// the skip is what makes adding safe to press twice: an existing assignment is
// never reset, so their answers and score survive.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/theme/design_tokens.dart';
import 'package:talbotiq/core/theme/status_tones.dart';
import 'package:talbotiq/core/utils/validators.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/models/test_summary.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';

/// One row of the picker: a candidate of the pipeline.
class CandidatePick {
  /// Lower-cased email — the identity everything here keys on.
  final String email;
  final String? name;

  /// Already assigned to this round. Locked, and never returned.
  final bool alreadyIn;

  /// Typed in here rather than read from the pipeline — somebody who applied
  /// late. Flagged so the row can say so: adding a stranger to round 3 is a
  /// different act from ticking somebody who has been through rounds 1 and 2.
  final bool isNew;

  const CandidatePick({
    required this.email,
    this.name,
    this.alreadyIn = false,
    this.isNew = false,
  });

  String get display => (name != null && name!.trim().isNotEmpty)
      ? name!.trim()
      : email;
}

/// Turns a test's candidate map into picker rows, already-in first-class.
///
/// Sorted by name so the list is scannable, with the locked rows last: the
/// recruiter is here to add somebody, and the people they cannot add should not
/// be what they scroll past first.
List<CandidatePick> buildCandidatePicks({
  required Map<String, String?> candidates,
  required Set<String> alreadyIn,
}) {
  final picks = [
    for (final e in candidates.entries)
      CandidatePick(
        email: e.key,
        name: e.value,
        alreadyIn: alreadyIn.contains(e.key),
      ),
  ];
  picks.sort((a, b) {
    if (a.alreadyIn != b.alreadyIn) return a.alreadyIn ? 1 : -1;
    return a.display.toLowerCase().compareTo(b.display.toLowerCase());
  });
  return picks;
}

/// Splits a pasted blob into lower-cased emails, keeping only valid ones.
///
/// Comma, semicolon, whitespace and newline all separate, because a recruiter
/// pastes from a spreadsheet column, from a mail client's To: field, or types
/// one address — and being told "invalid" for using the wrong separator is the
/// kind of friction that sends them back to the old flow.
///
/// Returns the valid emails in [ParsedEmails.valid] and everything it could not
/// read in [ParsedEmails.rejected], so the caller can say what was dropped
/// instead of silently losing a typo'd address.
ParsedEmails parseCandidateEmails(String raw) {
  final parts = raw
      .split(RegExp(r'[,;\s]+'))
      .map((e) => e.trim().toLowerCase())
      .where((e) => e.isNotEmpty);

  final valid = <String>{};
  final rejected = <String>{};
  for (final p in parts) {
    if (Validators.isValidEmail(p)) {
      valid.add(p);
    } else {
      rejected.add(p);
    }
  }
  return ParsedEmails(valid: valid, rejected: rejected);
}

class ParsedEmails {
  final Set<String> valid;
  final Set<String> rejected;
  const ParsedEmails({required this.valid, required this.rejected});
}

/// Rows matching [query] on either name or email. An empty query matches all.
List<CandidatePick> filterCandidatePicks(
    List<CandidatePick> picks, String query) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return picks;
  return picks
      .where((p) =>
          p.email.contains(q) || (p.name ?? '').toLowerCase().contains(q))
      .toList();
}

/// The whole add-candidates job, in one place: read who is in the pipeline and
/// who is already in [round], let the recruiter pick (or type) whoever they
/// want, and write the assignments.
///
/// Returns how many assignments were CREATED — 0 when everybody picked was
/// already in — or null when the recruiter dismissed the picker. One function
/// because there are three ways into this (the timeline's round menu, a round's
/// candidate list, and the pipeline's candidate list) and three copies of it
/// would drift on the first change to what "add" means.
Future<int?> addCandidatesToRound(
  BuildContext context, {
  required InterviewRepository repo,
  required TestSummary test,
  required InterviewRound round,
  required String recruiterId,
  required String recruiterEmail,
  String? recruiterName,
}) async {
  final results = await Future.wait([
    repo.fetchTestCandidates(testId: test.testId, recruiterId: recruiterId),
    repo.fetchRoundCandidateEmails(
      recruiterId: recruiterId,
      testId: test.testId,
      roundId: round.id,
    ),
  ]);
  if (!context.mounted) return null;

  final candidates = results[0] as Map<String, String?>;
  final alreadyIn = results[1] as Set<String>;

  final picked = await AddCandidatesSheet.show(
    context,
    round: round,
    picks: buildCandidatePicks(candidates: candidates, alreadyIn: alreadyIn),
  );
  if (picked == null || picked.isEmpty) return null;

  return repo.assignCandidatesToRound(
    round: round,
    recruiterEmail: recruiterEmail,
    recruiterName: recruiterName,
    testTitle: test.title,
    // A name only for those the pipeline already knew — a freshly typed email
    // has none, and inventing one from the address would put a guess in the
    // candidate's own invitation.
    candidates: {for (final e in picked) e: candidates[e]},
  );
}

/// Which round are we adding to? Asked only when there is a real choice.
///
/// The pipeline-wide candidate list has no round of its own, and "add
/// candidates" there has to land somewhere specific — silently choosing the
/// open one would put people into a round the recruiter never named.
Future<InterviewRound?> pickRoundForCandidates(
  BuildContext context, {
  required List<InterviewRound> rounds,
  required DateTime now,
}) {
  return showModalBottomSheet<InterviewRound>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) {
      final theme = Theme.of(sheetContext);
      return SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.xl, 0, AppSpacing.xl, AppSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Add candidates to which round?',
                  style: theme.textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: AppSpacing.md),
              Flexible(
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: rounds.length,
                  itemBuilder: (context, i) {
                    final r = rounds[i];
                    final state = r.stateAt(now);
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text('${i + 1}. ${r.title}',
                          maxLines: 1, overflow: TextOverflow.ellipsis),
                      subtitle: Text(state.label),
                      trailing: const Icon(Icons.chevron_right, size: 18),
                      onTap: () => Navigator.of(sheetContext).pop(r),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
}

class AddCandidatesSheet extends StatefulWidget {
  final InterviewRound round;
  final List<CandidatePick> picks;

  const AddCandidatesSheet({
    super.key,
    required this.round,
    required this.picks,
  });

  /// Opens the picker. Returns the chosen emails, or null if it was dismissed.
  ///
  /// An empty set is never returned: dismissing and "add nobody" are the same
  /// outcome, and telling them apart would only invite a caller to write a
  /// batch of zero.
  static Future<Set<String>?> show(
    BuildContext context, {
    required InterviewRound round,
    required List<CandidatePick> picks,
  }) {
    return showModalBottomSheet<Set<String>>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => AddCandidatesSheet(round: round, picks: picks),
    );
  }

  @override
  State<AddCandidatesSheet> createState() => _AddCandidatesSheetState();
}

class _AddCandidatesSheetState extends State<AddCandidatesSheet> {
  final Set<String> _ticked = {};
  final TextEditingController _search = TextEditingController();
  final TextEditingController _emails = TextEditingController();
  String _query = '';

  /// Emails typed in here, in the order they were added. Kept separate from
  /// `widget.picks` so the sheet stays a pure function of what it was given
  /// plus what the recruiter did in it.
  final List<CandidatePick> _typed = [];

  /// What the last paste could not read, shown until the next one.
  Set<String> _rejected = const {};

  bool _emailsOpen = false;

  @override
  void dispose() {
    _search.dispose();
    _emails.dispose();
    super.dispose();
  }

  /// Typed-in rows first: they are the reason the recruiter opened this.
  List<CandidatePick> get _all => [..._typed, ...widget.picks];

  List<CandidatePick> get _addable =>
      _all.where((p) => !p.alreadyIn).toList();

  /// Takes whatever is in the email box: known people get ticked, strangers
  /// become new rows, and anybody already in the round is left alone.
  void _commitTypedEmails() {
    final parsed = parseCandidateEmails(_emails.text);
    if (parsed.valid.isEmpty && parsed.rejected.isEmpty) return;

    final known = {for (final p in _all) p.email: p};
    setState(() {
      for (final email in parsed.valid) {
        final existing = known[email];
        if (existing != null) {
          // Already in the round: nothing to do, and nothing to tick.
          if (!existing.alreadyIn) _ticked.add(email);
          continue;
        }
        _typed.insert(0, CandidatePick(email: email, isNew: true));
        _ticked.add(email);
      }
      _rejected = parsed.rejected;
      if (parsed.valid.isNotEmpty) _emails.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final all = _all;
    final visible = filterCandidatePicks(all, _query);
    final addable = _addable;
    final allTicked = addable.isNotEmpty && _ticked.length == addable.length;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.xl, 0, AppSpacing.xl, AppSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Add to "${widget.round.title}"',
              style: theme.textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            Text(
              widget.round.order > 0
                  ? 'Pick who joins. Adding somebody here also marks their '
                      'earlier rounds as cleared — being put in a later round '
                      'IS getting through the ones before it.'
                  : 'Pick who joins this round.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: WarmSurfaces.inkMuted(context)),
            ),
            const SizedBox(height: AppSpacing.md),
            // Somebody who is not in the pipeline at all. Before this there was
            // no way to add a late applicant to an existing pipeline from
            // anywhere in the app — candidates could only be named while the
            // pipeline was being created.
            if (!_emailsOpen)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => setState(() => _emailsOpen = true),
                  icon: const Icon(Icons.add_rounded, size: 17),
                  label: const Text('Invite someone new by email'),
                ),
              )
            else ...[
              RecruiterInput(
                controller: _emails,
                hint: 'name@company.com, another@company.com',
                icon: Icons.alternate_email_rounded,
                minLines: 1,
                maxLines: 3,
                keyboardType: TextInputType.emailAddress,
              ),
              const SizedBox(height: AppSpacing.sm),
              Row(
                children: [
                  RecruiterSecondaryButton(
                    label: 'Add to the list',
                    icon: Icons.person_add_alt_outlined,
                    onPressed: _commitTypedEmails,
                  ),
                ],
              ),
              if (_rejected.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.sm),
                Text(
                  "Not an email address: ${_rejected.join(', ')}",
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.error),
                ),
              ],
              const SizedBox(height: AppSpacing.sm),
            ],
            if (all.length > 8) ...[
              RecruiterInput(
                controller: _search,
                hint: 'Search name or email',
                icon: Icons.search_rounded,
                onChanged: (v) => setState(() => _query = v),
              ),
              const SizedBox(height: AppSpacing.sm),
            ],
            if (addable.isNotEmpty)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: () => setState(() {
                    if (allTicked) {
                      _ticked.clear();
                    } else {
                      _ticked
                        ..clear()
                        ..addAll(addable.map((p) => p.email));
                    }
                  }),
                  child: Text(allTicked
                      ? 'Clear all'
                      : 'Select everyone (${addable.length})'),
                ),
              ),
            Flexible(
              child: visible.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.symmetric(
                          vertical: AppSpacing.xxl),
                      child: Text(
                        all.isEmpty
                            ? 'Nobody is in this pipeline yet — invite someone '
                                'by email above.'
                            : 'Nobody matches "$_query".',
                        style: theme.textTheme.bodyMedium?.copyWith(
                            color: WarmSurfaces.inkMuted(context)),
                      ),
                    )
                  : ListView.builder(
                      shrinkWrap: true,
                      itemCount: visible.length,
                      itemBuilder: (context, i) {
                        final p = visible[i];
                        return _PickRow(
                          pick: p,
                          ticked: _ticked.contains(p.email),
                          onToggle: p.alreadyIn
                              ? null
                              : () => setState(() {
                                    if (!_ticked.remove(p.email)) {
                                      _ticked.add(p.email);
                                    }
                                  }),
                        );
                      },
                    ),
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                Expanded(
                  child: RecruiterPrimaryButton(
                    label: _ticked.isEmpty
                        ? 'Add candidates'
                        : 'Add ${_ticked.length} '
                            '${_ticked.length == 1 ? 'candidate' : 'candidates'}',
                    icon: Icons.person_add_alt_1_outlined,
                    // Disabled rather than hidden: the button is where the eye
                    // goes, and it has to say what is missing.
                    onPressed: _ticked.isEmpty
                        ? null
                        : () => Navigator.of(context).pop({..._ticked}),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PickRow extends StatelessWidget {
  final CandidatePick pick;
  final bool ticked;

  /// Null for a locked row — already in the round, nothing to toggle.
  final VoidCallback? onToggle;

  const _PickRow({
    required this.pick,
    required this.ticked,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final locked = onToggle == null;
    final ink = locked
        ? WarmSurfaces.inkSubtle(context)
        : WarmSurfaces.ink(context);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onToggle,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.xs, vertical: AppSpacing.sm),
          child: Row(
            children: [
              Checkbox(
                value: locked ? true : ticked,
                onChanged: locked ? null : (_) => onToggle!(),
                visualDensity: VisualDensity.compact,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      pick.display,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: ink,
                      ),
                    ),
                    if (pick.display != pick.email)
                      Text(
                        pick.email,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall?.copyWith(
                            fontSize: 11.5,
                            color: WarmSurfaces.inkSubtle(context)),
                      ),
                  ],
                ),
              ),
              if (locked) ...[
                const SizedBox(width: AppSpacing.sm),
                Text(
                  'Already in',
                  style: theme.textTheme.bodySmall?.copyWith(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: WarmSurfaces.inkSubtle(context)),
                ),
              ] else if (pick.isNew) ...[
                const SizedBox(width: AppSpacing.sm),
                Text(
                  'New',
                  style: theme.textTheme.bodySmall?.copyWith(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: StatusTone.pending(context)),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
