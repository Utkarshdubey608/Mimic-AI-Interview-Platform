// lib/shared/widgets/desktop_profile_menu.dart
//
// Avatar + email + role + dropdown (Settings, Sign out) for the top-right of
// a desktop top nav. Shared by RecruiterShell and CandidateShell so both
// desktop experiences feel like the same product — only the role label
// differs. Shows the account's email address — never the Firebase
// `displayName` field, which accounts don't reliably set (e.g. a
// Google-linked account may carry the provider name "Google" there instead
// of anything the user recognizes) — so the email is the one value that's
// always correct and always theirs.
//
// One AnimationController (0 = expanded/full info, 1 = collapsed to
// avatar-only) drives every transition:
//   - on mount: starts expanded, then auto-collapses after a beat (the
//     "just logged in" reveal) — skipped if the user is already
//     hovering/has the menu open by the time the delay fires
//   - hover-enter: expand · hover-exit: collapse, UNLESS the dropdown is open
//   - click: expand (if not already) AND open the dropdown
//   - dropdown close: collapse, UNLESS still hovering
// This State object survives tab switches within the same shell (same
// widget type/position in the tree on every rebuild), so the login reveal
// runs exactly once per login/session-restore — a fresh one only happens if
// the shell itself is torn down and remounted, i.e. an actual sign-out/sign-in.

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import 'package:talbotiq/core/theme/desktop_tokens.dart';
import 'package:talbotiq/shared/widgets/logout_button.dart';

class DesktopProfileMenu extends StatefulWidget {
  final String roleLabel;
  final VoidCallback onOpenSettings;
  const DesktopProfileMenu({
    super.key,
    required this.roleLabel,
    required this.onOpenSettings,
  });

  @override
  State<DesktopProfileMenu> createState() => _DesktopProfileMenuState();
}

class _DesktopProfileMenuState extends State<DesktopProfileMenu>
    with SingleTickerProviderStateMixin {
  // 0 = fully expanded (avatar + email + role visible) · 1 = collapsed to
  // avatar-only. Reused for both the one-time login reveal and every
  // subsequent hover/click expansion — only the animation duration differs.
  late final AnimationController _controller;
  late final Animation<double> _collapse;
  final MenuController _menuController = MenuController();

  bool _hovering = false;
  bool _menuOpen = false;

  static const _loginRevealDelay = Duration(milliseconds: 900);
  static const _loginCollapseDuration = Duration(milliseconds: 700);
  static const _hoverDuration = Duration(milliseconds: 350);

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, value: 0);
    _collapse = CurvedAnimation(parent: _controller, curve: Curves.easeInOut);
    Future.delayed(_loginRevealDelay, () {
      // Don't yank it closed out from under an active hover/open menu — that
      // collapse will happen naturally on hover-exit/menu-close instead.
      if (mounted && !_hovering && !_menuOpen) {
        _controller.animateTo(1,
            duration: _loginCollapseDuration, curve: Curves.easeInOut);
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _expand() {
    _controller.animateTo(0, duration: _hoverDuration, curve: Curves.easeOutCubic);
  }

  void _maybeCollapse() {
    if (_hovering || _menuOpen) return;
    _controller.animateTo(1, duration: _hoverDuration, curve: Curves.easeInCubic);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final user = FirebaseAuth.instance.currentUser;
    final email = (user?.email ?? '').trim();
    final label = email.isNotEmpty ? email : widget.roleLabel;
    final initial = label.isNotEmpty ? label[0].toUpperCase() : 'R';

    return MouseRegion(
      // Wraps the avatar AND the (possibly zero-width, when collapsed)
      // revealed label as one hit area, so moving the pointer from the
      // avatar into the just-revealed email/role text never flickers.
      onEnter: (_) {
        _hovering = true;
        _expand();
      },
      onExit: (_) {
        _hovering = false;
        _maybeCollapse();
      },
      child: MenuAnchor(
        controller: _menuController,
        alignmentOffset: const Offset(0, 8),
        style: MenuStyle(
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(DesktopTokens.cardRadius)),
          ),
          backgroundColor: WidgetStatePropertyAll(scheme.surface),
        ),
        onOpen: () {
          _menuOpen = true;
          _expand();
        },
        onClose: () {
          _menuOpen = false;
          _maybeCollapse();
        },
        // The dropdown contains ONLY the two actions — the email/role is
        // already shown in the expanded header area right next to it, so
        // repeating it here would just be the same information twice.
        menuChildren: [
          MenuItemButton(
            leadingIcon: const Icon(Icons.settings_outlined, size: 18),
            onPressed: widget.onOpenSettings,
            child: const Text('Settings'),
          ),
          MenuItemButton(
            leadingIcon: Icon(Icons.logout, size: 18, color: scheme.error),
            onPressed: () => LogoutButton.signOut(context),
            child: Text('Sign out', style: TextStyle(color: scheme.error)),
          ),
        ],
        builder: (context, controller, child) {
          return GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => controller.isOpen ? controller.close() : controller.open(),
            child: child,
          );
        },
        child: AnimatedBuilder(
          animation: _collapse,
          builder: (context, _) {
            final t = _collapse.value;
            return Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircleAvatar(
                  radius: 16,
                  backgroundColor: scheme.primary.withValues(alpha: 0.15),
                  child: Text(initial,
                      style: TextStyle(color: scheme.primary, fontWeight: FontWeight.w700)),
                ),
                ClipRect(
                  child: Align(
                    alignment: Alignment.centerLeft,
                    widthFactor: 1 - t,
                    child: Opacity(
                      opacity: (1 - t).clamp(0.0, 1.0),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const SizedBox(width: 10),
                          ConstrainedBox(
                            // Sized for the SPINE, which is where this now
                            // lives: 240 wide, less its 24 of padding, less
                            // the avatar, gaps and chevron. It was 200, tuned
                            // for a top bar with the whole window to spare.
                            constraints: const BoxConstraints(maxWidth: 132),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(label,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: theme.textTheme.bodyMedium
                                        ?.copyWith(fontWeight: FontWeight.w600)),
                                Text(widget.roleLabel,
                                    style: theme.textTheme.bodySmall
                                        ?.copyWith(color: scheme.onSurfaceVariant)),
                              ],
                            ),
                          ),
                          const SizedBox(width: 4),
                          Icon(Icons.expand_more, size: 18, color: scheme.onSurfaceVariant),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
