import 'package:flutter_test/flutter_test.dart';
import 'package:pitchprism_app/core/speech.dart';

void main() {
  // Shapes match what AVSpeechSynthesisVoice reports through flutter_tts on iOS.
  final voices = [
    {'name': 'Lekha', 'locale': 'hi-IN', 'quality': 'default', 'identifier': 'com.apple.voice.compact.hi-IN.Lekha'},
    {'name': 'Lekha (Enhanced)', 'locale': 'hi-IN', 'quality': 'enhanced', 'identifier': 'com.apple.voice.enhanced.hi-IN.Lekha'},
    {'name': 'Samantha', 'locale': 'en-US', 'quality': 'default', 'identifier': 'com.apple.voice.compact.en-US.Samantha'},
    {'name': 'Rishi', 'locale': 'en-IN', 'quality': 'default', 'identifier': 'com.apple.voice.compact.en-IN.Rishi'},
    {'name': 'Bangla', 'locale': 'bn-BD', 'quality': 'default', 'identifier': 'com.apple.voice.compact.bn-BD'},
  ];

  test('prefers the exact Indian locale and the better quality voice', () {
    expect(pickVoice(voices, 'hi')!['name'], 'Lekha (Enhanced)');
    expect(pickVoice(voices, 'en')!['name'], 'Rishi');          // en-IN before en-US
  });

  test('falls back to another region of the same language, never to another language', () {
    expect(pickVoice(voices, 'bn')!['locale'], 'bn-BD');
    expect(pickVoice(voices, 'mr'), isNull);                    // no Marathi voice: reported as unavailable
    expect(pickVoice(voices, 'or'), isNull);
    expect(pickVoice(const [], 'hi'), isNull);
  });
}
