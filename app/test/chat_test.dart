import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pitchprism_app/core/api.dart';
import 'package:pitchprism_app/core/speech.dart';
import 'package:pitchprism_app/entrepreneur/chat_screen.dart';
import 'package:pitchprism_app/entrepreneur/common.dart';
import 'package:pitchprism_app/intake/services.dart';
import 'package:pitchprism_app/l10n/strings.dart';

import 'intake_ui_test.dart' show FakeRecorder;
import 'outbox_test.dart' show MemoryStore;

/// Follows the M-05 chat API: opening reply, the review's questions in Hindi (one left in English), a PDF reply,
/// then completion. Synthetic text only.
class ChatServer implements ApiClient {
  final posts = <String, List<Map<String, dynamic>>>{};
  final chunks = <int>[];
  final messages = <Map<String, dynamic>>[];
  String state = 'start';
  int reads = 0;
  int evaluations = 0;
  bool failNext = false;

  Map<String, dynamic> get view => {'pitchId': 'p1', 'language': 'hi', 'state': state, 'round': messages.length, 'messages': List.of(messages),
      'canSubmit': state == 'complete', 'brief': <Map<String, dynamic>>[]};

  @override
  Future<Map<String, dynamic>> request(String path, {Map<String, dynamic>? body, String? method}) async {
    if (body != null) posts.putIfAbsent(path, () => []).add(body);
    if (path == '/centres') return {'centres': [{'id': 'c1', 'name': 'Nashik centre'}, {'id': 'c2', 'name': 'Pune centre'}]};
    if (path == '/pitches' && body != null) return {'id': 'p1'};
    if (path == '/pitches/p1/documents') return {'id': 'd1', 'receivedBytes': 0, 'state': 'receiving'};
    if (path == '/pitches/p1/chat/submit') {
      state = 'evaluating';
      evaluations = 0;
      return view;
    }
    if (path == '/pitches/p1/chat/retry') {
      state = 'reading';
      return view;
    }
    if (path == '/pitches/p1/chat' && body != null) {
      final round = messages.where((message) => message['role'] == 'user').length;
      messages.add({'role': 'user', 'round': round, 'kind': body['text'] != null ? 'text' : posts['/pitches/p1/documents']!.last['kind'], 'text': body['text']});
      state = 'reading';
      reads = 0;
      return view;
    }
    if (path == '/pitches/p1/chat') {
      reads++;
      if (state == 'evaluating' && ++evaluations >= 2) state = 'submitted';
      if (state == 'reading' && reads >= 2) {
        if (failNext) {
          failNext = false;
          state = 'failed';
        } else if (messages.length == 1) {
          messages.addAll([
            {'role': 'assistant', 'round': 1, 'qId': 'f1', 'field': 'customers', 'text': 'आपसे कौन खरीदेगा?', 'lang': 'hi'},
            {'role': 'assistant', 'round': 1, 'qId': 'f2', 'field': 'location', 'text': 'Where will the shop be?', 'lang': 'en'},
          ]);
          state = 'your_turn';
        } else {
          state = 'complete';
        }
      }
      return view;
    }
    throw ApiException('Unexpected $path', 500);
  }

  @override
  Future<Map<String, dynamic>> uploadChunk(String documentId, int offset, List<int> bytes) async {
    chunks.add(bytes.length);
    return {'receivedBytes': offset + bytes.length, 'state': 'complete'};
  }

  @override
  Future<List<int>> download(String path) async {
    if (path == '/pitches/p1/brief') return '%PDF-1.7 brief'.codeUnits;
    throw ApiException('Unexpected $path', 500);
  }
}

class RecordingSpeech implements Speech {
  final spoken = <(String, String)>[];
  @override
  Future<bool> isAvailable(String language) async => true;
  @override
  Future<void> speak(String text, String language) async => spoken.add((text, language));
  @override
  Future<void> stop() async {}
}

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 15)));
    await tester.pump(const Duration(milliseconds: 30));
  }
}

