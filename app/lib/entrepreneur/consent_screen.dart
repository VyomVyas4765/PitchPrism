import 'package:flutter/material.dart';

import '../core/api.dart';
import 'common.dart';

/// M-03: the notice is read aloud in the chosen language. Processing consent is
/// required to continue; partner sharing is separate, optional and off by default.
class ConsentScreen extends StatefulWidget {
  const ConsentScreen({super.key, required this.ctx, required this.noticeVersion, required this.onDone});
  final EntrepreneurContext ctx;
  final String noticeVersion;
  final VoidCallback onDone;
  @override
  State<ConsentScreen> createState() => _ConsentScreenState();
}

class _ConsentScreenState extends State<ConsentScreen> {
  bool _processing = false;
  final _sharing = {'sector_partner': false, 'funding_partner': false};
  bool _saving = false;
  String? _error;

  Map<String, dynamic> _body(Map<String, dynamic> purpose) => {
    ...purpose,
    'noticeVersion': widget.noticeVersion,
    'language': widget.ctx.language,
    'method': 'app_tap',
  };

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.ctx.api.request('/consents', body: _body({'purpose': 'processing'}));
      for (final scope in _sharing.keys.where((scope) => _sharing[scope]!)) {
        await widget.ctx.api.request('/consents', body: _body({'purpose': 'partner_sharing', 'scope': scope}));
      }
      widget.onDone();
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } catch (_) {
      setState(() => _error = 'Cannot reach PitchPrism.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.ctx.t;
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Row(children: [
          Expanded(child: Text(t('consentTitle'), style: theme.textTheme.headlineMedium)),
          ListenButton(context_: widget.ctx, text: '${t('consentNotice')} ${t('consentProcessing')}'),
        ]),
        const SizedBox(height: 16),
        Text(t('consentNotice'), style: theme.textTheme.bodyLarge),
        const SizedBox(height: 16),
        CheckboxListTile(
          key: const Key('consent-processing'),
          value: _processing,
          onChanged: _saving ? null : (value) => setState(() => _processing = value ?? false),
          title: Text(t('consentProcessing')),
          controlAffinity: ListTileControlAffinity.leading,
        ),
        const Divider(height: 32),
        Row(children: [
          Expanded(child: Text(t('consentSharingTitle'), style: theme.textTheme.titleLarge)),
          ListenButton(context_: widget.ctx, text: '${t('consentSharingTitle')}. ${t('consentSharingHelp')}'),
        ]),
        Text(t('consentSharingHelp')),
        for (final scope in _sharing.keys)
          SwitchListTile(
            key: Key('share-$scope'),
            value: _sharing[scope]!,
            onChanged: _saving || !_processing ? null : (value) => setState(() => _sharing[scope] = value),
            title: Text(t(scope == 'sector_partner' ? 'shareSector' : 'shareFunding')),
          ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Semantics(liveRegion: true, child: Text(_error!, style: TextStyle(color: theme.colorScheme.error))),
          ),
        const SizedBox(height: 24),
        FilledButton(
          key: const Key('consent-save'),
          onPressed: _processing && !_saving ? _save : null,
          child: Text(t('continue')),
        ),
      ],
    );
  }
}
