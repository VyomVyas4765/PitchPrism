import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';

import '../core/api.dart';
import '../entrepreneur/common.dart';
import 'device.dart';
import 'outbox.dart';
import 'record_tile.dart';
import 'services.dart';
import 'transcript_screen.dart';

/// Reads a server list, falling back to the copy saved on the phone so the
/// pitch screens work offline after one successful visit.
Future<Map<String, dynamic>> cachedRead(IntakeServices services, String path, String cacheName) async {
  final file = File('${(await services.directory()).path}${Platform.pathSeparator}$cacheName');
  try {
    final data = await services.api.request(path);
    await file.writeAsString(jsonEncode(data));
    return data;
  } on ApiException catch (error) {
    if (error.status == 401 || error.status == 403) rethrow;
    if (await file.exists()) return jsonDecode(await file.readAsString()) as Map<String, dynamic>;
    rethrow;
  } on Exception {
    if (await file.exists()) return jsonDecode(await file.readAsString()) as Map<String, dynamic>;
    rethrow;
  }
}

/// M-05/M-06/M-07: one pitch in the chosen mode. Every change is saved to the
/// outbox on the phone first; Send queues it and syncs when a connection exists (M-11).
class PitchScreen extends StatefulWidget {
  const PitchScreen({super.key, required this.ctx, required this.services, required this.item});
  final EntrepreneurContext ctx;
  final IntakeServices services;
  final OutboxItem item;
  @override
  State<PitchScreen> createState() => _PitchScreenState();
}

class _PitchScreenState extends State<PitchScreen> {
  OutboxItem get item => widget.item;
  late final Future<(Map<String, dynamic>, List<Map<String, dynamic>>)> _setup = _load();
  bool _sending = false;

  Future<(Map<String, dynamic>, List<Map<String, dynamic>>)> _load() async {
    final prompts = await cachedRead(widget.services, '/pitch-prompts', 'prompts.json');
    // Facilitators' pitches go to their own centre; entrepreneurs choose one.
    final centres = item.applicant != null ? const <Map<String, dynamic>>[]
        : ((await cachedRead(widget.services, '/centres', 'centres.json'))['centres'] as List).cast<Map<String, dynamic>>();
    return (prompts, centres);
  }

  Future<void> _save() => widget.services.upsert(item);

  bool get _hasContent => item.answers.values.any((text) => text.trim().isNotEmpty) || item.files.isNotEmpty;

  Future<void> _send() async {
    if (!_hasContent) {
      showMessage(context, widget.ctx.t('nothingToSend'));
      return;
    }
    if (item.applicant == null && item.centreId == null) {
      showMessage(context, widget.ctx.t('chooseCentre'));
      return;
    }
    setState(() => _sending = true);
    item.status = 'queued';
    await _save();
    // Sync now if possible; otherwise the outbox keeps it for later.
    try {
      await widget.services.sync.syncAll();
    } catch (_) {}
    if (mounted) Navigator.of(context).pop(true);
  }

