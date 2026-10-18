import 'dart:convert' show HtmlEscape;
import 'dart:io';

import 'package:flutter/material.dart';

import '../core/api.dart';
import '../intake/services.dart';
import 'chat_screen.dart';
import 'common.dart';

/// "My ideas": every business idea the person pitched, by business name. Each opens its own dashboard with
/// Status, Score, Evaluator feedback, Improve your pitch, Business draft (in their language) and Funding opportunities.
class MyIdeasScreen extends StatelessWidget {
  const MyIdeasScreen({super.key, required this.ctx, required this.services});
  final EntrepreneurContext ctx;
  final IntakeServices services;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(ctx.t('myIdeas'))),
    body: LoadView<Map<String, dynamic>>(
      retryLabel: ctx.t('retry'),
      load: () => ctx.api.request('/me/ideas'),
      builder: (context, data, reload) {
        final ideas = ((data['ideas'] as List?) ?? const []).cast<Map<String, dynamic>>();
        if (ideas.isEmpty) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(ctx.t('ideasEmpty'), textAlign: TextAlign.center)));
        return RefreshIndicator(
          onRefresh: () async => reload(),
          child: ListView.separated(
            padding: const EdgeInsets.all(12),
            itemCount: ideas.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final idea = ideas[index];
              final potential = idea['potential'] as num?;
              return Card(child: ListTile(
                key: Key('idea-${idea['pitchId']}'),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                leading: CircleAvatar(child: Text(potential == null ? '…' : '${potential.round()}')),
                title: Text(idea['title'] as String? ?? ctx.t('ideaUntitled'), style: Theme.of(context).textTheme.titleMedium),
                subtitle: Text(ctx.t('status${idea['status']}')),
                trailing: const Icon(Icons.chevron_right),
                onTap: () async {
                  await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) =>
                      IdeaDashboardScreen(ctx: ctx, services: services, pitchId: idea['pitchId'] as String)));
                  reload();
                },
              ));
            },
          ),
        );
      },
    ),
  );
}

/// One idea's dashboard. English content comes first; when the person's language is not English the screen asks the
/// server to translate it (cached there) and then shows it in their language.
class IdeaDashboardScreen extends StatefulWidget {
  const IdeaDashboardScreen({super.key, required this.ctx, required this.services, required this.pitchId});
  final EntrepreneurContext ctx;
  final IntakeServices services;
  final String pitchId;
  @override
  State<IdeaDashboardScreen> createState() => _IdeaDashboardScreenState();
}

class _IdeaDashboardScreenState extends State<IdeaDashboardScreen> {
  EntrepreneurContext get ctx => widget.ctx;
  Map<String, dynamic>? _data;
  String? _error;
  bool _translating = false;

