import 'dart:io';

import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';

import '../core/api.dart';
import '../entrepreneur/common.dart';
import 'outbox.dart';
import 'services.dart';

/// M-08: what the system heard or read, in the speaker's own script with English beside it.
/// Each spoken part plays its own moment of the recording; tapping a part corrects it.
/// Saving creates a new version on the server; the machine reading stays as version 1.
class TranscriptScreen extends StatefulWidget {
  const TranscriptScreen({super.key, required this.ctx, required this.services, required this.item, this.player});
  final EntrepreneurContext ctx;
  final IntakeServices services;
  final OutboxItem item;
  final AudioPlayer? player;
  @override
  State<TranscriptScreen> createState() => _TranscriptScreenState();
}

class _TranscriptScreenState extends State<TranscriptScreen> {
  late Future<Map<String, dynamic>> _load = _fetch();
  final _edits = <String, String>{};
  bool _saving = false;
  AudioPlayer? _player;

  EntrepreneurContext get ctx => widget.ctx;
  Future<Map<String, dynamic>> _fetch() => widget.services.api.request('/pitches/${widget.item.pitchId}/transcript');

  @override
  void dispose() {
    _player?.dispose();
    super.dispose();
  }

  void _reload() => setState(() {
    _edits.clear();
    _load = _fetch();
  });

  Future<void> _retry() async {
    try {
      await widget.services.api.request('/pitches/${widget.item.pitchId}/process', body: {});
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message);
    }
    _reload();
  }

  /// The recording on this phone if it is still here; otherwise the owner's copy from the server.
  Future<String> _localFile(String documentId) async {
    final local = widget.item.files.where((file) => file.documentId == documentId).firstOrNull;
    if (local != null && await File(local.path).exists()) return local.path;
    final dir = await widget.services.directory();
    final cached = File('${dir.path}${Platform.pathSeparator}play-$documentId.m4a');
    if (!await cached.exists()) await cached.writeAsBytes(await widget.services.api.download('/documents/$documentId/original'));
    return cached.path;
  }

  Future<void> _play(Map<String, dynamic> source) async {
    try {
      final player = _player ??= widget.player ?? AudioPlayer();
      await player.setFilePath(await _localFile(source['documentId'] as String));
      final start = Duration(milliseconds: (((source['start'] as num?) ?? 0) * 1000).round());
      final end = source['end'] == null ? null : Duration(milliseconds: ((source['end'] as num) * 1000).round());
      await player.setClip(start: start, end: end);
      await player.play();
    } catch (_) {
      if (mounted) showMessage(context, 'Cannot play this part.');
    }
  }

  Future<void> _edit(Map<String, dynamic> segment) async {
    final text = await showDialog<String>(
      context: context,
      builder: (_) => _EditDialog(title: ctx.t('transcriptEdit'), initial: _edits[segment['segId']] ?? segment['textOriginal'] as String? ?? ''),
    );
    if (text != null && text.isNotEmpty && text != segment['textOriginal']) setState(() => _edits[segment['segId'] as String] = text);
  }

  Future<void> _save(int baseVersion) async {
    setState(() => _saving = true);
    try {
      await widget.services.api.request('/pitches/${widget.item.pitchId}/transcript', method: 'PUT', body: {
        'baseVersion': baseVersion,
        'edits': [for (final entry in _edits.entries) {'segId': entry.key, 'text': entry.value}],
      });
      _reload();
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(ctx.t('transcript'))),
    body: FutureBuilder<Map<String, dynamic>>(
      future: _load,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
        if (snapshot.hasError) {
          return Center(child: FilledButton(onPressed: _reload, child: Text(ctx.t('retry'))));
        }
        final data = snapshot.data!;
        final pipeline = data['pipeline'] as String;
        final transcript = data['transcript'] as Map<String, dynamic>?;
        final segments = ((transcript?['segments'] as List?) ?? const []).cast<Map<String, dynamic>>();
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (pipeline == 'processing' || pipeline == 'pending_queue')
              ListTile(leading: const CircularProgressIndicator(), title: Text(ctx.t('pipelineProcessing')),
                trailing: IconButton(onPressed: _reload, icon: const Icon(Icons.refresh))),
            if (pipeline == 'pending_capability' || pipeline == 'failed') ...[
              ListTile(leading: const Icon(Icons.hourglass_empty), title: Text(ctx.t(pipeline == 'failed' ? 'pipelineFailed' : 'pipelinePending'))),
              OutlinedButton(key: const Key('transcript-retry'), onPressed: _retry, child: Text(ctx.t('retryProcessing'))),
            ],
            if (segments.isEmpty && pipeline == 'transcribed') Text(ctx.t('noTranscript')),
            for (final segment in segments)
              Card(
                child: InkWell(
                  key: Key('segment-${segment['segId']}'),
                  onTap: () => _edit(segment),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(_edits[segment['segId']] ?? segment['textOriginal'] as String? ?? '',
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            decoration: segment['struck'] == true ? TextDecoration.lineThrough : null)),
                        if (segment['textEn'] != null && !_edits.containsKey(segment['segId']))
                          Padding(padding: const EdgeInsets.only(top: 6), child: Text(segment['textEn'] as String, style: Theme.of(context).textTheme.bodySmall)),
                      ])),
                      if ((segment['source'] as Map)['type'] == 'audio')
                        IconButton(key: Key('play-${segment['segId']}'), tooltip: ctx.t('playClip'), iconSize: 32,
                          constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
                          onPressed: () => _play(Map<String, dynamic>.from(segment['source'] as Map)), icon: const Icon(Icons.play_circle)),
                    ]),
                  ),
                ),
              ),
            if (_edits.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 16),
                child: FilledButton(key: const Key('transcript-save'), onPressed: _saving ? null : () => _save(transcript!['version'] as int),
                  child: Text(ctx.t('saveCorrections'))),
              ),
          ],
        );
      },
    ),
  );
}

/// Owns its text controller so it is disposed only after the dialog's closing animation.
class _EditDialog extends StatefulWidget {
  const _EditDialog({required this.title, required this.initial});
  final String title;
  final String initial;
  @override
  State<_EditDialog> createState() => _EditDialogState();
}

class _EditDialogState extends State<_EditDialog> {
  late final _controller = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.title),
    content: TextField(key: const Key('transcript-edit-field'), controller: _controller, maxLines: null, maxLength: 4000, autofocus: true),
    actions: [
      TextButton(onPressed: () => Navigator.pop(context), child: Text(MaterialLocalizations.of(context).cancelButtonLabel)),
      FilledButton(key: const Key('transcript-edit-ok'), onPressed: () => Navigator.pop(context, _controller.text.trim()),
        child: Text(MaterialLocalizations.of(context).okButtonLabel)),
    ],
  );
}