void main() {
  late Directory dir;
  late ChatServer server;
  late RecordingSpeech speech;
  late File form;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('chat-ui');
    form = File('${dir.path}${Platform.pathSeparator}form.pdf')..writeAsBytesSync(List.generate(3000, (index) => index % 256));
    server = ChatServer();
    speech = RecordingSpeech();
  });
  tearDown(() => dir.delete(recursive: true));

  Future<void> open(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final services = IntakeServices(api: server, store: MemoryStore(), directory: () async => dir, recorder: FakeRecorder.new,
        pickFile: () async => (path: form.path, name: 'form.pdf'),
        pickPdf: () async => (path: form.path, name: 'form.pdf'),
        pickPhoto: () async {
          final photo = File('${dir.path}${Platform.pathSeparator}form.jpg')..writeAsBytesSync(List.generate(2500, (index) => index % 256));
          return (path: photo.path, name: 'form.jpg');
        },
        pickAudio: () async {
          final note = File('${dir.path}${Platform.pathSeparator}note.ogg')..writeAsBytesSync(List.generate(2000, (index) => index % 256));
          return (path: note.path, name: 'note.ogg');
        });
    await tester.pumpWidget(MaterialApp(home: ChatScreen(ctx: EntrepreneurContext(api: server, speech: speech, language: 'hi'),
        services: services, pollEvery: const Duration(milliseconds: 20))));
    await settle(tester);
  }

  testWidgets('the AI asks in Hindi and reads aloud; a typed opening and a PDF reply complete the idea', (tester) async {
    await open(tester);
    expect(find.text(tr('hi', 'chatOpening')), findsOneWidget);
    expect(speech.spoken.first, (tr('hi', 'chatOpening'), 'hi'));
    expect(tester.widget<IconButton>(find.byKey(const Key('chat-send'))).onPressed, isNull); // choose a centre first

    await tester.tap(find.byKey(const Key('chat-centre-c2')));
    await settle(tester);
    await tester.enterText(find.byKey(const Key('chat-input')), 'मैं सिलाई की दुकान खोलना चाहती हूँ।');
    await tester.tap(find.byKey(const Key('chat-send')));
    await settle(tester);
    expect(server.posts['/pitches']!.single, containsPair('centreId', 'c2'));
    expect(server.posts['/pitches']!.single, containsPair('mode', 'chat'));
    expect(server.posts['/pitches/p1/chat']!.single, {'text': 'मैं सिलाई की दुकान खोलना चाहती हूँ।'});

    await settle(tester); // the screen checks back while the AI reads
    expect(find.text('आपसे कौन खरीदेगा?'), findsOneWidget);
    expect(find.text(tr('hi', 'chatShownInEnglish')), findsOneWidget); // the English fallback says so
    expect(speech.spoken, containsAll([('आपसे कौन खरीदेगा?', 'hi'), ('Where will the shop be?', 'en')]));

    await tester.tap(find.byKey(const Key('chat-upload')));
    await settle(tester);
    await tester.tap(find.byKey(const Key('chat-upload-pdf')));
    await settle(tester);
    expect(server.posts['/pitches/p1/documents']!.single, containsPair('kind', 'pdf'));
    expect(server.chunks, [3000]);
    expect(server.posts['/pitches/p1/chat']!.last, {'documentId': 'd1'});
    expect(find.text(tr('hi', 'chatPdf')), findsOneWidget);
    await settle(tester);
    expect(find.byKey(const Key('chat-plan-ready')), findsOneWidget);
    expect(find.byKey(const Key('chat-input')), findsNothing);
  });

  testWidgets('a voice note is recorded and sent; read aloud can be turned off; a failed reading can be retried', (tester) async {
    server.failNext = true;
    await open(tester);
    await tester.tap(find.byKey(const Key('chat-read-aloud')));
    await settle(tester);
    final before = speech.spoken.length;
    await tester.tap(find.byKey(const Key('chat-centre-c1')));
    await settle(tester);
    await tester.tap(find.byKey(const Key('chat-record')));
    await settle(tester);
    expect(find.text(tr('hi', 'chatStopVoice')), findsOneWidget);
    await tester.tap(find.byKey(const Key('chat-record')));
    await settle(tester);
    expect(server.posts['/pitches/p1/documents']!.single, containsPair('mime', 'audio/mp4'));
    expect(find.text(tr('hi', 'chatVoiceNote')), findsOneWidget);
    await settle(tester);
    expect(find.byKey(const Key('chat-failed')), findsOneWidget);
    expect(speech.spoken.length, before); // nothing read aloud while it is off
    await tester.tap(find.byKey(const Key('chat-retry')));
    await settle(tester);
    await settle(tester);
    expect(find.text('आपसे कौन खरीदेगा?'), findsOneWidget);
  });

  testWidgets('Upload offers Send PDF and Add voice note; a saved voice note is sent as audio', (tester) async {
    await open(tester);
    await tester.tap(find.byKey(const Key('chat-centre-c1')));
    await settle(tester);
    expect(find.text(tr('hi', 'chatUpload')), findsOneWidget);
    await tester.tap(find.byKey(const Key('chat-upload')));
    await settle(tester);
    expect(find.text(tr('hi', 'chatUploadPdf')), findsOneWidget);
    expect(find.text(tr('hi', 'chatUploadVoice')), findsOneWidget);
    expect(find.text(tr('hi', 'chatUploadPhoto')), findsOneWidget);
    await tester.tap(find.byKey(const Key('chat-upload-voice')));
    await settle(tester);
    expect(server.posts['/pitches/p1/documents']!.single, containsPair('kind', 'audio'));
    expect(server.posts['/pitches/p1/documents']!.single, containsPair('mime', 'audio/ogg'));
    expect(server.chunks, [2000]);
    expect(find.text(tr('hi', 'chatVoiceNote')), findsOneWidget);
  });

  testWidgets('Upload → Send photo sends a photo of the form as an image', (tester) async {
    await open(tester);
    await tester.tap(find.byKey(const Key('chat-centre-c1')));
    await settle(tester);
    await tester.tap(find.byKey(const Key('chat-upload')));
    await settle(tester);
    await tester.tap(find.byKey(const Key('chat-upload-photo')));
    await settle(tester);
    expect(server.posts['/pitches/p1/documents']!.single, containsPair('kind', 'image'));
    expect(server.posts['/pitches/p1/documents']!.single, containsPair('mime', 'image/jpeg'));
    expect(server.chunks, [2500]);
  });

  testWidgets('a built plan waits for Send to evaluator, then follows the evaluator to its result', (tester) async {
    server.state = 'complete';
    final shared = <(String, String)>[];
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: ChatScreen(pitchId: 'p1', ctx: EntrepreneurContext(api: server, speech: speech, language: 'hi'),
        services: IntakeServices(api: server, store: MemoryStore(), directory: () async => dir, recorder: FakeRecorder.new,
            pickFile: () async => null, pickPdf: () async => null, pickPhoto: () async => null, pickAudio: () async => null,
            shareFile: (path, mime, origin) async => shared.add((path, mime))),
        pollEvery: const Duration(milliseconds: 20))));
    await settle(tester);
    expect(find.byKey(const Key('chat-plan-ready')), findsOneWidget);
    // The person can keep the same Business Idea Brief PDF the evaluator receives.
    await tester.tap(find.byKey(const Key('chat-download-brief')));
    await settle(tester);
    expect(shared.single.$2, 'application/pdf');
    expect(shared.single.$1, endsWith('business-idea-brief-p1.pdf'));
    expect(File(shared.single.$1).readAsStringSync(), '%PDF-1.7 brief');
    expect(find.byKey(const Key('chat-input')), findsNothing);
    expect(server.posts.containsKey('/pitches/p1/chat/submit'), isFalse); // nothing is sent until the button
    await tester.tap(find.byKey(const Key('chat-submit')));
    await settle(tester);
    expect(server.posts['/pitches/p1/chat/submit'], hasLength(1));
    await settle(tester);
    expect(find.byKey(const Key('chat-submitted')), findsOneWidget);
    expect(find.byKey(const Key('chat-submit')), findsNothing);
    expect(find.byKey(const Key('chat-download-brief')), findsOneWidget); // still downloadable after sending
  });
}