  String get _path => '/me/ideas/${widget.pitchId}?lang=${ctx.language}';
  Map<String, dynamic>? get _localized => _data?['localized'] as Map<String, dynamic>?;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await ctx.api.request(_path);
      if (!mounted) return;
      setState(() { _data = data; _error = null; });
      if (data['translationNeeded'] == true) _translate();
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = ctx.t('offline'));
    }
  }

  Future<void> _translate() async {
    if (_translating) return;
    setState(() => _translating = true);
    try {
      final result = await ctx.api.request('/me/ideas/${widget.pitchId}/localize?lang=${ctx.language}', body: {});
      if (mounted && result['localized'] != null) setState(() => _data = {..._data!, 'localized': result['localized'], 'translationNeeded': false});
    } catch (_) {
      // The dashboard stays readable in English; the banner offers a retry.
    } finally {
      if (mounted) setState(() => _translating = false);
    }
  }

  void _open(String section) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => switch (section) {
    'score' => _ScorePage(ctx: ctx, data: _data!, localized: _localized),
    'feedback' => _FeedbackPage(ctx: ctx, services: widget.services, data: _data!, localized: _localized),
    'improve' => _ImprovePage(ctx: ctx, pitchId: widget.pitchId, initial: _data!['improve'] as Map<String, dynamic>?),
    'draft' => _DraftPage(ctx: ctx, services: widget.services, data: _data!, localized: _localized),
    _ => _FundingPage(ctx: ctx, data: _data!, localized: _localized),
  }));

  @override
  Widget build(BuildContext context) {
    final data = _data;
    return Scaffold(
      appBar: AppBar(title: Text(data?['title'] as String? ?? ctx.t('myIdeas'))),
      body: data == null
          ? Center(child: _error == null ? const CircularProgressIndicator()
              : Column(mainAxisSize: MainAxisSize.min, children: [Text(_error!), TextButton(onPressed: _load, child: Text(ctx.t('retry')))]))
          : RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(12), children: [
              if (_translating) _banner(Icons.translate, ctx.t('draftTranslating'), busy: true),
              if (!_translating && data['translationNeeded'] == true)
                _banner(Icons.translate, ctx.t('draftShownEnglish'), action: TextButton(onPressed: _translate, child: Text(ctx.t('retry')))),
              _StatusCard(ctx: ctx, data: data),
              const SizedBox(height: 8),
              GridView.count(
                crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 8, crossAxisSpacing: 8, childAspectRatio: 1.15,
                children: [
                  _tile('score', Icons.speed, 'secScore', _scoreSummary(data)),
                  _tile('feedback', Icons.rate_review_outlined, 'secFeedback', _feedbackSummary(data)),
                  _tile('improve', Icons.auto_fix_high, 'secImprove', ctx.t('improveTile')),
                  _tile('draft', Icons.description_outlined, 'secDraft', data['brief'] == null ? ctx.t('draftNotReadyShort') : ctx.t('draftTile')),
                  _tile('funding', Icons.account_balance_outlined, 'secFunding', _fundingSummary(data)),
                ],
              ),
            ])),
    );
  }

  String _scoreSummary(Map<String, dynamic> data) {
    final score = data['score'] as Map<String, dynamic>?;
    return score == null ? ctx.t('scorePendingShort') : '${score['potential']} / 100 · ${score['band'] ?? ''}';
  }

  String _feedbackSummary(Map<String, dynamic> data) {
    final feedback = data['feedback'] as Map<String, dynamic>?;
    if (feedback == null) return ctx.t('feedbackNoneShort');
    return ctx.t(switch (feedback['decision']) { 'shortlist' => 'ideaStage_shortlisted', 'not_yet' => 'ideaStage_not_selected',
      'more_info' => 'ideaStage_more_info', _ => 'feedbackNotes' });
  }

  String _fundingSummary(Map<String, dynamic> data) {
    final good = ((data['funding'] as List?) ?? const []).where((item) => (item as Map)['fit'] == 'good').length;
    return '$good ${ctx.t('fundingGood').toLowerCase()}';
  }

  Widget _banner(IconData icon, String text, {bool busy = false, Widget? action}) => Card(
    color: Theme.of(context).colorScheme.secondaryContainer,
    child: ListTile(
      leading: busy ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2)) : Icon(icon),
      title: Text(text), trailing: action),
  );

  Widget _tile(String section, IconData icon, String titleKey, String summary) => Card(
    key: Key('dash-$section'),
    clipBehavior: Clip.antiAlias,
    child: InkWell(
      onTap: () => _open(section),
      child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 32, color: Theme.of(context).colorScheme.primary),
        const Spacer(),
        Text(ctx.t(titleKey), style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(summary, maxLines: 2, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.bodySmall),
      ])),
    ),
  );
}

