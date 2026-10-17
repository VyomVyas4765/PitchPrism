import 'package:flutter/material.dart';

import 'auth/auth_screen.dart';
import 'core/speech.dart';
import 'onboarding/language_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const PitchPrismApp());
}

class PitchPrismApp extends StatelessWidget {
  const PitchPrismApp({super.key, this.speech, this.languages = const LanguageStore()});
  final Speech? speech;
  final LanguageStore languages;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'PitchPrism',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xff1c1b18),
        surface: const Color(0xfff4efe4),
      ),
      scaffoldBackgroundColor: const Color(0xfff4efe4),
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56)),
      ),
    ),
    home: AppRoot(speech: speech ?? SystemSpeech(), languages: languages),
  );
}

/// M-01: the language picker comes first, before sign-in, and can be reopened later.
class AppRoot extends StatefulWidget {
  const AppRoot({super.key, required this.speech, required this.languages});
  final Speech speech;
  final LanguageStore languages;
  @override
  State<AppRoot> createState() => _AppRootState();
}

class _AppRootState extends State<AppRoot> {
  String? _language;
  bool _loaded = false;
  bool _choosing = false;

  @override
  void initState() {
    super.initState();
    widget.languages.read().then((language) {
      if (mounted) {
        setState(() {
          _language = language;
          _loaded = true;
        });
      }
    });
  }

  Future<void> _choose(String language) async {
    await widget.languages.write(language);
    if (mounted) {
      setState(() {
        _language = language;
        _choosing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final language = _language;
    if (language == null || _choosing) {
      return LanguageScreen(speech: widget.speech, selected: language, onChosen: _choose);
    }
    return AuthScreen(
      key: ValueKey(language),
      language: language,
      speech: widget.speech,
      onChangeLanguage: () => setState(() => _choosing = true),
    );
  }
}
