// lib/shared/widgets/desktop_spine.dart
//
// The desktop navigation spine — the Flutter half of the web client's
// `src/components/layout/Nav.tsx`.
//
// It replaces DesktopTopNav. Nav is the most-looked-at element on any screen,
// so having a top bar here and a left spine in the browser meant the two
// clients disagreed about the product's shape in the first thing anyone saw.
// One nav model per FORM FACTOR, never per platform: desktops get this spine,
// phones keep the floating bar on both.
//
// Three things are deliberately identical to the web spine and must move
// together with it (see contracts/lexicon.md §8):
//
//   1. The groups, their order, and their labels.
//   2. The selected mark — a SOLID block carrying near-black ink, the same
//      selected-chip treatment the phone's floating bar uses.
//   3. The account block at the TOP. It sat at the bottom of the web spine,
//      pinned to the viewport edge, and was reported missing twice: any
//      condition that clips the bottom edge hid the only way out of the app.
//
// The chrome is dark in BOTH themes, from TokenChrome. That is not a dark-mode
// choice — it is the same rule the phone's bar follows, and a spine that
// followed the ground would be a white rectangle beside a dark interview room.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/theme/design_tokens.dart';
import 'package:talbotiq/core/theme/design_tokens.g.dart';
import 'package:talbotiq/shared/widgets/logout_button.dart';
import 'package:talbotiq/shared/widgets/mimic_wordmark.dart';

/// One destination in the spine.
///
/// Two kinds. Most are TABS: they select a page in the shell's IndexedStack and
/// can read as selected. A few are PUSHERS — they open a route on top, the way
/// the library's sections have always opened. A pusher never shows as selected,
/// because the thing it opened is above the shell rather than inside it.
class SpineItem {
  final IconData icon;
  final IconData? activeIcon;
  final String label;

  /// Set to push a route instead of selecting a tab.
  final WidgetBuilder? push;

  const SpineItem({
    required this.icon,
    this.activeIcon,
    required this.label,
    this.push,
  });
}

/// A labelled run of destinations. The label is a quiet section heading, not a
/// control — grouping is what gives the list hierarchy, so that daily work sits
/// at the top of the eye's travel and configuration at the bottom.
class SpineGroup {
  final String label;
  final List<SpineItem> items;

  const SpineGroup({required this.label, required this.items});
}

class DesktopSpine extends StatelessWidget {
  /// Index into the FLATTENED item list, matching [onSelect].
  final int currentIndex;
  final ValueChanged<int> onSelect;
  final List<SpineGroup> groups;

  /// The account block — WHO you are. Rendered at the top, under the wordmark.
  final Widget account;

  const DesktopSpine({
    super.key,
    required this.currentIndex,
    required this.onSelect,
    required this.groups,
    required this.account,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: TokenLayout.spineWidth,
      decoration: const BoxDecoration(
        color: TokenChrome.bar,
        border: Border(right: BorderSide(color: TokenChrome.stroke)),
      ),
      child: SafeArea(
        right: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.md),
              // The wordmark is plain ink on the chrome, never the accent: the
              // spine already carries one block (the selected chip) and a
              // coloured wordmark would be a second.
              child: const Align(
                alignment: Alignment.centerLeft,
                child: DefaultTextStyle(
                  style: TextStyle(color: TokenChrome.ink),
                  child: MimicWordmark(fontSize: 19),
                ),
              ),
            ),
            const Divider(height: 1, thickness: 1, color: TokenChrome.stroke),
            Padding(
              padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.md, vertical: AppSpacing.md),
              // The chrome is dark in both themes, so anything hosted in it must
              // read the CHROME's colours and not the ground's. Without this the
              // account block renders the light theme's near-black ink on the
              // near-black bar and disappears entirely — the same trap the
              // language warns about with white glyphs on pastel fills.
              child: _OnChrome(child: account),
            ),
            const Divider(height: 1, thickness: 1, color: TokenChrome.stroke),
            // The destinations scroll; the footer below does not. That is what
            // makes it safe to put the way OUT at the bottom edge — this column
            // absorbs every overflow, so a short window or a large text size
            // shortens the list rather than clipping sign-out.
            Expanded(child: _destinations(context)),
            const Divider(height: 1, thickness: 1, color: TokenChrome.stroke),
            const _SignOut(),
          ],
        ),
      ),
    );
  }

  Widget _destinations(BuildContext context) {
    final children = <Widget>[];
    var flat = 0;

    for (final group in groups) {
      children.add(Padding(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.sm),
        child: Text(
          group.label.toUpperCase(),
          style: const TextStyle(
            fontSize: 10.5,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.1,
            color: TokenChrome.inkMuted,
          ),
        ),
      ));

      for (final item in group.items) {
        if (item.push != null) {
          children.add(_SpineButton(
            item: item,
            selected: false,
            onTap: () => Navigator.of(context)
                .push(MaterialPageRoute(builder: item.push!)),
          ));
          continue;
        }
        // Only tabs consume an index, so adding a pusher cannot silently
        // renumber the pages behind every destination after it.
        final index = flat++;
        children.add(_SpineButton(
          item: item,
          selected: index == currentIndex,
          onTap: () => onSelect(index),
        ));
      }
    }

    return ListView(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      children: children,
    );
  }
}