/// Status: where the application stands, as a short timeline.
class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.ctx, required this.data});
  final EntrepreneurContext ctx;
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = data['status'] as Map<String, dynamic>;
    final stage = status['stage'] as String;
    final decided = ['shortlisted', 'not_selected', 'more_info'].contains(stage);
    final steps = [
      ('stepStarted', true, status['startedAt']),
      ('stepSent', status['sentAt'] != null, status['sentAt']),
      ('stepEvaluated', status['evaluatedAt'] != null || decided, status['evaluatedAt']),
      ('stepDecision', decided, status['decidedAt']),
    ];
    final colour = switch (stage) {
      'shortlisted' => Colors.green.shade700, 'not_selected' => theme.colorScheme.error, 'evaluation_failed' => Colors.orange.shade800,
      _ => theme.colorScheme.primary };
    return Card(key: const Key('dash-status'), child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(ctx.t('secStatus'), style: theme.textTheme.labelLarge),
      const SizedBox(height: 4),
      Text(ctx.t('ideaStage_$stage'), key: const Key('dash-stage'), style: theme.textTheme.headlineSmall?.copyWith(color: colour, fontWeight: FontWeight.w700)),
      if (stage == 'ready_to_send') Padding(padding: const EdgeInsets.only(top: 4), child: Text(ctx.t('ideaReadyHint'))),
      const SizedBox(height: 12),
      for (final (key, done, at) in steps) Row(children: [
        Icon(done ? Icons.check_circle : Icons.radio_button_unchecked, size: 20, color: done ? colour : theme.disabledColor),
        const SizedBox(width: 8),
        Expanded(child: Text(ctx.t(key))),
        if (at is String) Text(_date(context, at), style: theme.textTheme.bodySmall),
      ]),
    ])));
  }
}

String _date(BuildContext context, String iso) => MaterialLocalizations.of(context).formatMediumDate(DateTime.parse(iso).toLocal());

Widget _section(BuildContext context, String title, List<Widget> children) => Card(child: Padding(
  padding: const EdgeInsets.all(16),
  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Text(title, style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: 8), ...children]),
));

/// Score: the final evaluation the evaluator sees.
class _ScorePage extends StatelessWidget {
  const _ScorePage({required this.ctx, required this.data, required this.localized});
  final EntrepreneurContext ctx;
  final Map<String, dynamic> data;
  final Map<String, dynamic>? localized;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final score = data['score'] as Map<String, dynamic>?;
    final reasons = (localized?['scoreReasons'] as List?)?.cast<String>();
    return Scaffold(appBar: AppBar(title: Text(ctx.t('secScore'))), body: score == null
        ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(ctx.t('scoreNone'), key: const Key('score-none'), textAlign: TextAlign.center)))
        : ListView(padding: const EdgeInsets.all(12), children: [
            Card(child: Padding(padding: const EdgeInsets.all(20), child: Row(children: [
              SizedBox(width: 96, height: 96, child: Stack(alignment: Alignment.center, children: [
                SizedBox.expand(child: CircularProgressIndicator(value: (score['potential'] as num) / 100, strokeWidth: 9,
                  backgroundColor: theme.colorScheme.surfaceContainerHighest)),
                Text('${score['potential']}', key: const Key('score-potential'), style: theme.textTheme.headlineMedium),
              ])),
              const SizedBox(width: 20),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(ctx.t('scoreOutOf'), style: theme.textTheme.bodySmall),
                Text('${ctx.t('scoreBand')}: ${score['band'] ?? '—'}', style: theme.textTheme.titleMedium),
                if (score['pathway'] != null) Text('${ctx.t('scorePathway')}: ${score['pathway']}'),
              ])),
            ]))),
            _section(context, ctx.t('scoreAreas'), [
              for (final (index, domain) in ((score['domains'] as List).cast<Map<String, dynamic>>()).indexed) Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(ctx.t('domain_${domain['key']}'), style: theme.textTheme.titleSmall)),
                    Text(domain['score'] == null ? '—' : '${domain['score']} / 5'),
                  ]),
                  const SizedBox(height: 4),
                  LinearProgressIndicator(value: ((domain['score'] as num?) ?? 0) / 5, minHeight: 6),
                  const SizedBox(height: 4),
                  Text(reasons != null && index < reasons.length ? reasons[index] : domain['reason'] as String, style: theme.textTheme.bodySmall),
                ]),
              ),
            ]),
            if (((score['checks'] as List?) ?? const []).isNotEmpty)
              _section(context, ctx.t('scoreChecks'), [for (final check in (score['checks'] as List)) Text('• $check')]),
          ]));
  }
}

/// Evaluator feedback: the decision, the evaluator's message and notes (the interview is answered in the idea's chat).
class _FeedbackPage extends StatelessWidget {
  const _FeedbackPage({required this.ctx, required this.services, required this.data, required this.localized});
  final EntrepreneurContext ctx;
  final IntakeServices services;
  final Map<String, dynamic> data;
  final Map<String, dynamic>? localized;

