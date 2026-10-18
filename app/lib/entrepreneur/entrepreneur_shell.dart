import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/speech.dart';
import '../intake/pitch_screen.dart' show OutboxScreen;
import '../intake/outbox.dart';
import '../intake/services.dart';
import 'chat_screen.dart';
import 'common.dart';
import 'consent_screen.dart';
import 'ideas_dashboard.dart';
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
          if (me['onboardingComplete'] != true) {
            return ProfileScreen(ctx: ctx, profile: Map<String, dynamic>.from(me['profile'] as Map? ?? const {}), onDone: _refresh);
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

  late Future<List<Map<String, dynamic>>> _chats = _loadChats();

  /// Chats already started (the opening reply was sent), newest first, to continue answering.
  Future<List<Map<String, dynamic>>> _loadChats() async {
    final data = await ctx.api.request('/pitches');
    return ((data['pitches'] as List?) ?? []).cast<Map<String, dynamic>>()
        .where((pitch) => pitch['mode'] == 'chat' && pitch['status'] == 'SUBMITTED').take(5).toList();
  }

  Future<void> _openChat([String? pitchId]) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => ChatScreen(ctx: ctx, services: widget.services, pitchId: pitchId)));
    if (!mounted) return;
    setState(() {
      _chats = _loadChats();
    });
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(16),
    children: [
      // M-05: one clear starting point. The AI asks; the person answers by typing, speaking or sending their form.
      Material(
        color: Theme.of(context).colorScheme.primaryContainer,
        borderRadius: BorderRadius.circular(4),
        child: InkWell(
          key: const Key('home-chat'),
          onTap: _openChat,
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Row(children: [
              const Icon(Icons.chat_bubble_outline, size: 48),
              const SizedBox(width: 16),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(ctx.t('chatStart'), style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 4),
                Text(ctx.t('chatStartHelp')),
              ])),
              ListenButton(context_: ctx, text: '${ctx.t('chatStart')}. ${ctx.t('chatStartHelp')}'),
            ]),
          ),
        ),
      ),
      FutureBuilder<List<Map<String, dynamic>>>(
        future: _chats,
        builder: (context, snapshot) => Column(children: [
          for (final (index, chat) in (snapshot.data ?? const <Map<String, dynamic>>[]).indexed)
            ListTile(
              key: Key('home-chat-${chat['id']}'),
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.forum_outlined),
              title: Text(chat['title'] as String? ?? (index == 0 ? ctx.t('chatContinue') : '${ctx.t('chatContinue')} (${index + 1})')),
              // Where the idea stands, e.g. "Decision: shortlisted" once the evaluator decides.
              subtitle: chat['submissionStatus'] == null ? null : Text(ctx.t('status${chat['submissionStatus']}'),
                style: ['SHORTLISTED', 'NOT_YET', 'MORE_INFO'].contains(chat['submissionStatus'])
                    ? TextStyle(fontWeight: FontWeight.w700, color: Theme.of(context).colorScheme.primary) : null),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _openChat(chat['id'] as String),
            ),
        ]),
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
        onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => MyIdeasScreen(ctx: ctx, services: widget.services))),
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
