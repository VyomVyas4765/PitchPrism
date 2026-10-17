import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pitchprism_app/core/speech.dart';
import 'package:pitchprism_app/entrepreneur/common.dart';
import 'package:pitchprism_app/entrepreneur/entrepreneur_shell.dart';
import 'package:pitchprism_app/facilitator/applicant_screen.dart';
import 'package:pitchprism_app/intake/device.dart';
import 'package:pitchprism_app/intake/outbox.dart';
import 'package:pitchprism_app/intake/services.dart';
import 'package:pitchprism_app/l10n/strings.dart';

import 'outbox_test.dart' show FakeServer, MemoryStore;

/// Adds the read endpoints the screens need to the outbox fake server.
class ScreenServer extends FakeServer {
  @override
  Future<Map<String, dynamic>> request(String path, {Map<String, dynamic>? body, String? method}) async {
    if (path == '/pitch-prompts') {
      return {'steps': [
        for (final key in ['sell', 'buyers', 'where', 'money', 'skills'])
          {'key': key, 'maxSeconds': 120, 'prompt': {for (final language in launchLanguages) language: 'Prompt $key $language'}},
      ]};
    }
    if (path == '/centres') return {'centres': [{'id': 'centre1', 'name': 'Synthetic centre'}]};
    if (path == '/me') {
      return {'id': 'entrepreneur1', 'language': 'en', 'noticeVersion': consentNoticeVersion, 'profileComplete': true,
        'profile': {}, 'consents': {'processing': {'id': 'c1'}, 'sharing': {'sector_partner': null, 'funding_partner': null}}};
    }
    return super.request(path, body: body, method: method);
  }
}

class FakeRecorder implements Recorder {
  String? _path;
  @override
  Future<bool> hasPermission() async => true;
  @override
  Future<void> start(String path) async => _path = path;
  @override
  Future<void> pause() async {}
  @override
  Future<void> resume() async {}
  @override
  Future<String?> stop() async {
    await File(_path!).writeAsBytes(List.generate(4000, (index) => index % 256));
    return _path;
  }
  @override
  Future<void> dispose() async {}
}

class SilentSpeech implements Speech {
  @override
  Future<bool> isAvailable(String language) async => true;
  @override
  Future<void> speak(String text, String language) async {}
  @override
  Future<void> stop() async {}
}

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 15; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 15)));
    await tester.pump(const Duration(milliseconds: 50));
  }
}

void tallScreen(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 4000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  late Directory dir;
  late ScreenServer server;
  late MemoryStore store;
  late IntakeServices services;
  setUp(() async {
    dir = await Directory.systemTemp.createTemp('intake-ui');
    server = ScreenServer();
    store = MemoryStore();
    services = IntakeServices(api: server, store: store, directory: () async => dir, recorder: FakeRecorder.new, pickFile: () async => null);
  });
  tearDown(() => dir.delete(recursive: true));

  Future<void> openHome(WidgetTester tester) async {
    tallScreen(tester);
    await tester.pumpWidget(MaterialApp(home: EntrepreneurShell(api: server, speech: SilentSpeech(), language: 'en',
        onChangeLanguage: () {}, onSignOut: () async {}, services: (_) => services)));
    await settle(tester);
  }

  testWidgets('a typed pitch is saved on the phone, needs a centre, then reaches the server once', (tester) async {
    {
      await openHome(tester);
      await tester.tap(find.byKey(const Key('home-type')));
      await settle(tester);
      await tester.enterText(find.byKey(const Key('answer-sell')), 'Mobile phone repair');
      await tester.tap(find.byKey(const Key('pitch-send')));
      await settle(tester);
      expect(find.text(tr('en', 'chooseCentre')), findsOneWidget);
      expect(server.pitches, isEmpty);
      await tester.tap(find.byKey(const Key('pitch-centre')));
      await settle(tester);
      await tester.tap(find.text('Synthetic centre').last);
      await settle(tester);
      await tester.tap(find.byKey(const Key('pitch-send')));
      await settle(tester);
    }
    final saved = await store.load();
    expect(saved.single.status, 'sent');
    expect(server.pitches.values.single['centreId'], 'centre1');
    expect(server.pitches.values.single['answers'], [{'step': 'sell', 'text': 'Mobile phone repair'}]);
    expect(server.submissions, 1);
  });

  testWidgets('a guided step records into app storage and a re-record replaces the earlier take', (tester) async {
    {
      await openHome(tester);
      await tester.tap(find.byKey(const Key('home-speak')));
      await settle(tester);
      final draft = (await store.load()).single.clientDraftId;
      Future<void> takeOne() async {
        await tester.tap(find.byKey(Key('record-$draft-sell')));
        await settle(tester);
        expect(find.byKey(Key('stop-$draft-sell')), findsOneWidget);
        await tester.tap(find.byKey(Key('stop-$draft-sell')));
        await settle(tester);
      }
      await takeOne();
      await takeOne();
      final item = (await store.load()).single;
      expect(item.files.single.promptStep, 'sell');
      expect(item.files.single.bytes, 4000);
      expect(File(item.files.single.path).existsSync(), isTrue);
      expect(dir.listSync().whereType<File>().where((file) => file.path.endsWith('.m4a')).length, 1);
    }
  });

  testWidgets('an assisted pitch cannot start before the consent recording and confirmation', (tester) async {
    tallScreen(tester);
    final ctx = EntrepreneurContext(api: server, speech: SilentSpeech(), language: 'en');
    {
      await tester.pumpWidget(MaterialApp(home: ApplicantScreen(ctx: ctx, services: services)));
      await settle(tester);
      expect(tester.widget<FilledButton>(find.byKey(const Key('applicant-typed'))).onPressed, isNull);
      await tester.enterText(find.byKey(const Key('applicant-name')), 'Synthetic Applicant');
      await tester.enterText(find.byKey(const Key('applicant-district')), 'Nashik');
      await tester.enterText(find.byKey(const Key('applicant-trade')), 'Tailoring');
      expect(tester.widget<CheckboxListTile>(find.byKey(const Key('applicant-confirm'))).onChanged, isNull);
      final stem = find.byWidgetPredicate((widget) => widget is FilledButton && widget.key is ValueKey<String>
          && (widget.key as ValueKey<String>).value.startsWith('record-applicant-'));
      await tester.tap(stem);
      await settle(tester);
      await tester.tap(find.byWidgetPredicate((widget) => widget.key is ValueKey<String> && (widget.key as ValueKey<String>).value.startsWith('stop-applicant-')));
      await settle(tester);
      await tester.tap(find.byKey(const Key('applicant-confirm')));
      await settle(tester);
      await tester.tap(find.byKey(const Key('applicant-typed')));
      await settle(tester);
    }
    final item = (await store.load()).single;
    expect(item.applicant!.fields, {'language': 'en', 'name': 'Synthetic Applicant', 'trade': 'Tailoring', 'district': 'Nashik'});
    expect(item.applicant!.consentRecording.bytes, 4000);
    expect(item.mode, 'typed');
  });
}
