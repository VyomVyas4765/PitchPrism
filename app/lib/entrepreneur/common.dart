import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/speech.dart';
import '../l10n/strings.dart';

/// Everything an entrepreneur screen needs, passed down explicitly so tests can fake it.
class EntrepreneurContext {
  const EntrepreneurContext({required this.api, required this.speech, required this.language});
  final ApiClient api;
  final Speech speech;
  final String language;
  String t(String key) => tr(language, key);
}

/// Loading, error-with-retry and content states for one API read.
class LoadView<T> extends StatefulWidget {
  const LoadView({super.key, required this.load, required this.builder, required this.retryLabel});
  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data, VoidCallback reload) builder;
  final String retryLabel;
  @override
  State<LoadView<T>> createState() => _LoadViewState<T>();
}

class _LoadViewState<T> extends State<LoadView<T>> {
  late Future<T> _future = widget.load();
  // A block body: setState must not return the Future, or Flutter rejects the call.
  void _reload() => setState(() {
    _future = widget.load();
  });
  @override
  Widget build(BuildContext context) => FutureBuilder<T>(
    future: _future,
    builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) {
        return const Center(child: CircularProgressIndicator());
      }
      if (snapshot.hasError) {
        final error = snapshot.error;
        return Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Semantics(liveRegion: true, child: Text(error is ApiException ? error.message : 'Cannot reach PitchPrism.')),
                const SizedBox(height: 16),
                FilledButton(onPressed: _reload, child: Text(widget.retryLabel)),
              ],
            ),
          ),
        );
      }
      return widget.builder(context, snapshot.data as T, _reload);
    },
  );
}

/// A large speaker button that reads [text] aloud in the person's language.
class ListenButton extends StatelessWidget {
  const ListenButton({super.key, required this.context_, required this.text});
  final EntrepreneurContext context_;
  final String text;
  @override
  Widget build(BuildContext context) => IconButton.filledTonal(
    iconSize: 32,
    constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
    tooltip: context_.t('listen'),
    onPressed: () => context_.speech.speak(text, context_.language),
    icon: const Icon(Icons.volume_up),
  );
}

/// A visible way to close iOS number pads, which have no native Done key.
class KeyboardDismissBar extends StatelessWidget {
  const KeyboardDismissBar({super.key, required this.label, this.onDismiss});
  final String label;
  final VoidCallback? onDismiss;

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.viewInsetsOf(context).bottom == 0) return const SizedBox.shrink();
    return Material(
      color: Theme.of(context).colorScheme.surfaceContainerHigh,
      child: SizedBox(height: 48, child: Align(
        alignment: Alignment.centerRight,
        child: TextButton.icon(
          key: const Key('keyboard-dismiss'),
          onPressed: () {
            FocusScope.of(context).unfocus();
            onDismiss?.call();
          },
          icon: const Icon(Icons.keyboard_hide),
          label: Text(label),
        ),
      )),
    );
  }
}

void showMessage(BuildContext context, String message) =>
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
