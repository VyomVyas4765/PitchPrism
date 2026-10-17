import 'package:flutter/material.dart';

import 'auth/auth_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const PitchPrismApp());
}

class PitchPrismApp extends StatelessWidget {
  const PitchPrismApp({super.key});
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
    home: const AuthScreen(),
  );
}
