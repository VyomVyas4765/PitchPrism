import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pitchprism_app/core/api.dart';
import 'package:pitchprism_app/entrepreneur/common.dart';
import 'package:pitchprism_app/entrepreneur/ideas_dashboard.dart';
import 'package:pitchprism_app/intake/services.dart';
import 'package:pitchprism_app/l10n/strings.dart';

import 'chat_test.dart' show RecordingSpeech, settle;
import 'intake_ui_test.dart' show FakeRecorder;
import 'outbox_test.dart' show MemoryStore;

/// Follows the "My ideas" API: a list, one idea's dashboard in English, then its Marathi translation. Synthetic data.
class IdeasServer implements ApiClient {
  final posts = <String, List<Map<String, dynamic>>>{};
  final gets = <String>[];
  bool translated = false;

  static const brief = [
    {'number': 1, 'key': 'location', 'question': 'Where do you intend to set up your business?', 'response': 'Wakad, Pune.', 'state': 'answered'},
    {'number': 2, 'key': 'offering', 'question': 'What will you sell?', 'response': 'Blouse stitching.', 'state': 'answered'},
  ];
  static final funding = [
    {'id': 'mudra', 'name': 'Pradhan Mantri MUDRA Yojana (PMMY)', 'kind': 'loan', 'provider': 'Banks', 'summary': 'Collateral-free loans.', 'amount': 'Up to ₹10 lakh',
      'who': 'Small businesses.', 'howToApply': 'Ask a bank.', 'website': 'https://www.mudra.org.in', 'fit': 'good', 'why': 'Fits a Shishu loan.'},
    {'id': 'svanidhi', 'name': 'PM SVANidhi', 'kind': 'loan', 'provider': 'MoHUA', 'summary': 'For street vendors.', 'amount': 'Small loans',
      'who': 'Street vendors.', 'howToApply': 'Portal.', 'website': 'https://pmsvanidhi.mohua.gov.in', 'fit': 'other', 'why': 'Only for street vendors.'},
  ];

  Map<String, dynamic> get dashboard => {
    'pitchId': 'p1', 'submissionId': 's1', 'title': 'Tailoring shop', 'language': 'mr', 'applicant': {'name': 'Asha', 'mobile': '9800000000'},
    'status': {'code': 'NOT_YET', 'stage': 'not_selected', 'startedAt': '2026-10-17T10:00:00Z', 'sentAt': '2026-10-17T11:00:00Z',
      'evaluatedAt': '2026-10-17T11:05:00Z', 'decidedAt': '2026-10-18T09:00:00Z'},
    'score': {'potential': 58, 'band': 'Promising', 'pathway': 'Skilling', 'domains': [
      {'key': 'clarity', 'score': 4, 'reason': 'Clear offering.'}, {'key': 'financial_logic', 'score': 2, 'reason': 'Costs are unclear.'}], 'checks': <String>[]},
    'feedback': {'decision': 'not_yet', 'message': 'Work out your monthly costs and apply again.', 'notes': null, 'decidedAt': '2026-10-18T09:00:00Z', 'interview': null},
    'brief': brief, 'funding': funding, 'fundingNote': 'Confirm current terms.', 'displayLanguage': 'mr',
    'localized': translated ? localized : null, 'translationNeeded': !translated, 'improve': null,
  };
  Map<String, dynamic> get localized => {
    'language': 'mr', 'complete': true,
    'brief': [for (final row in brief) {...row, 'question': 'प्रश्न ${row['number']}', 'response': 'उत्तर ${row['number']}', 'lang': 'mr'}],
    'scoreReasons': ['स्पष्ट', 'खर्च अस्पष्ट'], 'feedbackMessage': 'तुमचा मासिक खर्च काढा.', 'feedbackNotes': null,
    'funding': [for (final option in funding) {...option, 'why': 'मराठी कारण'}], 'fundingNote': 'सध्याच्या अटी तपासा.',
  };

  @override
  Future<Map<String, dynamic>> request(String path, {Map<String, dynamic>? body, String? method}) async {
    if (body != null) posts.putIfAbsent(path.split('?').first, () => []).add(body);
    gets.add(path);
    if (path == '/me/ideas') return {'ideas': [{'pitchId': 'p1', 'title': 'Tailoring shop', 'status': 'NOT_YET', 'potential': 58, 'band': 'Promising'}]};
    if (path == '/me/ideas/p1?lang=mr') return dashboard;
    if (path == '/me/ideas/p1/localize?lang=mr') { translated = true; return {'localized': localized}; }
    if (path == '/me/ideas/p1/improve?lang=mr') {
      return {'improve': {'summary': 'खर्च स्पष्ट करा.', 'lang': 'mr', 'suggestions': [
        {'area': 'financial_logic', 'priority': 'high', 'issue': 'खर्च दिलेला नाही.', 'action': 'मासिक खर्चाची यादी करा.', 'example': 'भाडे ₹___'}]}};
    }
    throw ApiException('Unexpected $path', 500);
  }

