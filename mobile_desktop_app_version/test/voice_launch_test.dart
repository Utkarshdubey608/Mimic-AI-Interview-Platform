import 'package:flutter_test/flutter_test.dart';
import 'package:talbotiq/features/interviews/candidate/voice_launch.dart';

void main() {
  test('voice response cleaning removes ASR noise markers only', () {
    expect(
      cleanVoiceResponses([
        'I built a Flutter application.',
        '<noise>',
        '   [silence] ',
        'I distribute the work among my peers.',
      ]),
      [
        'I built a Flutter application.',
        'I distribute the work among my peers.',
      ],
    );
  });
}
