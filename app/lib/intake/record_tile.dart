import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';

import '../entrepreneur/common.dart';
import 'device.dart';
import 'outbox.dart';

/// M-06: one guided step (or a spoken consent): record up to [maxSeconds],
/// pause and continue, stop, and record again. The file goes straight to app
/// storage; nothing needs a connection.
class RecordTile extends StatefulWidget {
  const RecordTile({
    super.key,
    required this.ctx,
    required this.recorder,
    required this.directory,
    required this.fileStem,
    required this.maxSeconds,
    required this.onRecorded,
    this.existing,
    this.promptStep,
  });
  final EntrepreneurContext ctx;
  final Recorder recorder;
  final Future<Directory> Function() directory;
  final String fileStem;
  final int maxSeconds;
  final ValueChanged<OutboxFile> onRecorded;
  final OutboxFile? existing;
  final String? promptStep;
  @override
  State<RecordTile> createState() => _RecordTileState();
}

class _RecordTileState extends State<RecordTile> {
  String _state = 'idle'; // idle | recording | paused | saving
  int _seconds = 0;
  Timer? _timer;
  int _take = 0;

  @override
  void dispose() {
    _timer?.cancel();
    widget.recorder.dispose();
    super.dispose();
  }

  void _tick() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_state != 'recording') return;
      setState(() => _seconds++);
      if (_seconds >= widget.maxSeconds) _stop();
    });
  }

  Future<void> _start() async {
    if (!await widget.recorder.hasPermission()) {
      if (mounted) showMessage(context, widget.ctx.t('micDenied'));
      return;
    }
    final dir = await widget.directory();
    _take++;
    await widget.recorder.start('${dir.path}${Platform.pathSeparator}${widget.fileStem}-$_take.m4a');
    setState(() {
      _state = 'recording';
      _seconds = 0;
    });
    _tick();
  }

  Future<void> _pause() async {
    await widget.recorder.pause();
    setState(() => _state = 'paused');
  }

  Future<void> _resume() async {
    await widget.recorder.resume();
    setState(() => _state = 'recording');
  }

  Future<void> _stop() async {
    _timer?.cancel();
    setState(() => _state = 'saving');
    final path = await widget.recorder.stop();
    if (path != null) {
      final previous = widget.existing?.path;
      widget.onRecorded(await describeFile(path, kind: 'audio', mime: 'audio/mp4', promptStep: widget.promptStep));
      // A re-recording replaces the earlier take on the phone too.
      if (previous != null && previous != path) {
        try {
          await File(previous).delete();
        } catch (_) {}
      }
    }
    if (mounted) setState(() => _state = 'idle');
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.ctx.t;
    final recording = _state == 'recording' || _state == 'paused';
    final left = widget.maxSeconds - _seconds;
    return Wrap(
      spacing: 12,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (!recording)
          FilledButton.icon(
            key: Key('record-${widget.fileStem}'),
            style: FilledButton.styleFrom(minimumSize: const Size(56, 56)),
            onPressed: _state == 'saving' ? null : _start,
            icon: const Icon(Icons.mic),
            label: Text(widget.existing == null ? t('record') : t('reRecord')),
          ),
        if (_state == 'recording')
          OutlinedButton.icon(key: Key('pause-${widget.fileStem}'), onPressed: _pause, icon: const Icon(Icons.pause), label: Text(t('pause'))),
        if (_state == 'paused')
          OutlinedButton.icon(key: Key('resume-${widget.fileStem}'), onPressed: _resume, icon: const Icon(Icons.play_arrow), label: Text(t('resume'))),
        if (recording)
          FilledButton.icon(key: Key('stop-${widget.fileStem}'), onPressed: _stop, icon: const Icon(Icons.stop), label: Text(t('stop'))),
        if (recording)
          Semantics(liveRegion: true, child: Text('${left ~/ 60}:${(left % 60).toString().padLeft(2, '0')}')),
        if (!recording && widget.existing != null)
          Chip(avatar: const Icon(Icons.check, size: 18), label: Text(t('recorded'))),
      ],
    );
  }
}