  @override
  Widget build(BuildContext context) {
    final feedback = data['feedback'] as Map<String, dynamic>?;
    final message = localized?['feedbackMessage'] as String? ?? feedback?['message'] as String?;
    final notes = localized?['feedbackNotes'] as String? ?? feedback?['notes'] as String?;
    return Scaffold(appBar: AppBar(title: Text(ctx.t('secFeedback'))), body: feedback == null
        ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(ctx.t('feedbackNone'), key: const Key('feedback-none'), textAlign: TextAlign.center)))
        : ListView(padding: const EdgeInsets.all(12), children: [
            if (feedback['decision'] != null) _section(context, ctx.t('feedbackDecision'), [
              Text(ctx.t(switch (feedback['decision']) { 'shortlist' => 'outcomeShortlistedTitle', 'not_yet' => 'outcomeNotSelectedTitle', _ => 'outcomeMoreInfoTitle' }),
                key: const Key('feedback-decision'), style: Theme.of(context).textTheme.titleMedium),
              if (feedback['decidedAt'] is String) Text(_date(context, feedback['decidedAt'] as String), style: Theme.of(context).textTheme.bodySmall),
            ]),
            if (message != null) _section(context, ctx.t('outcomeEvaluatorMessage'), [
              Text(message, key: const Key('feedback-message'), style: Theme.of(context).textTheme.bodyLarge),
              ListenButton(context_: ctx, text: message),
            ]),
            if (notes != null) _section(context, ctx.t('feedbackNotes'), [Text(notes)]),
            if (feedback['decision'] == 'shortlist') FilledButton.icon(
              key: const Key('feedback-interview'),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) =>
                  ChatScreen(ctx: ctx, services: services, pitchId: data['pitchId'] as String))),
              icon: const Icon(Icons.event),
              label: Text(ctx.t('feedbackOpenInterview')),
            ),
          ]));
  }
}

/// Improve your pitch: AI coaching grounded in the plan and its evaluation, in the person's language.
class _ImprovePage extends StatefulWidget {
  const _ImprovePage({required this.ctx, required this.pitchId, required this.initial});
  final EntrepreneurContext ctx;
  final String pitchId;
  final Map<String, dynamic>? initial;
  @override
  State<_ImprovePage> createState() => _ImprovePageState();
}

class _ImprovePageState extends State<_ImprovePage> {
  EntrepreneurContext get ctx => widget.ctx;
  late Map<String, dynamic>? _improve = widget.initial;
  bool _busy = false;

  Future<void> _ask({bool refresh = false}) async {
    setState(() => _busy = true);
    try {
      final result = await ctx.api.request('/me/ideas/${widget.pitchId}/improve?lang=${ctx.language}', body: {if (refresh) 'refresh': true});
      if (mounted) setState(() => _improve = result['improve'] as Map<String, dynamic>?);
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message);
    } catch (_) {
      if (mounted) showMessage(context, ctx.t('offline'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final improve = _improve;
    final suggestions = ((improve?['suggestions'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Scaffold(appBar: AppBar(title: Text(ctx.t('secImprove'))), body: ListView(padding: const EdgeInsets.all(12), children: [
      Text(ctx.t('improveIntro')),
      const SizedBox(height: 12),
      if (_busy) Card(child: ListTile(leading: const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2)), title: Text(ctx.t('improveWorking'))))
      else FilledButton.icon(
        key: const Key('improve-ask'),
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
        onPressed: () => _ask(refresh: improve != null),
        icon: const Icon(Icons.auto_fix_high),
        label: Text(ctx.t(improve == null ? 'improveButton' : 'improveRefresh')),
      ),
      if (improve != null) ...[
        const SizedBox(height: 12),
        Card(color: theme.colorScheme.primaryContainer, child: Padding(padding: const EdgeInsets.all(16), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Text(improve['summary'] as String, key: const Key('improve-summary'), style: theme.textTheme.bodyLarge)),
          ListenButton(context_: ctx, text: improve['summary'] as String),
        ]))),
        if (improve['lang'] == 'en' && ctx.language != 'en') Text(ctx.t('chatShownInEnglish'), style: theme.textTheme.bodySmall),
        for (final (index, item) in suggestions.indexed) Card(key: Key('improve-$index'), child: Padding(padding: const EdgeInsets.all(16), child: Column(
          crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(ctx.t('domain_${item['area']}'), style: theme.textTheme.titleMedium)),
              Chip(label: Text(ctx.t('improvePriority_${item['priority']}')), visualDensity: VisualDensity.compact),
            ]),
            Text(item['issue'] as String),
            const SizedBox(height: 8),
            Text(ctx.t('improveAction'), style: theme.textTheme.labelLarge),
            Text(item['action'] as String),
            if ((item['example'] as String?)?.isNotEmpty ?? false) ...[
              const SizedBox(height: 8),
              Text(ctx.t('improveExample'), style: theme.textTheme.labelLarge),
              Container(width: double.infinity, padding: const EdgeInsets.all(10), margin: const EdgeInsets.only(top: 4),
                decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(8)),
                child: Text(item['example'] as String, style: const TextStyle(fontStyle: FontStyle.italic))),
            ],
            Align(alignment: Alignment.centerRight, child: ListenButton(context_: ctx, text: '${item['issue']} ${item['action']}')),
          ]))),
      ],
    ]));
  }
}

