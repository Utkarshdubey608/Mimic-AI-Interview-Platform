// lib/features/auth/login_page.dart
//
// Email/password auth screen. Toggles between Login and Sign up; on sign up the
// user also picks a role (Recruiter / Candidate) which is recorded on their
// users/{uid} doc. On success, AuthGate reacts to the auth-state change and
// routes to the correct home — this page does no navigation itself.

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/core/utils/desktop_platform.dart';
import 'package:talbotiq/core/utils/validators.dart';
import 'package:talbotiq/shared/widgets/custom_buttons.dart';
import 'package:talbotiq/shared/widgets/custom_inputs.dart';
import 'package:talbotiq/shared/widgets/mimic_mark.dart';
import 'package:talbotiq/shared/widgets/mimic_wordmark.dart';
import 'package:talbotiq/features/auth/app_role.dart';
import 'package:talbotiq/features/auth/auth_service.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _nameController = TextEditingController();
  final _companyController = TextEditingController();

  bool _isSignUp = false;
  // Desktop sign-up is recruiter-first by design: a candidate already has an
  // account by the time they'd sign in from desktop (recruiters invite them
  // via mobile/web), so the desktop sign-up form defaults to — and only
  // offers — a recruiter account here. This is about onboarding, not access:
  // an existing candidate account can sign IN (below) and reach the full
  // candidate desktop experience via AuthGate → CandidateShell.
  AppRole _role = isDesktopPlatform ? AppRole.recruiter : AppRole.candidate;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _nameController.dispose();
    _companyController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _emailController.text.trim();
    final password = _passwordController.text;
    if (email.isEmpty || password.isEmpty) {
      setState(() => _error = 'Enter your email and password.');
      return;
    }
    if (!Validators.isValidEmail(email)) {
      setState(() => _error = Validators.emailError(email));
      return;
    }
    if (_isSignUp && password.length < 6) {
      setState(() => _error = 'Password must be at least 6 characters.');
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    final auth = context.read<AuthService>();
    try {
      // AuthGate handles routing AND auto-pulling this account's cloud-synced
      // API keys on the resulting auth-state change (it's the one place that
      // sees every way a session becomes active, including an app relaunch
      // that resumes an existing session — not just this form) — so this
      // only needs to perform the sign-in/sign-up itself.
      if (_isSignUp) {
        await auth.signUp(
          email: email,
          password: password,
          role: _role,
          name: _nameController.text,
          company: _companyController.text,
        );
      } else {
        await auth.signIn(email: email, password: password);
      }
    } on FirebaseAuthException catch (e) {
      setState(() => _error = _friendlyError(e));
    } catch (e) {
      setState(() => _error = 'Something went wrong. Please try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  // Sends a password-reset email for the address currently in the email field.
  Future<void> _sendPasswordReset() async {
    final email = _emailController.text.trim();
    if (!Validators.isValidEmail(email)) {
      setState(() => _error = 'Enter your email above to reset your password.');
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    final auth = context.read<AuthService>();
    try {
      await auth.sendPasswordReset(email);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Password reset email sent to $email.')),
      );
    } on FirebaseAuthException catch (e) {
      if (!mounted) return;
      setState(() => _error = _friendlyError(e));
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Could not send the reset email. Please try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _friendlyError(FirebaseAuthException e) {
    switch (e.code) {
      case 'invalid-email':
        return 'That email address looks invalid.';
      case 'user-disabled':
        return 'This account has been disabled.';
      case 'user-not-found':
      case 'wrong-password':
      case 'invalid-credential':
        return 'Incorrect email or password.';
      case 'email-already-in-use':
        return 'An account already exists for that email.';
      case 'weak-password':
        return 'Please choose a stronger password.';
      case 'network-request-failed':
        return 'Network error. Check your connection.';
      default:
        return e.message ?? 'Authentication failed.';
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // The sign-in lockup: the drawn mark beside the wordmark, the
                // same pair as web's MimicLockup. FittedBox rather than a bare
                // Row so a large system font scale shrinks the lockup instead
                // of overflowing the column.
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const MimicMark(size: 44),
                      const SizedBox(width: 12),
                      DefaultTextStyle(
                        style: TextStyle(color: theme.colorScheme.onSurface),
                        child: const MimicWordmark(fontSize: 34),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  _isSignUp ? 'Create your account' : 'Welcome back',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyLarge?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 32),
                if (_isSignUp) ...[
                  if (!isDesktopPlatform)
                    _RolePicker(
                      value: _role,
                      onChanged: (r) => setState(() => _role = r),
                    )
                  else
                    const _DesktopRecruiterOnlyNotice(),
                  const SizedBox(height: 16),
                  CustomInputField(
                    label: 'Name',
                    placeholder: 'Your name',
                    controller: _nameController,
                    keyboardType: TextInputType.name,
                  ),
                  const SizedBox(height: 16),
                  // RECRUITERS ONLY. A candidate belongs to no company here — they
                  // are invited by one — and asking would imply their answer matters
                  // to something.
                  //
                  // Recorded in the same shape the web client writes, so colleagues
                  // are recognised as colleagues whichever client they signed up on.
                  // Optional: an account with no company keeps its own templates and
                  // question sets, it just shares none.
                  if (_role == AppRole.recruiter) ...[
                    CustomInputField(
                      label: 'Company',
                      placeholder: 'Your company or organisation',
                      controller: _companyController,
                      keyboardType: TextInputType.text,
                    ),
                    const SizedBox(height: 16),
                  ],
                ],
                CustomInputField(
                  label: 'Email',
                  placeholder: 'you@example.com',
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                ),
                const SizedBox(height: 16),
                CustomInputField(
                  label: 'Password',
                  placeholder: '••••••••',
                  controller: _passwordController,
                  isPassword: true,
                ),
                if (!_isSignUp)
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: _loading ? null : _sendPasswordReset,
                      child: Text(
                        'Forgot password?',
                        style: TextStyle(color: theme.colorScheme.primary),
                      ),
                    ),
                  ),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.error.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: theme.colorScheme.error.withOpacity(0.4),
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.error_outline,
                            size: 18, color: theme.colorScheme.error),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _error!,
                            style: TextStyle(
                              color: theme.colorScheme.error,
                              fontWeight: FontWeight.w500,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 24),
                CustomButton(
                  text: _isSignUp ? 'Sign up' : 'Login',
                  isLoading: _loading,
                  onPressed: _loading ? () {} : _submit,
                ),
                const SizedBox(height: 16),
                TextButton(
                  onPressed: _loading
                      ? null
                      : () => setState(() {
                            _isSignUp = !_isSignUp;
                            _error = null;
                          }),
                  child: Text(
                    _isSignUp
                        ? 'Already have an account? Login'
                        : "Don't have an account? Sign up",
                    style: TextStyle(color: theme.colorScheme.primary),
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

/// Shown instead of [_RolePicker] on desktop sign-up: there is no candidate
/// option to pick, so say so rather than silently omitting it.
class _DesktopRecruiterOnlyNotice extends StatelessWidget {
  const _DesktopRecruiterOnlyNotice();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Icon(Icons.work_outline_rounded,
            size: 18, color: theme.colorScheme.onSurfaceVariant),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            'Mimic Desktop is for recruiters — this creates a recruiter account.',
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
        ),
      ],
    );
  }
}

/// A segmented Recruiter / Candidate control used during sign-up.
class _RolePicker extends StatelessWidget {
  final AppRole value;
  final ValueChanged<AppRole> onChanged;

  const _RolePicker({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'I am a',
          style: theme.textTheme.labelLarge?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(3),
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainerHighest.withOpacity(0.4),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
                color: theme.colorScheme.outlineVariant.withOpacity(0.5)),
          ),
          child: Row(
            children: [
              _seg(context, AppRole.candidate, Icons.person_outline),
              _seg(context, AppRole.recruiter, Icons.work_outline_rounded),
            ],
          ),
        ),
      ],
    );
  }

  Widget _seg(BuildContext context, AppRole role, IconData icon) {
    final theme = Theme.of(context);
    final selected = value == role;
    return Expanded(
      child: GestureDetector(
        onTap: () => onChanged(role),
        behavior: HitTestBehavior.opaque,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: selected ? theme.colorScheme.surface : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
            boxShadow: selected
                ? [
                    BoxShadow(
                        color: Colors.black.withOpacity(0.06),
                        blurRadius: 4,
                        offset: const Offset(0, 2))
                  ]
                : null,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon,
                  size: 18,
                  color: selected
                      ? theme.colorScheme.primary
                      : theme.colorScheme.onSurfaceVariant),
              const SizedBox(width: 8),
              Text(
                role.label,
                style: TextStyle(
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  color: selected
                      ? theme.colorScheme.primary
                      : theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
