import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';

import '../core/api.dart';
import '../intake/device.dart';
import '../intake/outbox.dart' show chunkBytes;
import '../intake/services.dart';
import 'common.dart';

/// M-05 chat intake: the AI asks for the idea in the person's language and they reply by typing, a voice note or a
/// PDF/photo of their filled form (the most reliable to read and translate). The server's pitch review (D-33) keeps
/// asking until every field is covered, then the idea is evaluated. Every AI message has a speaker button, and new
/// ones are read aloud automatically while "Read aloud" is on.
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.ctx, required this.services, this.pitchId,
      this.pollEvery = const Duration(seconds: 4)});
  final EntrepreneurContext ctx;
  final IntakeServices services;
  final String? pitchId;
  final Duration pollEvery;
  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  EntrepreneurContext get ctx => widget.ctx;
  ApiClient get api => ctx.api;

  String? _pitchId;
  String? _centreId;
  Map<String, dynamic>? _view;
  List<Map<String, dynamic>>? _centres;
  String? _error;
  bool _busy = false;
  bool _readAloud = true;
  Recorder? _recorder;
  bool _loadedOnce = false;
  Timer? _poll;
  final _spoken = <String>{};
  final _text = TextEditingController();
  final _scroll = ScrollController();

  String get _state => (_view?['state'] as String?) ?? 'start';
  List<Map<String, dynamic>> get _messages => ((_view?['messages'] as List?) ?? []).cast<Map<String, dynamic>>();

  @override
  void initState() {
    super.initState();
    _pitchId = widget.pitchId;
    if (_pitchId != null) {
      _load();
    } else {
      _loadCentres();
      WidgetsBinding.instance.addPostFrameCallback((_) => _say('opening', ctx.t('chatOpening'), ctx.language));
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    _recorder?.dispose();
    _text.dispose();
    _scroll.dispose();
    ctx.speech.stop();
    super.dispose();
  }

  // ---- reading aloud
  void _say(String key, String text, String language) {
    if (_spoken.add(key) && _readAloud) ctx.speech.speak(text, language);
  }

  void _speakNew() {
    final assistant = _messages.where((message) => message['role'] == 'assistant').toList();
    if (!_loadedOnce) {
      // Reopening a chat reads only the questions still waiting for a reply, not the whole history.
      _loadedOnce = true;
      final latest = _state == 'your_turn' && assistant.isNotEmpty ? assistant.last['round'] : null;
      for (final message in assistant) {
        if (message['round'] != latest) _spoken.add(message['qId'] as String);
      }
    }
    final fresh = assistant.where((message) => !_spoken.contains(message['qId'])).toList();
    for (final message in fresh) {
      _say(message['qId'] as String, message['text'] as String, message['lang'] as String? ?? ctx.language);
    }
    if (_state == 'complete') _say('done', ctx.t('followUpDone'), ctx.language);
    if (_state == 'failed') _say('failed-${_view?['round']}', ctx.t('chatFailed'), ctx.language);
  }

  // ---- server
  Future<void> _loadCentres() async {
    try {
      final data = await api.request('/centres');
      if (!mounted) return;
      final centres = ((data['centres'] as List?) ?? []).cast<Map<String, dynamic>>();
      setState(() {
        _centres = centres;
        if (centres.length == 1) _centreId = centres.single['id'] as String;
      });
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = ctx.t('offline'));
    }
  }

  void _show(Map<String, dynamic> view) {
    if (!mounted) return;
    setState(() {
      _view = view;
      _error = null;
    });
    _speakNew();
    _poll?.cancel();
    // While the AI reads a reply (a voice note or a PDF can take a minute), check back for its next message.
    if (_state == 'reading') _poll = Timer(widget.pollEvery, _load);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    });
  }

  Future<void> _load() async {
    try {
      _show(await api.request('/pitches/$_pitchId/chat'));
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = ctx.t('offline'));
    }
  }

  Future<String> _ensurePitch() async {
    final existing = _pitchId;
    if (existing != null) return existing;
    final created = await api.request('/pitches', body: {
      'clientDraftId': newClientId('chat'), 'mode': 'chat', 'language': ctx.language, if (_centreId != null) 'centreId': _centreId,
    });
    return _pitchId = created['id'] as String;
  }

  Future<void> _send(Future<Map<String, dynamic>> Function(String pitchId) action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      _show(await action(await _ensurePitch()));
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message);
    } catch (_) {
      if (mounted) showMessage(context, ctx.t('offline'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendText() async {
    final text = _text.text.trim();
    if (text.isEmpty) return;
    await _send((id) async {
      final view = await api.request('/pitches/$id/chat', body: {'text': text});
      _text.clear();
      return view;
    });
  }

  /// Uploads one file resumably, then sends it as the reply.
  Future<void> _sendFile(String path, String kind, String mime) => _send((id) async {
    final file = await describeFile(path, kind: kind, mime: mime, prefix: 'chat');
    final document = await api.request('/pitches/$id/documents', body: {
      'clientFileId': file.clientFileId, 'kind': kind, 'bytes': file.bytes, 'sha256': file.sha256, 'mime': mime,
    });
    final documentId = document['id'] as String;
    final data = await File(path).readAsBytes();
    var offset = (document['receivedBytes'] as num).toInt();
    var state = document['state'] as String;
    while (state == 'receiving' && offset < data.length) {
      final end = offset + chunkBytes < data.length ? offset + chunkBytes : data.length;
      final result = await api.uploadChunk(documentId, offset, data.sublist(offset, end));
      final next = (result['receivedBytes'] as num).toInt();
      state = result['state'] as String;
      if (state == 'receiving' && next == offset) throw ApiException(ctx.t('offline'), 409);
      offset = next;
    }
    return api.request('/pitches/$id/chat', body: {'documentId': documentId});
  });

  Future<void> _attach() async {
    final picked = await widget.services.pickFile();
    if (picked == null) return;
    final type = classifyPicked(picked.name);
    if (type == null) {
      if (mounted) showMessage(context, ctx.t('chatFileType'));
      return;
    }
    await _sendFile(picked.path, type.kind, type.mime);
  }

  Future<void> _toggleRecording() async {
    final recorder = _recorder;
    if (recorder != null) {
      final path = await recorder.stop();
      await recorder.dispose();
      setState(() => _recorder = null);
      if (path != null) await _sendFile(path, 'audio', 'audio/mp4');
      return;
    }
    final next = widget.services.recorder();
    if (!await next.hasPermission()) {
      await next.dispose();
      if (mounted) showMessage(context, ctx.t('micDenied'));
      return;
    }
    await ctx.speech.stop();
    final directory = await widget.services.directory();
    await next.start('${directory.path}${Platform.pathSeparator}${newClientId('voice')}.m4a');
    if (mounted) setState(() => _recorder = next);
  }

  Future<void> _retry() => _send((id) => api.request('/pitches/$id/chat/retry', body: {}));

  // ---- view
  bool get _canReply => !_busy && (_pitchId == null ? _centreId != null : ['start', 'your_turn', 'failed'].contains(_state));

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final items = <Widget>[
      _assistant(ctx.t('chatOpening'), ctx.language, key: const Key('chat-opening')),
      if (_pitchId == null && (_centres?.length ?? 0) > 1) _centreChoice(),
      for (final message in _messages)
        message['role'] == 'assistant'
            ? _assistant(message['text'] as String, message['lang'] as String? ?? ctx.language, key: Key('chat-q-${message['qId']}'))
            : _user(message),
      if (_state == 'reading' || _busy) _reading(),
      if (_state == 'complete') _assistant(ctx.t('followUpDone'), ctx.language, key: const Key('chat-done')),
      if (_state == 'complete' && _view?['brief'] is List) _brief((_view!['brief'] as List).cast<Map<String, dynamic>>()),
      if (_state == 'failed' && !_busy) _failed(),
    ];
    return Scaffold(
      appBar: AppBar(title: Text(ctx.t('chatTitle')), actions: [
        IconButton(
          key: const Key('chat-read-aloud'),
          tooltip: ctx.t('chatReadAloud'),
          isSelected: _readAloud,
          icon: const Icon(Icons.volume_off),
          selectedIcon: const Icon(Icons.volume_up),
          onPressed: () {
            setState(() => _readAloud = !_readAloud);
            if (!_readAloud) ctx.speech.stop();
          },
        ),
      ]),
      body: SafeArea(child: Column(children: [
        if (_error != null)
          Material(color: theme.colorScheme.errorContainer, child: ListTile(
            title: Semantics(liveRegion: true, child: Text(_error!)),
            trailing: TextButton(onPressed: _pitchId == null ? _loadCentres : _load, child: Text(ctx.t('retry'))),
          )),
        Expanded(child: ListView(controller: _scroll, padding: const EdgeInsets.all(12), children: items)),
        if (_state != 'complete') _composer(theme),
      ])),
    );
  }

  Widget _bubble({required bool mine, required Widget child, Key? key}) {
    final scheme = Theme.of(context).colorScheme;
    return Align(
      key: key,
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.82),
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 6),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: mine ? scheme.primaryContainer : scheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(12),
          ),
          child: child,
        ),
      ),
    );
  }

  Widget _assistant(String text, String language, {Key? key}) => _bubble(mine: false, key: key, child: Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(text, style: Theme.of(context).textTheme.titleMedium),
        if (language != ctx.language)
          Padding(padding: const EdgeInsets.only(top: 4), child: Text(ctx.t('chatShownInEnglish'),
            style: Theme.of(context).textTheme.bodySmall?.copyWith(fontStyle: FontStyle.italic))),
      ])),
      IconButton(
        tooltip: ctx.t('listen'),
        constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
        onPressed: () => ctx.speech.speak(text, language),
        icon: const Icon(Icons.volume_up),
      ),
    ],
  ));

  Widget _user(Map<String, dynamic> message) {
    final kind = message['kind'] as String;
    final text = message['text'] as String?;
    final (icon, label) = switch (kind) {
      'audio' => (Icons.mic, ctx.t('chatVoiceNote')),
      'pdf' => (Icons.picture_as_pdf, ctx.t('chatPdf')),
      'image' => (Icons.image, ctx.t('chatPhoto')),
      _ => (null, text ?? ''),
    };
    return _bubble(mine: true, key: Key('chat-reply-${message['round']}'), child: Row(mainAxisSize: MainAxisSize.min, children: [
      if (icon != null) Padding(padding: const EdgeInsets.only(right: 8), child: Icon(icon)),
      Flexible(child: Text(label, style: Theme.of(context).textTheme.titleMedium)),
    ]));
  }

  Widget _centreChoice() => _bubble(mine: false, key: const Key('chat-centres'), child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(ctx.t('chooseCentre'), style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 8),
      Wrap(spacing: 8, runSpacing: 8, children: [
        for (final centre in _centres!)
          ChoiceChip(
            key: Key('chat-centre-${centre['id']}'),
            label: Text(centre['name'] as String),
            selected: _centreId == centre['id'],
            onSelected: (_) => setState(() => _centreId = centre['id'] as String),
          ),
      ]),
    ],
  ));

  /// What the Business Idea Brief says, question by question, so the person can check it (answers are in English).
  Widget _brief(List<Map<String, dynamic>> rows) => _bubble(mine: false, key: const Key('chat-brief'), child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(ctx.t('chatBriefTitle'), style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 8),
      for (final row in rows)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${row['number']}. ${row['question']}', style: Theme.of(context).textTheme.labelLarge),
            Text(row['state'] == 'answered' ? row['response'] as String : ctx.t(row['state'] == 'declined' ? 'chatBriefDeclined' : 'chatBriefMissing'),
              style: row['state'] == 'answered' ? null : const TextStyle(fontStyle: FontStyle.italic)),
          ]),
        ),
    ],
  ));

  Widget _reading() => _bubble(mine: false, key: const Key('chat-reading'), child: Row(mainAxisSize: MainAxisSize.min, children: [
    const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
    const SizedBox(width: 12),
    Flexible(child: Semantics(liveRegion: true, child: Text(ctx.t(_busy ? 'chatSending' : 'chatReading')))),
  ]));

  Widget _failed() => _bubble(mine: false, key: const Key('chat-failed'), child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(ctx.t('chatFailed'), style: Theme.of(context).textTheme.titleMedium),
      TextButton.icon(key: const Key('chat-retry'), onPressed: _retry, icon: const Icon(Icons.refresh), label: Text(ctx.t('retry'))),
    ],
  ));

  Widget _composer(ThemeData theme) {
    final enabled = _canReply;
    final recording = _recorder != null;
    return Material(
      elevation: 4,
      color: theme.colorScheme.surface,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Row(children: [
            Expanded(child: FilledButton.icon(
              key: const Key('chat-attach'),
              onPressed: enabled && !recording ? _attach : null,
              icon: const Icon(Icons.upload_file),
              label: Text(ctx.t('chatAttach'), textAlign: TextAlign.center),
            )),
            const SizedBox(width: 8),
            Expanded(child: FilledButton.tonalIcon(
              key: const Key('chat-record'),
              style: recording ? FilledButton.styleFrom(backgroundColor: theme.colorScheme.error, foregroundColor: theme.colorScheme.onError) : null,
              onPressed: enabled || recording ? _toggleRecording : null,
              icon: Icon(recording ? Icons.stop : Icons.mic),
              label: Text(ctx.t(recording ? 'chatStopVoice' : 'chatVoice'), textAlign: TextAlign.center),
            )),
          ]),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: TextField(
              key: const Key('chat-input'),
              controller: _text,
              enabled: enabled && !recording,
              minLines: 1,
              maxLines: 4,
              maxLength: 4000,
              textInputAction: TextInputAction.newline,
              decoration: InputDecoration(hintText: ctx.t('chatHint'), counterText: ''),
            )),
            const SizedBox(width: 8),
            IconButton.filled(
              key: const Key('chat-send'),
              tooltip: ctx.t('chatSend'),
              constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
              onPressed: enabled && !recording ? _sendText : null,
              icon: const Icon(Icons.send),
            ),
          ]),
        ]),
      ),
    );
  }
}
