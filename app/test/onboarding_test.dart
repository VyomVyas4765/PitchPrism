import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pitchprism_app/core/api.dart';
import 'package:pitchprism_app/core/speech.dart';
import 'package:pitchprism_app/entrepreneur/common.dart';
import 'package:pitchprism_app/entrepreneur/consent_screen.dart';
import 'package:pitchprism_app/entrepreneur/entrepreneur_shell.dart';
import 'package:pitchprism_app/entrepreneur/passport_screen.dart';
import 'package:pitchprism_app/entrepreneur/profile_screen.dart';
import 'package:pitchprism_app/entrepreneur/onboarding_copy.dart';
import 'package:pitchprism_app/intake/services.dart';
import 'package:pitchprism_app/l10n/strings.dart';
import 'package:pitchprism_app/main.dart';

import 'outbox_test.dart' show MemoryStore;

typedef Call = ({String method, String path, Map<String, dynamic>? body});

class FakeApi implements ApiClient {
  FakeApi(this.respond);
  final Map<String, dynamic> Function(Call call) respond;
  final calls = <Call>[];
  @override
  Future<Map<String, dynamic>> request(String path, {Map<String, dynamic>? body, String? method}) async {
    final call = (method: method ?? (body == null ? 'GET' : 'POST'), path: path, body: body);
    calls.add(call);
    return respond(call);
  }

  @override
  Future<Map<String, dynamic>> uploadChunk(String documentId, int offset, List<int> bytes) =>
      throw UnimplementedError();

  @override
  Future<List<int>> download(String path) async => throw UnimplementedError();
}

/// Odia has no voice on this fake phone; everything else does.
class FakeSpeech implements Speech {
  final spoken = <(String, String)>[];
  @override
  Future<bool> isAvailable(String language) async => language != 'or';
  @override
  Future<void> speak(String text, String language) async => spoken.add((text, language));
  @override
  Future<void> stop() async {}
}

Map<String, dynamic> me({bool consent = false, bool complete = false, String? language = 'mr'}) => {
  'id': 'synthetic', 'language': language, 'noticeVersion': 'consent-notice-2026-10-17', 'profileComplete': complete,
  'onboardingComplete': complete,
  'profile': {'name': complete ? 'Synthetic Applicant' : null, 'district': null, 'pincode': null, 'trade': null, 'gender': null},
  'consents': {
    'processing': consent ? {'id': 'c1'} : null,
    'sharing': {'sector_partner': null, 'funding_partner': null},
  },
};

