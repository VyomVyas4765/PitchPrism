import 'dart:async';

import 'package:flutter/material.dart';

import '../core/api.dart';
import 'common.dart';

/// D-33: the AI's follow-up questions about one idea. All pending questions are answered together; the
/// server then reviews the pitch again and either asks a few more questions or starts the evaluation.
/// [basePath] is '/me' for the entrepreneur and '/assisted' for a facilitator answering with the applicant.
class FollowUpScreen extends StatefulWidget {
  const FollowUpScreen({super.key, required this.ctx, required this.submissionId, required this.title, this.basePath = '/me',
      this.pollEvery = const Duration(seconds: 5)});
  final EntrepreneurContext ctx;
  final String submissionId;
  final String title;
  final String basePath;
  final Duration pollEvery;
  @override
  State<FollowUpScreen> createState() => _FollowUpScreenState();
}

class _FollowUpScreenState extends State<FollowUpScreen> {
  static const notDecided = 'I have not decided this yet.';
  Map<String, dynamic>? _data;
  String? _error;
  bool _sending = false;
  Timer? _poll;
  final _answers = <String, TextEditingController>{};

  String get _path => '${widget.basePath}/submissions/${widget.submissionId}/follow-ups';
  List<Map<String, dynamic>> get _questions => ((_data?['questions'] as List?) ?? []).cast<Map<String, dynamic>>();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _poll?.cancel();
    for (final controller in _answers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await widget.ctx.api.request(_path);
      if (!mounted) return;
      setState(() {
        _data = data;
        _error = null;
      });
      // While the AI reads the answers, check back every few seconds for new questions or the evaluation.
      _poll?.cancel();
      if (data['reviewing'] == true) _poll = Timer(widget.pollEvery, _load);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = widget.ctx.t('offline'));
    }
  }

  TextEditingController _controller(String qId) => _answers.putIfAbsent(qId, TextEditingController.new);

  bool get _complete => _questions.isNotEmpty && _questions.every((q) => _controller(q['qId'] as String).text.trim().isNotEmpty);

  Future<void> _send() async {
    setState(() => _sending = true);
    try {
      await widget.ctx.api.request(_path, body: {
        'answers': [for (final q in _questions) {'qId': q['qId'], 'text': _controller(q['qId'] as String).text.trim()}],
      });
      for (final controller in _answers.values) {
        controller.clear();
      }
      await _load();
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message);
    } catch (_) {
      if (mounted) showMessage(context, widget.ctx.t('offline'));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.ctx.t;
    final data = _data;
    Widget body;
    if (_error != null) {
      body = Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(_error!), const SizedBox(height: 12), FilledButton(onPressed: _load, child: Text(t('retry'))),
      ]));
    } else if (data == null) {
      body = const Center(child: CircularProgressIndicator());
    } else if (_questions.isNotEmpty) {
      body = ListView(padding: const EdgeInsets.all(16), children: [
        Text(t('followUpIntro')),
        const SizedBox(height: 16),
        for (final q in _questions) ...[
          Text(q['questionEn'] as String, key: Key('followup-question-${q['qId']}'), style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          TextField(
            key: Key('followup-answer-${q['qId']}'),
            controller: _controller(q['qId'] as String),
            minLines: 2,
            maxLines: 6,
            maxLength: 2000,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(border: const OutlineInputBorder(), hintText: t('followUpHint')),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              key: Key('followup-undecided-${q['qId']}'),
              onPressed: () => setState(() => _controller(q['qId'] as String).text = notDecided),
              child: Text(t('followUpNotDecided')),
            ),
          ),
          const SizedBox(height: 12),
        ],
        FilledButton(
          key: const Key('followup-send'),
          onPressed: _complete && !_sending ? _send : null,
          child: Text(_sending ? t('followUpSending') : t('followUpSend')),
        ),
      ]);
    } else if (data['reviewing'] == true) {
      body = Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
        const CircularProgressIndicator(), const SizedBox(height: 16),
        Text(t('followUpReviewing'), key: const Key('followup-reviewing'), textAlign: TextAlign.center),
      ])));
    } else {
      body = Center(child: Padding(padding: const EdgeInsets.all(24),
        child: Text(t(data['review'] == 'complete' ? 'followUpDone' : 'followUpNothing'), key: const Key('followup-done'), textAlign: TextAlign.center)));
    }
    return Scaffold(appBar: AppBar(title: Text(widget.title)), body: body);
  }
}
