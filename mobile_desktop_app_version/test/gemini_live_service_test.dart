import 'package:flutter_test/flutter_test.dart';
import 'package:talbotiq/core/services/gemini_live_service.dart';

void main() {
  group('interviewer playback echo guard', () {
    test('filters a question replayed through the microphone', () {
      expect(
        isLikelyInterviewerPlaybackEcho(
          'Tell me about yourself and your background',
          'Hey, first question. Tell me about yourself and your background.',
        ),
        isTrue,
      );
    });

    test('keeps a genuine candidate response', () {
      expect(
        isLikelyInterviewerPlaybackEcho(
          'I have worked in mobile engineering for five years',
          'Tell me about yourself and your background',
        ),
        isFalse,
      );
    });

    test('keeps short acknowledgements', () {
      expect(
        isLikelyInterviewerPlaybackEcho('Yes, I am ready', 'Yes, I am ready'),
        isFalse,
      );
    });
  });
}
