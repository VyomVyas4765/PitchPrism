import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pitchprism_app/entrepreneur/entrepreneur_shell.dart';
import 'package:pitchprism_app/intake/services.dart';
import 'package:pitchprism_app/main.dart';

import 'intake_ui_test.dart' show ScreenServer, SilentSpeech, FakeRecorder;
import 'outbox_test.dart' show MemoryStore;

/// M-19: large touch targets and labelled controls on the screens an entrepreneur sees first.
void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  testWidgets('the language picker meets Android tap-target and label guidelines', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(PitchPrismApp(speech: SilentSpeech()));
    await tester.pumpAndSettle();
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    handle.dispose();
  });

  testWidgets('home with the chat entry meets the same guidelines', (tester) async {
    final handle = tester.ensureSemantics();
    final server = ScreenServer();
    final services = IntakeServices(api: server, store: MemoryStore(), directory: () async => Directory.systemTemp,
        recorder: FakeRecorder.new, pickFile: () async => null);
    await tester.pumpWidget(MaterialApp(home: EntrepreneurShell(api: server, speech: SilentSpeech(), language: 'hi',
        onChangeLanguage: () {}, onSignOut: () async {}, services: (_) => services)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('home-chat')), findsOneWidget);
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    handle.dispose();
  });
}
