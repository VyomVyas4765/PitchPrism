import 'package:flutter/material.dart';

import '../core/speech.dart';
import '../l10n/strings.dart';

/// M-01: the first screen. Each language says its own prompt aloud when the
/// phone has a voice for it; otherwise the tile says so plainly.
class LanguageScreen extends StatefulWidget {
  const LanguageScreen({
    super.key,
    required this.speech,
    required this.onChosen,
    this.selected,
  });
  final Speech speech;
  final ValueChanged<String> onChosen;
  final String? selected;
  @override
  State<LanguageScreen> createState() => _LanguageScreenState();
}

class _LanguageScreenState extends State<LanguageScreen> {
  final _voices = <String, bool>{};

  @override
  void initState() {
    super.initState();
    for (final language in launchLanguages) {
      widget.speech.isAvailable(language).then((available) {
        if (mounted) setState(() => _voices[language] = available);
      });
    }
  }

  @override
  void dispose() {
    widget.speech.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('PitchPrism')),
    body: SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          for (final language in launchLanguages)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _LanguageTile(
                language: language,
                selected: widget.selected == language,
                voice: _voices[language],
                onListen: () => widget.speech.speak(
                  tr(language, 'chooseLanguage'),
                  language,
                ),
                onChoose: () => widget.onChosen(language),
              ),
            ),
        ],
      ),
    ),
  );
}

class _LanguageTile extends StatelessWidget {
  const _LanguageTile({
    required this.language,
    required this.selected,
    required this.voice,
    required this.onListen,
    required this.onChoose,
  });
  final String language;
  final bool selected;
  final bool? voice;
  final VoidCallback onListen;
  final VoidCallback onChoose;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: selected ? theme.colorScheme.primaryContainer : theme.colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(4),
      child: InkWell(
        key: Key('language-$language'),
        onTap: onChoose,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(tr(language, 'languageName'), style: theme.textTheme.headlineSmall),
                    Text(tr(language, 'chooseLanguage'), style: theme.textTheme.titleMedium),
                    if (voice == false)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(tr(language, 'voiceUnavailable'), style: theme.textTheme.bodySmall),
                      ),
                  ],
                ),
              ),
              IconButton.filledTonal(
                key: Key('listen-$language'),
                iconSize: 32,
                constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
                tooltip: tr(language, 'listen'),
                onPressed: voice == true ? onListen : null,
                icon: const Icon(Icons.volume_up),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
