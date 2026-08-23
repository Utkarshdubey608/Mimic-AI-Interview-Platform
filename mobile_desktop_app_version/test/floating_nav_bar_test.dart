// test/floating_nav_bar_test.dart
//
// The bottom bar has to survive the narrowest phone we support with every
// destination AND the centre create action visible. The redesign hit exactly
// this class of bug elsewhere (the analytics funnel strip ran off the right
// edge), and an overflow here is especially easy to miss because the bar is
// only a few pixels over budget before it starts painting the yellow-and-black
// stripes.
//
// The bar paints icons, plus a label on the SELECTED destination when the width
// is there for it in full. Every destination's name is also carried by a
// tooltip and a Semantics label, so these tests assert through the semantics
// tree rather than through find.text: a label that is dropped for want of room
// must not take the accessible name with it — and must not be half-drawn.

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:talbotiq/core/theme/app_theme.dart';
import 'package:talbotiq/shared/widgets/floating_nav_bar.dart';

const _items = [
  FloatingNavItem(
      icon: Icons.home_outlined, activeIcon: Icons.home_rounded, label: 'Home'),
  FloatingNavItem(
      icon: Icons.analytics_outlined,
      activeIcon: Icons.analytics_rounded,
      label: 'Analytics'),
  FloatingNavItem(
      icon: Icons.settings_outlined,
      activeIcon: Icons.settings_rounded,
      label: 'Settings'),
];

const _fourItems = [
  ..._items,
  FloatingNavItem(
      icon: Icons.folder_outlined,
      activeIcon: Icons.folder_rounded,
      label: 'Library'),
];

Widget _harness({
  required int index,
  List<FloatingNavItem> items = _items,
  FloatingNavAction? action,
  ValueChanged<int>? onSelect,
  ThemeData? theme,
}) {
  return MaterialApp(
    theme: theme ?? AppTheme.darkTheme,
    home: Scaffold(
      body: const SizedBox.expand(),
      bottomNavigationBar: FloatingNavBar(
        currentIndex: index,
        onSelect: onSelect ?? (_) {},
        items: items,
        action: action,
      ),
    ),
  );
}

FloatingNavAction _action({VoidCallback? onPressed}) => FloatingNavAction(
      icon: Icons.add_rounded,
      tooltip: 'Create interview test',
      onPressed: onPressed ?? () {},
    );

/// Centre of the destination whose accessible name is [label].
Offset _centreOf(WidgetTester tester, String label) =>
    tester.getCenter(find.bySemanticsLabel(label));