class _SpineButton extends StatelessWidget {
  final SpineItem item;
  final bool selected;
  final VoidCallback onTap;

  const _SpineButton({
    required this.item,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    // The one block on this element. `colorScheme.primary` is the user's live
    // accent, so the spine re-skins with the rest of the app and no widget here
    // ever names a colour.
    final block = Theme.of(context).colorScheme.primary;
    final fg = selected ? TokenBlock.ink : TokenChrome.inkMuted;

    return Padding(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm, vertical: 1),
      child: Material(
        color: selected ? block : Colors.transparent,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadius.sm),
          hoverColor: selected ? Colors.transparent : TokenChrome.surface,
          child: Padding(
            padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md, vertical: 9),
            child: Row(
              children: [
                Icon(
                  selected ? (item.activeIcon ?? item.icon) : item.icon,
                  size: 18,
                  color: fg,
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(
                    item.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight:
                          selected ? FontWeight.w700 : FontWeight.w500,
                      color: fg,
                    ),
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

/// Re-points the ambient theme at the chrome for anything drawn on the spine.
///
/// Scoped rather than global: the spine is the only surface in the app that
/// stays dark in both themes, so this is the one place the ground's colours are
/// the wrong answer.
class _OnChrome extends StatelessWidget {
  final Widget child;

  const _OnChrome({required this.child});

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context);
    return Theme(
      data: base.copyWith(
        colorScheme: base.colorScheme.copyWith(
          surface: TokenChrome.bar,
          onSurface: TokenChrome.ink,
          onSurfaceVariant: TokenChrome.inkMuted,
        ),
        textTheme: base.textTheme.apply(
          bodyColor: TokenChrome.ink,
          displayColor: TokenChrome.ink,
        ),
        iconTheme: base.iconTheme.copyWith(color: TokenChrome.inkMuted),
      ),
      child: child,
    );
  }
}

/// Sign out, at the bottom of the spine.
///
/// Where a sidebar puts it and where people look for it — and the same place the
/// web spine puts it, so the two clients agree about the way out as well as the
/// way around. It delegates to [LogoutButton.signOut], the one implementation,
/// rather than re-deriving what needs clearing on the way.
class _SignOut extends StatelessWidget {
  const _SignOut();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.sm),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        child: InkWell(
          onTap: () => LogoutButton.signOut(context),
          borderRadius: BorderRadius.circular(AppRadius.sm),
          hoverColor: TokenChrome.surface,
          child: const Padding(
            padding: EdgeInsets.symmetric(
                horizontal: AppSpacing.md, vertical: 9),
            child: Row(
              children: [
                Icon(Icons.logout_rounded, size: 18, color: TokenChrome.inkMuted),
                SizedBox(width: AppSpacing.md),
                Text(
                  'Sign out',
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w500,
                    color: TokenChrome.inkMuted,
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
