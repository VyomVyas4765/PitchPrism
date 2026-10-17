import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/speech.dart';
import '../intake/device.dart';
import '../intake/outbox.dart';
import '../intake/pitch_screen.dart';
import '../intake/services.dart';
import 'common.dart';
import 'consent_screen.dart';
import 'passport_screen.dart';
import 'profile_screen.dart';

/// After sign-in the server decides the next step: consent (M-03), then profile
/// (M-04), then home (M-05). The language chosen on the device is saved first.
class EntrepreneurShell extends StatefulWidget {
  const EntrepreneurShell({
    super.key,
    required this.api,
    required this.speech,
    required this.language,
    required this.onChangeLanguage,
    required this.onSignOut,
    this.services,
  });
  final ApiClient api;
  /// Device intake services; built for the signed-in account when not supplied (tests supply fakes).
  final IntakeServices Function(String account)? services;
  final Speech speech;
  final String language;
  final VoidCallback onChangeLanguage;
  final Future<void> Function() onSignOut;
  @override
  State<EntrepreneurShell> createState() => _EntrepreneurShellState();
}

class _EntrepreneurShellState extends State<EntrepreneurShell> {
  late final ctx = EntrepreneurContext(api: widget.api, speech: widget.speech, language: widget.language);
  int _version = 0;

  Future<Map<String, dynamic>> _load() async {
    try {
      final me = await widget.api.request('/me');
      if (me['language'] != widget.language) {
        return await widget.api.request('/me', method: 'PUT', body: {'language': widget.language});
      }
      return me;
    } on ApiException catch (error) {
      // Expired or revoked session: return to sign-in instead of retrying forever.
      if (error.status == 401) await widget.onSignOut();
      rethrow;
    }
  }

  void _refresh() => setState(() => _version++);

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('PitchPrism'),
      actions: [
        IconButton(tooltip: ctx.t('chooseLanguage'), onPressed: widget.onChangeLanguage, icon: const Icon(Icons.translate)),
        IconButton(tooltip: ctx.t('signOut'), onPressed: widget.onSignOut, icon: const Icon(Icons.logout)),
      ],
    ),
    body: SafeArea(
      child: LoadView<Map<String, dynamic>>(
        key: ValueKey(_version),
        retryLabel: ctx.t('retry'),
        load: _load,
        builder: (context, me, _) {
          final consents = me['consents'] as Map<String, dynamic>;
          final notice = me['noticeVersion'] as String;
          if (consents['processing'] == null) {
            return ConsentScreen(ctx: ctx, noticeVersion: notice, onDone: _refresh);
          }
          if (me['profileComplete'] != true) {
            return ProfileScreen(ctx: ctx, profile: me['profile'] as Map<String, dynamic>, onDone: _refresh);
          }
          final account = me['id'] as String;
          return HomeScreen(ctx: ctx, noticeVersion: notice,
            services: (widget.services ?? (id) => IntakeServices.device(widget.api, id))(account));
        },
      ),
    ),
  );
}

/// M-05: three large choices, each with a spoken label (M-19).
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.ctx, required this.noticeVersion, required this.services});
  final EntrepreneurContext ctx;
  final String noticeVersion;
  final IntakeServices services;
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  EntrepreneurContext get ctx => widget.ctx;

  @override
  void initState() {
    super.initState();
    // Anything recorded offline earlier is sent as soon as home opens with a connection (M-11).
    widget.services.sync.syncAll().catchError((Object _) => <OutboxItem>[]);
  }

  Future<void> _startPitch(String mode) async {
    final item = OutboxItem(clientDraftId: newClientId('draft'), mode: mode, language: ctx.language);
    await widget.services.upsert(item);
    if (!mounted) return;
    final sent = await Navigator.of(context).push(MaterialPageRoute<bool>(
      builder: (_) => PitchScreen(ctx: ctx, services: widget.services, item: item)));
    if (mounted && sent == true) showMessage(context, ctx.t('itemQueued'));
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(16),
    children: [
      for (final (key, icon) in [('speak', Icons.mic), ('type', Icons.keyboard), ('upload', Icons.upload_file)])
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Material(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(4),
            child: InkWell(
              key: Key('home-$key'),
              onTap: () => _startPitch(switch (key) { 'speak' => 'guided', 'type' => 'typed', _ => 'upload' }),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Row(children: [
                  Icon(icon, size: 48),
                  const SizedBox(width: 16),
                  Expanded(child: Text(ctx.t(key), style: Theme.of(context).textTheme.headlineMedium)),
                  ListenButton(context_: ctx, text: ctx.t(key)),
                ]),
              ),
            ),
          ),
        ),
      const SizedBox(height: 8),
      OutlinedButton.icon(
        key: const Key('home-passport'),
        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(56)),
        onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
          builder: (_) => PassportScreen(ctx: ctx, noticeVersion: widget.noticeVersion))),
        icon: const Icon(Icons.badge_outlined),
        label: Text(ctx.t('passport')),
      ),
      const SizedBox(height: 12),
      OutlinedButton.icon(
        key: const Key('home-ideas'),
        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(56)),
        onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => IdeasScreen(ctx: ctx))),
        icon: const Icon(Icons.timeline),
        label: Text(ctx.t('myIdeas')),
      ),
      const SizedBox(height: 12),
      OutlinedButton.icon(
        key: const Key('home-outbox'),
        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(56)),
        onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
          builder: (_) => OutboxScreen(ctx: ctx, services: widget.services))),
        icon: const Icon(Icons.cloud_upload_outlined),
        label: Text(ctx.t('outbox')),
      ),
    ],
  );
}
