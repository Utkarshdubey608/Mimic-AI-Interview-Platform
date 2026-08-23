// lib/features/auth/company_prompt.dart
//
// Asks an existing recruiter which company they belong to, once.
//
// Sign-up collects this on both clients now, but every account created before that has
// no `companyKey` — and interview templates and question sets are scoped by it on the
// server. Without a key a recruiter keeps everything they authored and shares none of
// it: safe, but not what they had yesterday, because colleagues used to see each
// other's work.
//
// **Not dismissible**, and that is the uncomfortable half of the decision. A "later"
// button reads as optional, and the cost of choosing later is invisible from here —
// their colleagues' templates simply stay missing, which nobody attributes to a dialog
// they closed weeks ago. It asks for one field a recruiter knows without looking
// anything up.
//
// Candidates are never asked: they belong to no company here, they are invited by one.
// The web client shows the same prompt from RecruiterShell — see CompanyPrompt.tsx.

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import 'package:talbotiq/features/auth/company_key.dart';

/// Shows the prompt if this recruiter has no company recorded. Safe to call more than
/// once — it reads first and returns without a dialog when nothing is needed.
Future<void> maybePromptForCompany(BuildContext context) async {
  final user = FirebaseAuth.instance.currentUser;
  if (user == null) return;

  final ref = FirebaseFirestore.instance.collection('users').doc(user.uid);

  DocumentSnapshot<Map<String, dynamic>> snap;
  try {
    snap = await ref.get();
  } catch (_) {
    // A profile read that fails must not block the app. The recruiter keeps their own
    // work either way, and the prompt reappears on the next launch.
    return;
  }

  final data = snap.data() ?? const <String, dynamic>{};
  if (data['role'] != 'recruiter') return;
  if (normalizeCompanyKey(data['companyKey'] as String?).isNotEmpty) return;
  // A `company` recorded without a key is possible on a very old document; derive the
  // key from it rather than asking again for something they already told us.
  final fromDisplay = normalizeCompanyKey(data['company'] as String?);
  if (fromDisplay.isNotEmpty) {
    try {
      await ref.set({'companyKey': fromDisplay}, SetOptions(merge: true));
    } catch (_) {/* asked again next launch */}
    return;
  }

  if (!context.mounted) return;
  await showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _CompanyDialog(ref: ref),
  );
}

class _CompanyDialog extends StatefulWidget {
  const _CompanyDialog({required this.ref});
  final DocumentReference<Map<String, dynamic>> ref;

  @override
  State<_CompanyDialog> createState() => _CompanyDialogState();
}

class _CompanyDialogState extends State<_CompanyDialog> {
  final _controller = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final key = normalizeCompanyKey(_controller.text);
    // Refused rather than written blank. An empty key stored as a VALUE becomes the
    // bucket every company-less account falls into, which is the leak the scoping
    // exists to prevent.
    if (key.isEmpty) {
      setState(() => _error = 'Enter your company name.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.ref.set({
        // Both forms, in the same shape sign-up writes, so a backfilled account is
        // indistinguishable from a new one.
        'company': normalizeCompanyDisplay(_controller.text),
        'companyKey': key,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = 'Could not save that. Try again.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      icon: const Icon(Icons.business_outlined),
      title: const Text('Which company are you hiring for?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Interview templates and question sets are shared with your colleagues, '
            'and we need your company name to know who they are. Recruiters elsewhere '
            'never see your work.',
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _controller,
            autofocus: true,
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => _saving ? null : _save(),
            decoration: const InputDecoration(
              labelText: 'Company',
              hintText: 'e.g. Acme Inc',
            ),
          ),
          const SizedBox(height: 8),
          // Worth saying: otherwise somebody agonises over it, or types it differently
          // from a colleague and assumes that is why sharing is not working.
          Text(
            'Spelling has to match your colleagues; capitalisation does not.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
        ],
      ),
      actions: [
        // No "Later". See the note at the top of this file.
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Save'),
        ),
      ],
    );
  }
}
