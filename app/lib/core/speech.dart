import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_tts/flutter_tts.dart';

/// Launch languages (PRD §6) and the system-speech locale used for each.
const launchLanguages = ['hi', 'mr', 'te', 'or', 'bn', 'en'];
const speechLocales = {
  'hi': 'hi-IN',
  'mr': 'mr-IN',
  'te': 'te-IN',
  'or': 'or-IN',
  'bn': 'bn-IN',
  'en': 'en-IN',
};

/// Spoken prompts through the phone's own speech engine (D-24: no bundled model,
/// no hosted voice). Availability is checked per device and per language, and a
/// missing voice is reported, never silently replaced by another language.
abstract class Speech {
  Future<bool> isAvailable(String language);
  Future<void> speak(String text, String language);
  Future<void> stop();
}

/// Picks the best installed voice for a launch language from the platform's voice list:
/// exact locale first (e.g. hi-IN), then any voice for the language; premium/enhanced before default.
/// Returns null when the phone has no voice for that language, which the UI reports plainly.
Map<String, String>? pickVoice(List<Map<String, String>> voices, String language) {
  final exact = speechLocales[language]!.toLowerCase();
  int rank(Map<String, String> voice) {
    final locale = (voice['locale'] ?? '').toLowerCase().replaceAll('_', '-');
    final localeScore = locale == exact ? 2 : locale.split('-').first == language ? 1 : 0;
    final quality = switch ((voice['quality'] ?? '').toLowerCase()) { 'premium' => 2, 'enhanced' => 1, _ => 0 };
    return localeScore * 10 + quality;
  }
  final candidates = voices.where((voice) => rank(voice) >= 10).toList()..sort((a, b) => rank(b) - rank(a));
  return candidates.isEmpty ? null : candidates.first;
}

/// iPhone speech through AVSpeechSynthesizer (D-27: iOS is the build target).
class SystemSpeech implements Speech {
  final _tts = FlutterTts();
  final _voices = <String, Map<String, String>?>{};
  List<Map<String, String>>? _installed;

  Future<List<Map<String, String>>> _installedVoices() async {
    if (_installed != null) return _installed!;
    try {
      final raw = await _tts.getVoices as List? ?? const [];
      _installed = [for (final voice in raw) if (voice is Map) voice.map((key, value) => MapEntry('$key', '$value'))];
    } catch (_) {
      _installed = const [];
    }
    return _installed!;
  }

  // Looked up once per language per app run (a newly added iPhone voice shows after a restart).
  Future<Map<String, String>?> _voiceFor(String language) async {
    if (_voices.containsKey(language)) return _voices[language];
    return _voices[language] = pickVoice(await _installedVoices(), language);
  }

  @override
  Future<bool> isAvailable(String language) async => await _voiceFor(language) != null;

  @override
  Future<void> speak(String text, String language) async {
    final voice = await _voiceFor(language);
    if (voice == null) return;
    await _tts.stop();
    if (Platform.isIOS) {
      // Playback category so prompts are heard with the silent switch on, and so speech after a
      // recording leaves the earpiece; spokenAudio pauses podcasts/music politely.
      await _tts.setSharedInstance(true);
      await _tts.setIosAudioCategory(IosTextToSpeechAudioCategory.playback,
          [IosTextToSpeechAudioCategoryOptions.duckOthers], IosTextToSpeechAudioMode.spokenAudio);
    }
    await _tts.awaitSpeakCompletion(true);
    await _tts.setVoice(voice);
    await _tts.setSpeechRate(0.45); // iOS: 0.5 is the normal rate; slightly slower for new readers
    await _tts.speak(text);
  }

  @override
  Future<void> stop() async => _tts.stop();
}

/// The chosen language stays on the device so the first screen is in the
/// person's language even before sign-in.
class LanguageStore {
  const LanguageStore();
  static const _storage = FlutterSecureStorage();
  Future<String?> read() async {
    final value = await _storage.read(key: 'language');
    return launchLanguages.contains(value) ? value : null;
  }

  Future<void> write(String language) =>
      _storage.write(key: 'language', value: language);
}