/// Business draft: the Business Idea Brief in the person's language (the evaluator's copy is in English).
class _DraftPage extends StatefulWidget {
  const _DraftPage({required this.ctx, required this.services, required this.data, required this.localized});
  final EntrepreneurContext ctx;
  final IntakeServices services;
  final Map<String, dynamic> data;
  final Map<String, dynamic>? localized;
  @override
  State<_DraftPage> createState() => _DraftPageState();
}

class _DraftPageState extends State<_DraftPage> {
  EntrepreneurContext get ctx => widget.ctx;
  bool _busy = false;

  List<Map<String, dynamic>> get _rows => ((widget.localized?['brief'] ?? widget.data['brief']) as List? ?? const []).cast<Map<String, dynamic>>();

  String _html() {
    const esc = HtmlEscape();
    final applicant = (widget.data['applicant'] as Map?) ?? const {};
    String cell(Object? value) => esc.convert('${value ?? ''}');
    final rows = _rows.map((row) => '<tr><td class="n">${row['number']}</td><td>${cell(row['question'])}</td><td class="r">${cell(row['response'])}</td></tr>').join();
    return '''<!doctype html><html lang="${ctx.language}"><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,"Noto Sans","Kohinoor Devanagari","Kohinoor Telugu","Kohinoor Bangla","Noto Sans Oriya",sans-serif;font-size:11pt;color:#111;margin:28px}
      h1{text-align:center;margin:0;font-size:22pt;letter-spacing:1px}.tag{text-align:center;font-size:7pt;color:#888}h2{text-align:center;font-size:15pt;margin:14px 0 18px}
      .f{margin:4px 0;border-bottom:1px solid #000;padding-bottom:2px}.f span{color:#2b4a9a}
      table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #444;padding:6px 7px;vertical-align:top}
      thead tr:first-child th{background:#7f7f7f;color:#fff;text-align:left}thead tr:last-child th{background:#999;color:#fff;text-align:left}
      td.n{text-align:center;width:40px}td.r{color:#2b4a9a;width:48%}</style></head><body>
      <h1>TATA STRIVE</h1><div class="tag">Right Skills. Bright Future.</div><h2>${cell(ctx.t('draftProgramme'))}</h2>
      <div class="f">${cell(ctx.t('draftName'))}: <span>${cell(applicant['name'])}</span></div>
      <div class="f">${cell(ctx.t('draftMobile'))}: <span>${cell(applicant['mobile'])}</span></div>
      <div class="f">${cell(ctx.t('draftBusiness'))}: <span>${cell(widget.data['title'])}</span></div>
      <table><thead><tr><th colspan="3">${cell(ctx.t('draftTitle'))}</th></tr><tr><th>${cell(ctx.t('draftQno'))}</th><th>${cell(ctx.t('draftQuestions'))}</th><th>${cell(ctx.t('draftResponse'))}</th></tr></thead>
      <tbody>$rows</tbody></table></body></html>''';
  }