  Future<void> _pick() async {
    final picked = await widget.services.pickFile();
    if (picked == null) return;
    final type = classifyPicked(picked.name);
    if (type == null) return;
    final dir = await widget.services.directory();
    final copy = await File(picked.path).copy('${dir.path}${Platform.pathSeparator}${newClientId('upload')}.${picked.name.split('.').last}');
    final described = await describeFile(copy.path, kind: type.kind, mime: type.mime);
    setState(() => item.files.add(described));
    await _save();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.ctx.t;
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t(switch (item.mode) { 'guided' || 'free_talk' => 'speak', 'typed' => 'type', _ => 'upload' }))),
      body: Column(children: [Expanded(child: FutureBuilder(
        future: _setup,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snapshot.hasError) {
            return Center(child: Text(snapshot.error is ApiException ? (snapshot.error as ApiException).message : 'Cannot reach PitchPrism.'));
          }
          final (prompts, centres) = snapshot.data!;
          final steps = (prompts['steps'] as List).cast<Map<String, dynamic>>();
          return ListView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.all(16),
            children: [
              if (item.applicant == null) ...[
                DropdownButtonFormField<String>(
                  key: const Key('pitch-centre'),
                  initialValue: item.centreId,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: t('centre')),
                  items: [for (final centre in centres) DropdownMenuItem(value: centre['id'] as String,
                    child: Text(centre['name'] as String, overflow: TextOverflow.ellipsis, maxLines: 1))],
                  onChanged: (value) {
                    setState(() => item.centreId = value);
                    _save();
                  },
                ),
                const SizedBox(height: 16),
              ],
              if (item.mode == 'free_talk') ...[
                Row(children: [
                  Expanded(child: Text(t('freeTalkPrompt'), style: theme.textTheme.titleMedium)),
                  ListenButton(context_: widget.ctx, text: t('freeTalkPrompt')),
                ]),
                const SizedBox(height: 12),
                RecordTile(
                  key: const Key('tile-free-talk'),
                  ctx: widget.ctx,
                  recorder: widget.services.recorder(),
                  directory: widget.services.directory,
                  fileStem: '${item.clientDraftId}-free',
                  maxSeconds: 300,
                  existing: item.files.firstOrNull,
                  onRecorded: (file) {
                    setState(() => item.files
                      ..clear()
                      ..add(file));
                    _save();
                  },
                ),
              ] else if (item.mode == 'upload') ...[
                for (final file in item.files)
                  ListTile(leading: Icon(file.kind == 'pdf' ? Icons.picture_as_pdf : Icons.image), title: Text(file.path.split(Platform.pathSeparator).last)),
                OutlinedButton.icon(key: const Key('pitch-pick'), onPressed: _pick, icon: const Icon(Icons.upload_file), label: Text(t('chooseFile'))),
              ] else
                for (final step in steps)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(children: [
                            Expanded(child: Text((step['prompt'] as Map)[widget.ctx.language] as String, style: theme.textTheme.titleMedium)),
                            ListenButton(context_: widget.ctx, text: (step['prompt'] as Map)[widget.ctx.language] as String),
                          ]),
                          const SizedBox(height: 12),
                          if (item.mode == 'typed')
                            TextFormField(
                              key: Key('answer-${step['key']}'),
                              initialValue: item.answers[step['key']],
                              maxLines: null,
                              maxLength: 4000,
                              onChanged: (value) => item.answers[step['key'] as String] = value,
                              onEditingComplete: () {
                                FocusScope.of(context).unfocus();
                                _save();
                              },
                              onTapOutside: (_) {
                                FocusScope.of(context).unfocus();
                                _save();
                              },
                            )
                          else
                            RecordTile(
                              key: Key('tile-${step['key']}'),
                              ctx: widget.ctx,
                              recorder: widget.services.recorder(),
                              directory: widget.services.directory,
                              fileStem: '${item.clientDraftId}-${step['key']}',
                              maxSeconds: (step['maxSeconds'] as num).toInt(),
                              promptStep: step['key'] as String,
                              existing: item.files.where((file) => file.promptStep == step['key']).firstOrNull,
                              onRecorded: (file) {
                                setState(() {
                                  item.files.removeWhere((existing) => existing.promptStep == file.promptStep);
                                  item.files.add(file);
                                });
                                _save();
                              },
                            ),
                        ],
                      ),
                    ),
                  ),
              const SizedBox(height: 24),
              FilledButton(key: const Key('pitch-send'), onPressed: _sending ? null : _send, child: Text(t('send'))),
              const SizedBox(height: 12),
              OutlinedButton(
                key: const Key('pitch-save'),
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(56)),
                onPressed: _sending ? null : () async {
                  await _save();
                  if (context.mounted) Navigator.of(context).pop(false);
                },
                child: Text(t('saveLater')),
              ),
            ],
          );
        },
      )), KeyboardDismissBar(label: t('hideKeyboard'), onDismiss: () { _save(); })]),
    );
  }
}

/// M-11/M-18: everything on this phone that is not yet confirmed by the server,
/// with each item's own sync state. Drafts reopen for editing.
class OutboxScreen extends StatefulWidget {
  const OutboxScreen({super.key, required this.ctx, required this.services});
  final EntrepreneurContext ctx;
  final IntakeServices services;
  @override
  State<OutboxScreen> createState() => _OutboxScreenState();
}

class _OutboxScreenState extends State<OutboxScreen> {
  late Future<List<OutboxItem>> _items = widget.services.store.load();
  bool _syncing = false;

  Future<void> _syncNow() async {
    setState(() => _syncing = true);
    try {
      await widget.services.sync.syncAll();
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message);
    } catch (_) {}
    if (mounted) {
      setState(() {
        _syncing = false;
        _items = widget.services.store.load();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.ctx.t;
    return Scaffold(
      appBar: AppBar(title: Text(t('outbox'))),
      body: FutureBuilder<List<OutboxItem>>(
        future: _items,
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          final items = snapshot.data!.reversed.toList();
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              FilledButton.icon(key: const Key('outbox-sync'), onPressed: _syncing ? null : _syncNow,
                icon: const Icon(Icons.cloud_upload), label: Text(t('syncNow'))),
              const SizedBox(height: 16),
              if (items.isEmpty) Text(t('noIdeas')),
              for (final item in items)
                ListTile(
                  key: Key('outbox-${item.clientDraftId}'),
                  leading: Icon(switch (item.status) {
                    'sent' => Icons.cloud_done,
                    'failed' => Icons.error_outline,
                    'queued' => Icons.cloud_queue,
                    _ => Icons.edit_note,
                  }),
                  title: Text([
                    if (item.applicant != null) item.applicant!.fields['name'] as String,
                    t(switch (item.mode) { 'guided' || 'free_talk' => 'speak', 'typed' => 'type', _ => 'upload' }),
                  ].join(' · ')),
                  subtitle: Text([
                    t(switch (item.status) { 'sent' => 'itemSent', 'failed' => 'itemFailed', 'queued' => 'itemQueued', _ => 'itemDraft' }),
                    if (item.lastError != null) item.lastError!,
                  ].join(' — ')),
                  onTap: item.status == 'draft'
                      ? () async {
                          await Navigator.of(context).push(MaterialPageRoute<bool>(
                            builder: (_) => PitchScreen(ctx: widget.ctx, services: widget.services, item: item)));
                          if (mounted) setState(() => _items = widget.services.store.load());
                        }
                      : item.status == 'sent' && item.pitchId != null
                          ? () => Navigator.of(context).push(MaterialPageRoute<void>(
                              builder: (_) => TranscriptScreen(ctx: widget.ctx, services: widget.services, item: item)))
                          : null,
                ),
            ],
          );
        },
      ),
    );
  }
}
