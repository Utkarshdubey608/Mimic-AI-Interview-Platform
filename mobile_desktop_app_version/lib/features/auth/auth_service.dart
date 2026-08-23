// lib/features/auth/auth_service.dart
//
// Thin wrapper over FirebaseAuth + the `users/{uid}` role document. Exposes the
// auth state stream (consumed by AuthGate) and sign-up/in/out helpers. Sign-up
// records the chosen role; the role is read back at login to route the user.

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import 'package:talbotiq/features/auth/app_role.dart';
import 'package:talbotiq/features/auth/company_key.dart';

/// Thin wrapper over Firebase Auth that also resolves the signed-in user's
/// role + display name from Firestore. Exposes the current user, auth-state and
/// role streams, and sign-in/up/out — the single seam the UI should use instead
/// of touching `FirebaseAuth.instance` directly.
class AuthService {
  AuthService({FirebaseAuth? auth, FirebaseFirestore? firestore})
      : _auth = auth ?? FirebaseAuth.instance,
        _db = firestore ?? FirebaseFirestore.instance;

  final FirebaseAuth _auth;
  final FirebaseFirestore _db;

  /// Emits on sign-in / sign-out. Drives AuthGate.
  Stream<User?> authStateChanges() => _auth.authStateChanges();

  User? get currentUser => _auth.currentUser;

  CollectionReference<Map<String, dynamic>> get _users =>
      _db.collection('users');

  /// Creates an account, records the chosen [role] on `users/{uid}`.
  Future<User> signUp({
    required String email,
    required String password,
    required AppRole role,
    String? name,
    String? company,
  }) async {
    final cred = await _auth.createUserWithEmailAndPassword(
      email: email.trim(),
      password: password,
    );
    final user = cred.user!;
    if (name != null && name.trim().isNotEmpty) {
      await user.updateDisplayName(name.trim());
    }
    final companyKey = normalizeCompanyKey(company);
    await _users.doc(user.uid).set({
      'email': user.email,
      'emailLower': (user.email ?? email).trim().toLowerCase(),
      'role': role.wire,
      if (name != null && name.trim().isNotEmpty) 'name': name.trim(),
      // BOTH forms, and both are needed — written in the exact shape the web client
      // uses (see AuthProvider.tsx), so an account created here behaves identically
      // there and vice versa.
      //
      // `company` is what they typed, kept for display. `companyKey` is the
      // normalised form and the only thing ever compared, so "TalbotIQ" and
      // "talbotiq" are one company. Written ONLY when given: an empty key must never
      // become a bucket that every company-less account falls into.
      if (companyKey.isNotEmpty) 'company': normalizeCompanyDisplay(company),
      if (companyKey.isNotEmpty) 'companyKey': companyKey,
      'createdAt': FieldValue.serverTimestamp(),
    });
    return user;
  }

  /// Display name recorded for [uid] (from the users doc), or null.
  Future<String?> nameFor(String uid) async {
    final snap = await _users.doc(uid).get();
    final name = snap.data()?['name'];
    return name is String && name.trim().isNotEmpty ? name.trim() : null;
  }

  Future<User> signIn({
    required String email,
    required String password,
  }) async {
    final cred = await _auth.signInWithEmailAndPassword(
      email: email.trim(),
      password: password,
    );
    return cred.user!;
  }

  Future<void> signOut() => _auth.signOut();

  /// Sends a password-reset email to [email]. Used by the login screen's
  /// "Forgot password?" action.
  Future<void> sendPasswordReset(String email) =>
      _auth.sendPasswordResetEmail(email: email.trim());

  /// Reads the role recorded at sign-up. Defaults to candidate if the doc is
  /// missing (e.g. an account created outside the app).
  Future<AppRole> roleFor(String uid) async {
    final snap = await _users.doc(uid).get();
    return AppRoleX.fromWire(snap.data()?['role'] as String?);
  }

  /// Live role stream so AuthGate re-routes if the doc is created after sign-in.
  Stream<AppRole> roleStream(String uid) => _users.doc(uid).snapshots().map(
        (snap) => AppRoleX.fromWire(snap.data()?['role'] as String?),
      );
}