void tallScreen(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Widget host(Widget child) => MaterialApp(home: Scaffold(body: child));
EntrepreneurContext ctxWith(ApiClient api, {String language = 'mr', Speech? speech}) =>
    EntrepreneurContext(api: api, speech: speech ?? FakeSpeech(), language: language);

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test('every launch language defines every string', () {
    final keys = allStrings['en']!.keys.toSet();
    expect(allStrings.keys.toSet(), launchLanguages.toSet());
    for (final language in launchLanguages) {
      expect(allStrings[language]!.keys.toSet(), keys, reason: language);
      expect(allStrings[language]!.values.every((text) => text.trim().isNotEmpty), isTrue, reason: language);
    }
    expect(stringsReview.keys.toSet(), launchLanguages.toSet());
    final onboardingKeys = onboardingCopy['en']!.keys.toSet();
    for (final language in launchLanguages) {
      expect(onboardingCopy[language]!.keys.toSet(), onboardingKeys, reason: language);
    }
  });

  testWidgets('first launch asks for a language, flags missing voices, and remembers the choice', (tester) async {
    tallScreen(tester);
    final speech = FakeSpeech();
    await tester.pumpWidget(PitchPrismApp(speech: speech));
    await tester.pumpAndSettle();
    for (final language in launchLanguages) {
      expect(find.byKey(Key('language-$language')), findsOneWidget);
    }
    expect(find.textContaining(tr('or', 'voiceUnavailable')), findsOneWidget);
    expect(tester.widget<IconButton>(find.byKey(const Key('listen-or'))).onPressed, isNull);
    await tester.tap(find.byKey(const Key('listen-mr')));
    expect(speech.spoken.single, (tr('mr', 'chooseLanguage'), 'mr'));
    await tester.tap(find.byKey(const Key('language-mr')));
    await tester.pumpAndSettle();
    expect(await const FlutterSecureStorage().read(key: 'language'), 'mr');
    expect(find.byKey(const Key('language-mr')), findsNothing);
  });

  testWidgets('processing consent is required; sharing is optional and recorded separately', (tester) async {
    tallScreen(tester);
    final api = FakeApi((call) => {'consent': {}, 'consents': {}});
    var done = false;
    await tester.pumpWidget(host(ConsentScreen(ctx: ctxWith(api), noticeVersion: 'consent-notice-2026-10-17', onDone: () => done = true)));
    expect(tester.widget<FilledButton>(find.byKey(const Key('consent-save'))).onPressed, isNull);
    expect(tester.widget<SwitchListTile>(find.byKey(const Key('share-sector_partner'))).onChanged, isNull);
    await tester.tap(find.byKey(const Key('consent-processing')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('share-sector_partner')));
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('consent-save')));
    await tester.tap(find.byKey(const Key('consent-save')));
    await tester.pumpAndSettle();
    expect(done, isTrue);
    expect(api.calls.map((call) => call.body), [
      {'purpose': 'processing', 'noticeVersion': 'consent-notice-2026-10-17', 'language': 'mr', 'method': 'app_tap'},
      {'purpose': 'partner_sharing', 'scope': 'sector_partner', 'noticeVersion': 'consent-notice-2026-10-17', 'language': 'mr', 'method': 'app_tap'},
    ]);
  });

  testWidgets('one-time application validates and sends all scenario prompts', (tester) async {
    tallScreen(tester);
    final api = FakeApi((call) => me(consent: true, complete: true));
    var done = false;
    await tester.pumpWidget(host(ProfileScreen(ctx: ctxWith(api, language: 'en'),
      profile: const {'state': 'Andhra Pradesh'}, onDone: () => done = true)));
    await tester.ensureVisible(find.byKey(const Key('profile-save')));
    await tester.tap(find.byKey(const Key('profile-save')));
    await tester.pump();
    expect(api.calls, isEmpty);
    const values = {
      'name': 'Synthetic Applicant', 'mobile': '+91 9123456789', 'education': 'Trade training',
      'workBackground': 'Two years stitching', 'village': 'Sample village', 'block': 'Sample block',
      'district': 'Nashik', 'pincode': '422001', 'trade': 'Tailoring', 'setupLocation': 'Rented room',
      'productsServices': 'Garments', 'targetCustomers': 'Local families', 'marketResearch': 'Visited shops',
      'rawMaterials': 'Fabric', 'suppliers': 'Wholesalers', 'fundingSources': 'Savings',
      'competition': 'Two tailors', 'prices': '400 rupees', 'expectedMonthlyRevenue': '40000 rupees',
    };
    for (final entry in values.entries) {
      final field = find.byKey(Key('profile-${entry.key}'));
      await tester.ensureVisible(field);
      await tester.enterText(field, entry.value);
    }
    await tester.ensureVisible(find.byKey(const Key('profile-save')));
    await tester.tap(find.byKey(const Key('profile-save')));
    await tester.pumpAndSettle();
    expect(done, isTrue);
    final call = api.calls.single;
    expect('${call.method} ${call.path}', 'POST /me/onboarding');
    expect(call.body, {...values, 'state': 'Andhra Pradesh', 'gender': null, 'creditScore': null});
  });

  testWidgets('the server state decides consent, then profile, then home; the device language is synced', (tester) async {
    var state = me(language: null);
    final api = FakeApi((call) => call.method == 'PUT' ? (state = {...state, 'language': 'mr'}) : state);
    Future<void> show() async {
      await tester.pumpWidget(MaterialApp(home: EntrepreneurShell(api: api, speech: FakeSpeech(), language: 'mr',
          onChangeLanguage: () {}, onSignOut: () async {},
          services: (_) => IntakeServices(api: api, store: MemoryStore(), directory: () async => Directory.systemTemp,
              recorder: () => throw UnimplementedError(), pickFile: () async => null))));
      await tester.pumpAndSettle();
    }
    await show();
    expect(api.calls.map((call) => '${call.method} ${call.path}'), ['GET /me', 'PUT /me']);
    expect(api.calls.last.body, {'language': 'mr'});
    expect(find.byType(ConsentScreen), findsOneWidget);
    state = me(consent: true);
    await tester.pumpWidget(const SizedBox());
    await show();
    expect(find.byType(ProfileScreen), findsOneWidget);
    state = me(consent: true, complete: true);
    await tester.pumpWidget(const SizedBox());
    await show();
    for (final key in ['speak', 'type', 'upload']) {
      expect(find.byKey(Key('home-$key')), findsOneWidget);
    }
  });

  testWidgets('an expired session returns to sign-in', (tester) async {
    var signedOut = false;
    final api = FakeApi((call) => throw const ApiException('Your session has expired. Please sign in again.', 401));
    await tester.pumpWidget(MaterialApp(home: EntrepreneurShell(api: api, speech: FakeSpeech(), language: 'en',
        onChangeLanguage: () {}, onSignOut: () async => signedOut = true)));
    await tester.pumpAndSettle();
    expect(signedOut, isTrue);
  });

  testWidgets('Idea Passport revokes sharing on the server and shows who can see each idea', (tester) async {
    var sharing = <String, dynamic>{'sector_partner': {'id': 'share-consent'}, 'funding_partner': null};
    final api = FakeApi((call) {
      if (call.path.endsWith('/revoke')) sharing = {...sharing, 'sector_partner': null};
      return {
        'consents': {'processing': {'id': 'c1'}, 'sharing': sharing},
        'ideas': [{'id': 'i1', 'title': 'Synthetic papad unit', 'status': 'READY', 'visibleTo': [
          {'name': 'Synthetic centre', 'type': 'centre', 'reason': 'owning_centre'},
          if (sharing['sector_partner'] != null) {'name': 'Synthetic agri partner', 'type': 'sector_partner', 'reason': 'consented_share'},
        ]}],
      };
    });
    await tester.pumpWidget(MaterialApp(home: PassportScreen(ctx: ctxWith(api, language: 'en'), noticeVersion: 'consent-notice-2026-10-17')));
    await tester.pumpAndSettle();
    expect(find.text('Synthetic agri partner'), findsOneWidget);
    await tester.tap(find.byKey(const Key('passport-sector_partner')));
    await tester.pumpAndSettle();
    expect(api.calls.any((call) => call.path == '/consents/share-consent/revoke'), isTrue);
    expect(find.text('Synthetic agri partner'), findsNothing);
    expect(find.text('Synthetic centre'), findsOneWidget);
  });
}