  @override
  Future<Map<String, dynamic>> uploadChunk(String documentId, int offset, List<int> bytes) => throw UnimplementedError();
  @override
  Future<List<int>> download(String path) => throw UnimplementedError();
}

void main() {
  late Directory dir;
  late IdeasServer server;
  final shared = <(String, String)>[];
  final html = <String>[];
  setUp(() async {
    dir = await Directory.systemTemp.createTemp('ideas-ui');
    server = IdeasServer();
    shared.clear();
    html.clear();
  });
  tearDown(() => dir.delete(recursive: true));

  Future<void> open(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final services = IntakeServices(api: server, store: MemoryStore(), directory: () async => dir, recorder: FakeRecorder.new,
        pickFile: () async => null, shareFile: (path, mime, origin) async => shared.add((path, mime)),
        htmlToPdf: (page) async { html.add(page); return '%PDF-1.7 mr'.codeUnits; });
    await tester.pumpWidget(MaterialApp(home: MyIdeasScreen(ctx: EntrepreneurContext(api: server, speech: RecordingSpeech(), language: 'mr'), services: services)));
    await settle(tester);
  }

  Future<void> openIdea(WidgetTester tester) async {
    await open(tester);
    await tester.tap(find.byKey(const Key('idea-p1')));
    await settle(tester);
  }

  testWidgets('My ideas lists business ideas by name and opens a dashboard translated into the person\'s language', (tester) async {
    await open(tester);
    expect(find.text('Tailoring shop'), findsOneWidget);
    await tester.tap(find.byKey(const Key('idea-p1')));
    await settle(tester);
    expect(server.posts['/me/ideas/p1/localize'], hasLength(1)); // asked for Marathi once
    expect(tester.widget<Text>(find.byKey(const Key('dash-stage'))).data, tr('mr', 'ideaStage_not_selected'));
    for (final section in ['score', 'feedback', 'improve', 'draft', 'funding']) {
      expect(find.byKey(Key('dash-$section')), findsOneWidget);
    }
  });

  testWidgets('Score shows the evaluator\'s final evaluation with translated reasons', (tester) async {
    await openIdea(tester);
    await tester.tap(find.byKey(const Key('dash-score')));
    await settle(tester);
    expect(find.byKey(const Key('score-potential')), findsOneWidget);
    expect(find.text('58'), findsOneWidget);
    expect(find.text(tr('mr', 'domain_financial_logic')), findsOneWidget);
    expect(find.text('खर्च अस्पष्ट'), findsOneWidget);
  });

  testWidgets('Evaluator feedback shows the decision and the evaluator\'s message', (tester) async {
    await openIdea(tester);
    await tester.tap(find.byKey(const Key('dash-feedback')));
    await settle(tester);
    expect(find.text(tr('mr', 'outcomeNotSelectedTitle')), findsOneWidget);
    expect(find.text('तुमचा मासिक खर्च काढा.'), findsOneWidget);
  });

  testWidgets('Improve your pitch asks the AI coach and shows suggestions', (tester) async {
    await openIdea(tester);
    await tester.tap(find.byKey(const Key('dash-improve')));
    await settle(tester);
    await tester.tap(find.byKey(const Key('improve-ask')));
    await settle(tester);
    expect(server.posts['/me/ideas/p1/improve'], hasLength(1));
    expect(find.text('खर्च स्पष्ट करा.'), findsOneWidget);
    expect(find.text('मासिक खर्चाची यादी करा.'), findsOneWidget);
    expect(find.text(tr('mr', 'improvePriority_high')), findsOneWidget);
  });

  testWidgets('Business draft is in the person\'s language and downloads as a PDF in that language', (tester) async {
    await openIdea(tester);
    await tester.tap(find.byKey(const Key('dash-draft')));
    await settle(tester);
    expect(find.text('उत्तर 1'), findsOneWidget);
    await tester.tap(find.byKey(const Key('draft-download')));
    await settle(tester);
    expect(html.single, contains('उत्तर 2'));
    expect(html.single, contains(tr('mr', 'draftName')));
    expect(html.single, contains('Asha'));
    expect(shared.single.$2, 'application/pdf');
    expect(shared.single.$1, endsWith('business-idea-brief-mr-p1.pdf'));
  });

  testWidgets('Funding lists schemes, best matches first, with the official website', (tester) async {
    await openIdea(tester);
    await tester.tap(find.byKey(const Key('dash-funding')));
    await settle(tester);
    expect(find.text('Pradhan Mantri MUDRA Yojana (PMMY)'), findsOneWidget);
    expect(find.text('सध्याच्या अटी तपासा.'), findsOneWidget);
    await tester.tap(find.text('Pradhan Mantri MUDRA Yojana (PMMY)'));
    await settle(tester);
    expect(find.text('https://www.mudra.org.in'), findsOneWidget);
  });
}
