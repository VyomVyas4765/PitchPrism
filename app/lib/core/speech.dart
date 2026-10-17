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

class SystemSpeech implements Speech {
  final _tts = FlutterTts();

  @override
  Future<bool> isAvailable(String language) async {
    try {
      final result = await _tts.isLanguageAvailable(speechLocales[language]!);
      return result == true || result == 1;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<void> speak(String text, String language) async {
    if (!await isAvailable(language)) return;
    await _tts.stop();
    await _tts.setLanguage(speechLocales[language]!);
    await _tts.setSpeechRate(0.45);
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