void main() {
  testWidgets('lays out at 320dp with all destinations and the create action',
      (tester) async {
    // Narrower than any phone we target — if it fits here it fits everywhere.
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(_harness(index: 0, action: _action()));

    expect(tester.takeException(), isNull);
    expect(find.byIcon(Icons.add_rounded), findsOneWidget);
  });

  testWidgets('four destinations plus the action still fit at 320dp',
      (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
        _harness(index: 0, items: _fourItems, action: _action()));

    expect(tester.takeException(), isNull);
  });

  testWidgets('every destination keeps an accessible name', (tester) async {
    // The bar shows no text, so this is the only thing standing between a
    // screen-reader user and four unlabelled buttons.
    await tester.pumpWidget(_harness(index: 0, action: _action()));

    for (final item in _items) {
      expect(find.bySemanticsLabel(item.label), findsOneWidget,
          reason: item.label);
    }
    expect(find.bySemanticsLabel('Create interview test'), findsOneWidget);
  });

  testWidgets('the bar stays centred whichever destination is selected',
      (tester) async {
    // The bar hugs its content and the selected chip is wider than an icon, so
    // the items DO reflow when the selection moves — that is the reference's
    // behaviour. What must not change is the bar's own centring, which is what
    // keeps the reflow from reading as drift.
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final centres = <double>[];
    for (var i = 0; i < _items.length; i++) {
      await tester.pumpWidget(_harness(index: i, action: _action()));
      await tester.pumpAndSettle();
      centres.add(tester.getRect(find.byKey(navBarPillKey)).center.dx);
    }

    for (final c in centres) {
      expect(c, closeTo(400 / 2, 1.0), reason: 'centres: $centres');
    }
  });

  testWidgets('the bar does not steal the page body', (tester) async {
    // It shipped doing exactly that: a Center around the pill expanded on both
    // axes, and because Scaffold measures bottomNavigationBar with a loose
    // constraint the bar claimed the whole screen height — the body collapsed
    // to nothing and the app opened blank with a bar floating mid-screen.
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    const bodyKey = Key('page-body');
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.darkTheme,
      home: Scaffold(
        body: Container(key: bodyKey, color: const Color(0xFF123456)),
        bottomNavigationBar: FloatingNavBar(
          currentIndex: 0,
          onSelect: (_) {},
          items: _items,
          action: _action(),
        ),
      ),
    ));
    await tester.pumpAndSettle();

    final barHeight = tester.getSize(find.byType(FloatingNavBar)).height;
    final bodyHeight = tester.getSize(find.byKey(bodyKey)).height;

    // The bar is chrome: it should take a small slice, and the body the rest.
    expect(barHeight, lessThan(120), reason: 'bar height $barHeight');
    expect(bodyHeight, greaterThan(800 * 0.8), reason: 'body $bodyHeight');
  });

  group('proportions', () {
    testWidgets('the bar hugs its content instead of spanning the screen',
        (tester) async {
      // A full-width bar left large dead gaps between three items, which is
      // half of what read as "odd ratios".
      tester.view.physicalSize = const Size(412, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(_harness(index: 0, action: _action()));
      await tester.pumpAndSettle();

      final pill = tester.getRect(find.byKey(navBarPillKey));
      expect(pill.width, lessThan(412 * 0.92),
          reason: 'pill should not fill the screen');

      // ...and it is centred, so the margins match on both sides.
      expect(pill.center.dx, closeTo(412 / 2, 1.0));
    });

    testWidgets('every element in the bar is the same height', (tester) async {
      // The old bar held 42-tall items and a 46 circle inside 62 of chrome;
      // that mismatch is the other half of the problem.
      await tester.pumpWidget(_harness(index: 0, action: _action()));
      await tester.pumpAndSettle();

      final heights = <String, double>{
        'chip': tester.getSize(find.bySemanticsLabel('Home')).height,
        'icon': tester.getSize(find.bySemanticsLabel('Analytics')).height,
        'action': tester
            .getSize(find.bySemanticsLabel('Create interview test'))
            .height,
      };
      final first = heights.values.first;
      for (final e in heights.entries) {
        expect(e.value, closeTo(first, 0.5), reason: '${e.key} differs');
      }
    });

    testWidgets('the gaps between items are uniform', (tester) async {
      await tester.pumpWidget(_harness(index: 0, items: _fourItems));
      await tester.pumpAndSettle();

      // Unselected slots only, so a wider selected chip does not skew this.
      final xs = [
        for (final l in ['Analytics', 'Settings', 'Library'])
          tester.getRect(find.bySemanticsLabel(l)),
      ];
      final gaps = [
        for (var k = 1; k < xs.length; k++) xs[k].left - xs[k - 1].right,
      ];
      for (final g in gaps) {
        expect(g, closeTo(gaps.first, 0.5), reason: 'gaps: $gaps');
      }
    });

    testWidgets('the bar is a true stadium — radius is half its height',
        (tester) async {
      await tester.pumpWidget(_harness(index: 0, action: _action()));
      await tester.pumpAndSettle();

      final pill = tester.widget<Container>(find.byKey(navBarPillKey));
      final radius =
          ((pill.decoration as BoxDecoration).borderRadius as BorderRadius)
              .topLeft
              .x;
      final painted = tester.getSize(find.byKey(navBarPillKey)).height;
      // Within a border width: the painted box includes its 1px stroke on each
      // side, while the radius is set from the content height.
      expect(radius, closeTo(painted / 2, 1.5));
    });
  });

  testWidgets('the create action sits between the two groups of destinations',
      (tester) async {
    // Not pixel-centred: the selected chip takes the leftover width, so the
    // action lands at the split point. What must hold is the ORDER — the action
    // separates the two groups and never drifts to an edge.
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    for (final items in [_items, _fourItems]) {
      await tester.pumpWidget(
          _harness(index: 0, items: items, action: _action()));
      await tester.pumpAndSettle();

      final actionX = tester.getCenter(find.byIcon(Icons.add_rounded)).dx;
      final half = items.length ~/ 2;
      for (var i = 0; i < items.length; i++) {
        final x = _centreOf(tester, items[i].label).dx;
        if (i < half) {
          expect(x, lessThan(actionX), reason: '${items[i].label} before +');
        } else {
          expect(x, greaterThan(actionX), reason: '${items[i].label} after +');
        }
      }
      // And it stays well inside the bar rather than hugging an edge.
      final bar = tester.getRect(find.byType(FloatingNavBar));
      expect(actionX, greaterThan(bar.left + bar.width * 0.25));
      expect(actionX, lessThan(bar.right - bar.width * 0.25));
    }
  });

  testWidgets('the selected label is not truncated on a real phone',
      (tester) async {
    // The reported bug: equal-width slots rendered "Home" as "Ho…". Checked via
    // didExceedMaxLines, which is exactly what ellipsising sets — asserting the
    // text is merely present would have passed while it read "Ho…".
    for (final size in [const Size(360, 800), const Size(412, 900)]) {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      // "Home" is the label that actually shipped truncated. Note the test
      // font renders every glyph at the full font size, so it is roughly 3x
      // wider than Inter — a longer name can ellipsise here and still be fine
      // on a device, which is why this pins the reported case rather than the
      // longest string.
      await tester.pumpWidget(_harness(index: 0, action: _action()));
      await tester.pumpAndSettle();

      final para = tester.renderObject<RenderParagraph>(
        find.descendant(
          of: find.byType(FloatingNavBar),
          matching: find.text('Home'),
        ),
      );
      expect(para.didExceedMaxLines, isFalse,
          reason: 'label truncated at ${size.width}dp');
    }
  });

  testWidgets('the selected label is drawn at its full width, not squeezed',
      (tester) async {
    // The shipped bug this pins: every slot was Flexible, so the Row handed
    // each destination an EQUAL share of the bar rather than what it needed,
    // and the selected pill's label was cut mid-word ("Settings" as "Setti")
    // on a 412dp phone with 90px spare either side of the bar.
    //
    // The test above cannot see that, because clipping — unlike ellipsising —
    // never sets didExceedMaxLines. This one compares the label as drawn
    // against its own unconstrained width, which is the only thing that
    // distinguishes "laid out in full" from "laid out in what was left over".
    tester.view.physicalSize = const Size(412, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(_harness(index: 0, action: _action()));
    await tester.pumpAndSettle();

    final para = tester.renderObject<RenderParagraph>(find.descendant(
      of: find.byType(FloatingNavBar),
      matching: find.text('Home'),
    ));
    final natural = (TextPainter(
      text: para.text,
      textDirection: TextDirection.ltr,
      maxLines: 1,
    )..layout())
        .width;

    expect(para.size.width, closeTo(natural, 0.5),
        reason: 'drawn ${para.size.width} of $natural');
  });

  testWidgets('a label that will not fit is dropped, never half-drawn',
      (tester) async {
    // At 320dp four destinations plus the create action leave no room for a
    // label at all. The rule is all-or-nothing: an icon-only pill still names
    // its destination through the tooltip and the semantics label, whereas
    // "Setti" names nothing.
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
        _harness(index: 0, items: _fourItems, action: _action()));
    await tester.pumpAndSettle();

    final align = tester.widget<AnimatedAlign>(find.ancestor(
      of: find.text('Home'),
      matching: find.byType(AnimatedAlign),
    ));
    expect(align.widthFactor, 0.0);
    expect(tester.takeException(), isNull);
    // ...and the destination is still named.
    expect(find.bySemanticsLabel('Home'), findsOneWidget);
  });

  testWidgets('the create action does not report a tab selection',
      (tester) async {
    // It shares the bar with the destinations but is not one of them; firing
    // onSelect here would silently switch tabs on every create.
    final selected = <int>[];
    var created = 0;

    await tester.pumpWidget(_harness(
      index: 0,
      onSelect: selected.add,
      action: _action(onPressed: () => created++),
    ));

    await tester.tap(find.byIcon(Icons.add_rounded));
    await tester.pumpAndSettle();

    expect(created, 1);
    expect(selected, isEmpty);
  });

  testWidgets('tapping a destination reports its index', (tester) async {
    final selected = <int>[];
    await tester.pumpWidget(_harness(index: 0, onSelect: selected.add));

    await tester.tap(find.bySemanticsLabel('Settings'));
    await tester.pumpAndSettle();

    expect(selected, [2]);
  });

  testWidgets('renders in the light theme, where the bar stays dark',
      (tester) async {
    // The bar is dark in BOTH themes, so the light path is its own code path
    // (it drops the hairline that separates it from a black page).
    await tester.pumpWidget(_harness(
      index: 0,
      action: _action(),
      theme: AppTheme.lightTheme,
    ));
    expect(tester.takeException(), isNull);
    expect(find.bySemanticsLabel('Home'), findsOneWidget);
  });

  testWidgets('the selected destination is marked selected for a11y',
      (tester) async {
    await tester.pumpWidget(_harness(index: 1));

    final node = tester.getSemantics(find.bySemanticsLabel('Analytics'));
    expect(node.flagsCollection.isSelected, isTrue);

    final other = tester.getSemantics(find.bySemanticsLabel('Home'));
    expect(other.flagsCollection.isSelected, isFalse);
  });
}