  Future<void> _download() async {
    setState(() => _busy = true);
    final box = context.findRenderObject() as RenderBox?;
    final origin = box == null ? null : box.localToGlobal(Offset.zero) & box.size;
    try {
      final bytes = await widget.services.htmlToPdf(_html());
      final directory = await widget.services.directory();
      final file = File('${directory.path}${Platform.pathSeparator}business-idea-brief-${ctx.language}-${widget.data['pitchId']}.pdf');
      await file.writeAsBytes(bytes, flush: true);
      await widget.services.shareFile(file.path, 'application/pdf', origin);
    } catch (_) {
      if (mounted) showMessage(context, ctx.t('chatBriefUnavailable'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final rows = _rows;
    final english = ctx.language != 'en' && (widget.localized == null || rows.any((row) => row['lang'] == 'en'));
    return Scaffold(appBar: AppBar(title: Text(ctx.t('secDraft'))), body: rows.isEmpty
        ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(ctx.t('draftNotReady'), textAlign: TextAlign.center)))
        : ListView(padding: const EdgeInsets.all(12), children: [
            Text(ctx.t('draftIntro')),
            if (english) Padding(padding: const EdgeInsets.only(top: 6), child: Text(ctx.t('draftShownEnglish'), style: theme.textTheme.bodySmall)),
            const SizedBox(height: 12),
            FilledButton.icon(
              key: const Key('draft-download'),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              onPressed: _busy ? null : _download,
              icon: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.download),
              label: Text(ctx.t('draftDownload')),
            ),
            const SizedBox(height: 12),
            for (final row in rows) Card(key: Key('draft-row-${row['number']}'), child: Padding(padding: const EdgeInsets.all(14), child: Column(
              crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${row['number']}. ${row['question']}', style: theme.textTheme.labelLarge),
                const SizedBox(height: 6),
                Text(row['response'] as String, style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.primary)),
              ]))),
          ]));
  }
}

/// Funding opportunities: schemes, loans and support that fit this idea, best matches first.
class _FundingPage extends StatelessWidget {
  const _FundingPage({required this.ctx, required this.data, required this.localized});
  final EntrepreneurContext ctx;
  final Map<String, dynamic> data;
  final Map<String, dynamic>? localized;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final options = ((localized?['funding'] ?? data['funding']) as List? ?? const []).cast<Map<String, dynamic>>();
    final note = localized?['fundingNote'] as String? ?? data['fundingNote'] as String? ?? '';
    return Scaffold(appBar: AppBar(title: Text(ctx.t('secFunding'))), body: ListView(padding: const EdgeInsets.all(12), children: [
      Text(ctx.t('fundingIntro')),
      const SizedBox(height: 8),
      Card(color: theme.colorScheme.tertiaryContainer, child: Padding(padding: const EdgeInsets.all(12), child: Row(children: [
        const Icon(Icons.info_outline), const SizedBox(width: 8), Expanded(child: Text(note, key: const Key('funding-note'))),
      ]))),
      for (final option in options) Card(key: Key('funding-${option['id']}'), child: ExpansionTile(
        leading: Icon(option['fit'] == 'good' ? Icons.verified : option['fit'] == 'possible' ? Icons.help_outline : Icons.remove_circle_outline,
          color: option['fit'] == 'good' ? Colors.green.shade700 : null),
        title: Text(option['name'] as String, style: theme.textTheme.titleSmall),
        subtitle: Text('${ctx.t('funding_${option['fit']}')} · ${option['why']}'),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        expandedCrossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(option['summary'] as String),
          const SizedBox(height: 8),
          _fact(theme, ctx.t('fundingAmount'), option['amount'] as String),
          _fact(theme, ctx.t('fundingWho'), option['who'] as String),
          _fact(theme, ctx.t('fundingHow'), option['howToApply'] as String),
          _fact(theme, ctx.t('fundingWebsite'), option['website'] as String, selectable: true),
          Text(option['provider'] as String, style: theme.textTheme.bodySmall),
        ],
      )),
    ]));
  }

  Widget _fact(ThemeData theme, String label, String value, {bool selectable = false}) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: theme.textTheme.labelLarge),
      selectable ? SelectableText(value, style: TextStyle(color: theme.colorScheme.primary)) : Text(value),
    ]),
  );
}
