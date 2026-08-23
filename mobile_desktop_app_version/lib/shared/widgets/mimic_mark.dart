// lib/shared/widgets/mimic_mark.dart
//
// MIMIC — the brand mark, drawn rather than shipped as an image.
//
// The mark is the chevron run: a continuous stroke that rises, dips, rises,
// dips and rises again. It reads as a waveform, which is what an interview
// actually is — turns of speech. Same path as web's MimicMark
// (`web_version/talbotiq-platform/src/components/brand/MimicMark.tsx`) and the
// same shape as the OS app icon (assets/icon.png), so the mark on a home
// screen, on the splash and inside the app are one form.
//
// Drawn, not a PNG, so it inherits the theme's ink and stays crisp at 20px and
// at 96px. The plate is INK with a GROUND-coloured chevron — it inverts with
// the theme and is deliberately not a pastel block: the mark is never the
// screen's one block. See [MimicWordmark] for the text half.

import 'package:flutter/material.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';

class MimicMark extends StatelessWidget {
  /// Edge length of the plate. Every other measurement here is derived from it
  /// — radius, glyph size and stroke weight — so the mark stays in proportion
  /// at any size instead of needing a per-size table.
  final double size;

  const MimicMark({super.key, this.size = 32});

  @override
  Widget build(BuildContext context) {
    // Centre rather than a bare Container: a Container with a width and height
    // still stretches under a tight parent constraint — a stretching Column, an
    // app bar title — and a stretched plate is no longer a mark. Align
    // shrink-wraps when the constraint is loose and centres the square when it
    // is not, so the plate is square in both.
    return Center(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: WarmSurfaces.ink(context),
          borderRadius: BorderRadius.circular(size * 0.25),
        ),
        child: Center(
          child: CustomPaint(
            size: Size.square(size * 0.53),
            painter: _ChevronPainter(color: WarmSurfaces.ground(context)),
          ),
        ),
      ),
    );
  }
}

class _ChevronPainter extends CustomPainter {
  final Color color;

  const _ChevronPainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    // Authored in the same 32-unit box as the web mark, then scaled, so the two
    // stay identical if either is retouched.
    const double box = 32;
    final double k = size.width / box;

    final path = Path()
      ..moveTo(7 * k, 21 * k)
      ..lineTo(7 * k, 11 * k)
      ..lineTo(12 * k, 17 * k)
      ..lineTo(16 * k, 11 * k)
      ..lineTo(20 * k, 17 * k)
      ..lineTo(25 * k, 11 * k)
      ..lineTo(25 * k, 21 * k);

    canvas.drawPath(
      path,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.6 * k
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(_ChevronPainter old) => old.color != color;
}
