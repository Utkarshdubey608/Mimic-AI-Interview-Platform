// lib/widgets/custom_buttons.dart
import 'package:flutter/material.dart';

enum ButtonVariant { primary, secondary, outline, ghost, danger }

class CustomButton extends StatelessWidget {
  final String text;
  final VoidCallback onPressed;
  final bool isLoading;
  final ButtonVariant variant;
  final double? width;
  final double height;
  final Widget? icon;

  const CustomButton({
    super.key,
    required this.text,
    required this.onPressed,
    this.isLoading = false,
    this.variant = ButtonVariant.primary,
    this.width,
    this.height = 48, // Standardised M3 touch target height
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    // Read colors from the active theme so buttons are legible in both light
    // and dark mode. In dark mode the scheme resolves to the same AppColors
    // values used before, so the primary/filled look is unchanged.
    final scheme = Theme.of(context).colorScheme;
    Color bg;
    Color textCol;
    BorderSide border = BorderSide.none;

    switch (variant) {
      case ButtonVariant.primary:
        bg = scheme.primary;
        textCol = scheme.onPrimary; // High contrast text on the primary fill
        break;
      case ButtonVariant.secondary:
        bg = scheme.surface;
        textCol = scheme.onSurface;
        border = BorderSide(color: scheme.outline, width: 1);
        break;
      case ButtonVariant.outline:
        bg = Colors.transparent;
        textCol = scheme.onSurface;
        border = BorderSide(color: scheme.outline, width: 1);
        break;
      case ButtonVariant.ghost:
        bg = Colors.transparent;
        textCol = scheme.onSurfaceVariant;
        break;
      case ButtonVariant.danger:
        bg = scheme.error.withOpacity(0.12);
        textCol = scheme.error;
        border = BorderSide(color: scheme.error.withOpacity(0.4), width: 1);
        break;
    }

    final childWidget = Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (isLoading) ...[
          SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              valueColor: AlwaysStoppedAnimation<Color>(textCol),
            ),
          ),
          const SizedBox(width: 8),
        ] else if (icon != null) ...[
          icon!,
          const SizedBox(width: 8),
        ],
        // Flexible so a long label ellipsizes inside a tight/fixed-width button
        // instead of overflowing the Row.
        Flexible(
          child: Text(
            text,
            maxLines: 1,
            softWrap: false,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: textCol,
              fontSize: 14,
              fontWeight: FontWeight.w500, // M3 label font weight
              fontFamily: 'Inter',
            ),
          ),
        ),
      ],
    );

    return SizedBox(
      width: width,
      height: height,
      child: TextButton(
        onPressed: isLoading ? null : onPressed,
        style: TextButton.styleFrom(
          backgroundColor: bg,
          side: border,
          shape: RoundedRectangleBorder(
            // Generously rounded, but not a stadium: buttons should read as
            // part of the same family as the cards around them.
            borderRadius: BorderRadius.circular(18),
          ),
          padding: EdgeInsets.symmetric(horizontal: 24, vertical: height >= 48 ? 12 : 6),
        ),
        child: childWidget,
      ),
    );
  }
}
