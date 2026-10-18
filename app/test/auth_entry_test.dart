import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pitchprism_app/auth/auth_screen.dart';
import 'package:pitchprism_app/core/api.dart';
import 'package:pitchprism_app/l10n/strings.dart';

import 'intake_ui_test.dart' show SilentSpeech;

/// Fake API for the sign-in screen; records calls and answers as the server would.
class AuthApi extends PitchPrismApi {
  AuthApi(this.role);
  final String role;
  final calls = <(String, Map<String, dynamic>?)>[];
  @override
  Future<Map<String, dynamic>> request(String path, {Map<String, dynamic>? body, String? method}) async {
    calls.add((path, body));
    if (path == '/health') return {'status': 'ok'};
    if (path == '/auth/register' || path == '/auth/login') {
      return {'user': {'id': 'u1', 'displayName': 'Entrepreneur', 'email': body!['email'], 'role': role, 'orgId': null, 'orgType': null},
        'accessToken': 'synthetic-token'};
    }
    if (path == '/auth/logout') return {};
    if (path == '/me') {
      return {'id': 'u1', 'language': 'en', 'noticeVersion': 'consent-notice-2026-10-17', 'profileComplete': false, 'profile': {},
        'consents': {'processing': null, 'sharing': {'sector_partner': null, 'funding_partner': null}}};
    }
    throw ApiException('unexpected $path', 500);
  }
}

class PendingRestoreApi extends AuthApi {
  PendingRestoreApi() : super('entrepreneur');
  final restore = Completer<Map<String, dynamic>>();

  @override
  Future<bool> hasSession() async => true;

  @override
  Future<Map<String, dynamic>> request(String path, {Map<String, dynamic>? body, String? method}) =>
      path == '/auth/me' ? restore.future : super.request(path, body: body, method: method);
}

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({'language': 'en'}));

  testWidgets('sign-in is email and password only: no phone number or code', (tester) async {
    await tester.pumpWidget(MaterialApp(home: AuthScreen(speech: SilentSpeech(), api: AuthApi('entrepreneur'))));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('auth-email')), findsOneWidget);
    expect(find.byKey(const Key('auth-password')), findsOneWidget);
    expect(find.textContaining('code'), findsNothing);
    expect(find.textContaining('phone', findRichText: true), findsNothing);
  });

  testWidgets('an entrepreneur creates an account with a checked password and lands in the app', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = AuthApi('entrepreneur');
    await tester.pumpWidget(MaterialApp(home: AuthScreen(speech: SilentSpeech(), api: api)));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('auth-toggle')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('auth-email')), 'synthetic.entrepreneur@pitchprism.test');
    await tester.enterText(find.byKey(const Key('auth-password')), 'short');
    await tester.enterText(find.byKey(const Key('auth-confirm')), 'different');
    await tester.tap(find.byKey(const Key('auth-submit')));
    await tester.pumpAndSettle();
    expect(find.text(tr('en', 'passwordRule')), findsWidgets);
    expect(find.text(tr('en', 'passwordsDiffer')), findsOneWidget);
    expect(api.calls.where((call) => call.$1 == '/auth/register'), isEmpty);
    await tester.enterText(find.byKey(const Key('auth-password')), 'Synthetic-passphrase-42');
    await tester.enterText(find.byKey(const Key('auth-confirm')), 'Synthetic-passphrase-42');
    await tester.tap(find.byKey(const Key('auth-submit')));
    await tester.pumpAndSettle();
    final register = api.calls.firstWhere((call) => call.$1 == '/auth/register');
    expect(register.$2, {'email': 'synthetic.entrepreneur@pitchprism.test', 'password': 'Synthetic-passphrase-42', 'client': 'mobile'});
    expect(await const FlutterSecureStorage().read(key: 'session'), 'synthetic-token');
    expect(find.text(tr('en', 'consentTitle')), findsOneWidget); // the consent step comes first
  });

  testWidgets('staff roles are sent to the web dashboard and signed out', (tester) async {
    final api = AuthApi('centre_assessor');
    await tester.pumpWidget(MaterialApp(home: AuthScreen(speech: SilentSpeech(), api: api)));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('auth-email')), 'assessor@pitchprism.test');
    await tester.enterText(find.byKey(const Key('auth-password')), 'Synthetic-passphrase-42');
    await tester.tap(find.byKey(const Key('auth-submit')));
    await tester.pumpAndSettle();
    expect(find.text(tr('en', 'staffUseWeb')), findsOneWidget);
    expect(api.calls.map((call) => call.$1), contains('/auth/logout'));
    expect(await const FlutterSecureStorage().read(key: 'session'), isNull);
  });

  testWidgets('offline demo opens consent, onboarding and home without a server session', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await const FlutterSecureStorage().delete(key: 'session');
    final api = AuthApi('entrepreneur');
    await tester.pumpWidget(MaterialApp(home: AuthScreen(speech: SilentSpeech(), api: api)));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('auth-demo')));
    await tester.pumpAndSettle();
    expect(find.byWidgetPredicate((widget) => widget is Banner && widget.message == 'OFFLINE DEMO'), findsOneWidget);
    expect(find.text(tr('en', 'consentTitle')), findsOneWidget);

    await tester.ensureVisible(find.byKey(const Key('consent-processing')));
    await tester.tap(find.byKey(const Key('consent-processing')));
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('consent-save')));
    await tester.tap(find.byKey(const Key('consent-save')));
    await tester.pumpAndSettle();
    expect(find.text(tr('en', 'profileTitle')), findsOneWidget);
    expect(tester.widget<TextFormField>(find.byKey(const Key('profile-name'))).controller!.text, 'Demo Entrepreneur');

    await tester.ensureVisible(find.byKey(const Key('profile-save')));
    await tester.tap(find.byKey(const Key('profile-save')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('home-chat')), findsOneWidget);
    await tester.tap(find.byKey(const Key('home-chat')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('chat-opening')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('chat-input')), 'A synthetic tailoring idea.');
    await tester.tap(find.byKey(const Key('chat-send')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('chat-q-demo')), findsOneWidget); // the demo says it analyses nothing
    expect(find.text(tr('en', 'chatDemoNote')), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(api.calls, isEmpty);
    expect(await const FlutterSecureStorage().read(key: 'session'), isNull);

    await tester.tap(find.byTooltip(tr('en', 'signOut')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('auth-email')), findsOneWidget);
  });

  testWidgets('offline demo remains available while an old session cannot be restored', (tester) async {
    final api = PendingRestoreApi();
    await tester.pumpWidget(MaterialApp(home: AuthScreen(speech: SilentSpeech(), api: api)));
    await tester.pump();
    await tester.tap(find.byKey(const Key('auth-demo')));
    await tester.pumpAndSettle();
    api.restore.complete({'user': {'id': 'real-user', 'role': 'entrepreneur'}});
    await tester.pumpAndSettle();
    expect(find.byWidgetPredicate((widget) => widget is Banner && widget.message == 'OFFLINE DEMO'), findsOneWidget);
    expect(find.text(tr('en', 'consentTitle')), findsOneWidget);
  });
}
