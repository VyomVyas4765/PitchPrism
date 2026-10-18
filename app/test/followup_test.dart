import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pitchprism_app/core/api.dart';
import 'package:pitchprism_app/core/speech.dart';
import 'package:pitchprism_app/entrepreneur/common.dart';
import 'package:pitchprism_app/entrepreneur/followup_screen.dart';

/// Follows the D-33 API: questions while NEEDS_INPUT, "reviewing" after answers, then complete.
class FollowUpServer implements ApiClient {
  final sent = <Map<String, dynamic>>[];
  int reads = 0;
  @override
  Future<Map<String, dynamic>> request(String path, {Map<String, dynamic>? body, String? method}) async {
    expect(path, '/me/submissions/sub1/follow-ups');
    if (body != null) {
      sent.add(body);
      return {'status': 'QUEUED', 'review': 'needs_input', 'reviewing': true, 'questions': [], 'answered': 2};
    }
    reads++;
    if (sent.isEmpty) {
      return {'status': 'NEEDS_INPUT', 'review': 'needs_input', 'reviewing': false, 'answered': 0, 'questions': [
        {'qId': 'f1', 'field': 'customers', 'questionEn': 'Who will buy from you?'},
        {'qId': 'f2', 'field': 'market_research', 'questionEn': 'What have you done to check that people will buy?'},
      ]};
    }
    return reads <= 2
        ? {'status': 'PROCESSING', 'review': 'needs_input', 'reviewing': true, 'questions': [], 'answered': 2}
        : {'status': 'READY', 'review': 'complete', 'reviewing': false, 'questions': [], 'answered': 2};
  }

  @override
  Future<Map<String, dynamic>> uploadChunk(String documentId, int offset, List<int> bytes) => throw UnimplementedError();

  @override
  Future<List<int>> download(String path) => throw UnimplementedError();
}

class QuietSpeech implements Speech {
  @override
  Future<bool> isAvailable(String language) async => false;
  @override
  Future<void> speak(String text, String language) async {}
  @override
  Future<void> stop() async {}
}

void main() {
  testWidgets('answers every question together, then shows the review and the evaluation', (tester) async {
    final server = FollowUpServer();
    final ctx = EntrepreneurContext(api: server, speech: QuietSpeech(), language: 'en');
    await tester.pumpWidget(MaterialApp(home: FollowUpScreen(ctx: ctx, submissionId: 'sub1', title: 'Questions',
        pollEvery: const Duration(milliseconds: 10))));
    await tester.pumpAndSettle();
    expect(find.text('Who will buy from you?'), findsOneWidget);
    final send = find.byKey(const Key('followup-send'));
    expect(tester.widget<FilledButton>(send).onPressed, isNull); // every question needs an answer

    await tester.enterText(find.byKey(const Key('followup-answer-f1')), 'Women and schools in Sinnar town.');
    await tester.tap(find.byKey(const Key('followup-undecided-f2')));
    await tester.pump();
    expect(tester.widget<FilledButton>(send).onPressed, isNotNull);

    await tester.tap(send);
    await tester.pump();
    expect(server.sent.single['answers'], [
      {'qId': 'f1', 'text': 'Women and schools in Sinnar town.'},
      {'qId': 'f2', 'text': 'I have not decided this yet.'},
    ]);
    await tester.pump(const Duration(milliseconds: 1));
    expect(find.byKey(const Key('followup-reviewing')), findsOneWidget);

    await tester.pump(const Duration(milliseconds: 20)); // the screen checks back while the AI reads the answers
    await tester.pump(const Duration(milliseconds: 20));
    expect(find.byKey(const Key('followup-done')), findsOneWidget);
    expect(find.text('Your idea is complete and is now being evaluated.'), findsOneWidget);
  });
}
