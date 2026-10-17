import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pitchprism_app/core/api.dart';
import 'package:pitchprism_app/intake/outbox.dart';

/// In-memory server with the real API's rules: client IDs are idempotent,
/// chunks must arrive at the expected offset, and content must match its hash.
class FakeServer implements ApiClient {
  final calls = <String>[];
  final pitches = <String, Map<String, dynamic>>{};
  final documents = <String, Map<String, dynamic>>{};
  final applicants = <String, String>{};
  final consents = <Map<String, dynamic>>[];
  int submissions = 0;
  int? failAtCall;
  var _ids = 0;

  void _maybeFail() {
    if (failAtCall != null && calls.length == failAtCall) {
      failAtCall = null;
      throw const SocketException('synthetic network drop');
    }
  }

  @override
  Future<Map<String, dynamic>> request(String path, {Map<String, dynamic>? body, String? method}) async {
    calls.add('${method ?? (body == null ? 'GET' : 'POST')} $path');
    _maybeFail();
    if (path == '/assisted/applicants') {
      return {'id': applicants.putIfAbsent(body!['clientApplicantId'] as String, () => 'applicant${_ids++}')};
    }
    if (path.endsWith('/evidence') || path.endsWith('/documents')) {
      final existing = documents.values.where((doc) => doc['clientFileId'] == body!['clientFileId']).firstOrNull;
      final doc = existing ?? (documents['doc${_ids++}'] = {...body!, 'id': 'doc${_ids - 1}', 'received': <int>[], 'state': 'receiving'});
      return {'id': doc['id'], 'receivedBytes': (doc['received'] as List).length, 'state': doc['state']};
    }
    if (path.endsWith('/consents')) {
      consents.add(body!);
      return {};
    }
    if (path == '/pitches') {
      final existing = pitches.values.where((pitch) => pitch['clientDraftId'] == body!['clientDraftId']).firstOrNull;
      final pitch = existing ?? (pitches['pitch${_ids++}'] = {...body!, 'id': 'pitch${_ids - 1}', 'status': 'DRAFT'});
      return {'id': pitch['id']};
    }
    if (path.endsWith('/answers')) {
      pitches[path.split('/')[2]]!['answers'] = body!['answers'];
      return {};
    }
    if (path.endsWith('/submit')) {
      final pitch = pitches[path.split('/')[2]]!;
      if (documents.values.any((doc) => doc['state'] == 'receiving')) throw const ApiException('Some files are still uploading.', 409);
      if (pitch['status'] == 'DRAFT') {
        pitch['status'] = 'SUBMITTED';
        pitch['submissionId'] = 'submission${submissions++}';
      }
      return {'submissionId': pitch['submissionId']};
    }
    throw ApiException('unexpected $path', 500);
  }

  @override
  Future<Map<String, dynamic>> uploadChunk(String documentId, int offset, List<int> bytes) async {
    calls.add('PUT /documents/$documentId/content@$offset');
    _maybeFail();
    final doc = documents[documentId]!;
    final received = doc['received'] as List<int>;
    if (offset != received.length) return {'receivedBytes': received.length, 'state': doc['state']};
    received.addAll(bytes);
    if (received.length == doc['bytes']) {
      doc['state'] = sha256.convert(received).toString() == doc['sha256'] ? 'complete' : 'rejected';
    }
    return {'receivedBytes': received.length, 'state': doc['state']};
  }
}

class MemoryStore implements OutboxStore {
  List<Map<String, dynamic>> saved = [];
  @override
  Future<List<OutboxItem>> load() async => saved.map(OutboxItem.fromJson).toList();
  @override
  Future<void> save(List<OutboxItem> items) async => saved = items.map((item) => item.toJson()).toList();
}

List<int> bytesOf(int size) => List.generate(size, (index) => index % 251);
OutboxFile fileFor(String id, List<int> data, {String kind = 'audio', String? step}) => OutboxFile(
  clientFileId: id, path: '/synthetic/$id', kind: kind, mime: kind == 'audio' ? 'audio/mp4' : 'application/pdf',
  bytes: data.length, sha256: sha256.convert(data).toString(), promptStep: step);

void main() {
  test('a queued pitch survives a network drop mid-upload and uploads each byte once', () async {
    final recording = bytesOf(chunkBytes * 2 + 100);
    final server = FakeServer();
    final store = MemoryStore();
    await store.save([
      OutboxItem(clientDraftId: 'draft-sync-0001', mode: 'guided', language: 'hi', centreId: 'centre1', status: 'queued',
        answers: {'where': 'Sinnar, Nashik'}, files: [fileFor('file-sell-0001', recording, step: 'sell')]),
    ]);
    final sync = OutboxSync(server, store, readFile: (_) async => recording);
    server.failAtCall = 5; // pitch, answers, register file, chunk 0 succeed; chunk 1 is lost
    var items = await sync.syncAll();
    expect(items.single.status, 'queued');
    expect(items.single.pitchId, isNotNull);
    expect(server.submissions, 0);

    // "App restart": a fresh engine reloads the store and resumes from the server's offset.
    items = await OutboxSync(server, store, readFile: (_) async => recording).syncAll();
    expect(items.single.status, 'sent');
    expect(items.single.submissionId, 'submission0');
    expect(server.pitches.length, 1);
    expect(server.documents.length, 1);
    final doc = server.documents.values.single;
    expect(doc['state'], 'complete');
    expect((doc['received'] as List).length, recording.length);
    expect(server.calls.where((call) => call.endsWith('@0')).length, 1);
    expect(server.pitches.values.single['answers'], [{'step': 'where', 'text': 'Sinnar, Nashik'}]);

    // Sent items are not replayed.
    final before = server.calls.length;
    await OutboxSync(server, store, readFile: (_) async => recording).syncAll();
    expect(server.calls.length, before);
  });

  test('a file damaged on the phone is reported, not submitted', () async {
    final server = FakeServer();
    final store = MemoryStore();
    final original = bytesOf(5000);
    await store.save([
      OutboxItem(clientDraftId: 'draft-damaged-01', mode: 'upload', language: 'en', centreId: 'centre1', status: 'queued',
        files: [fileFor('file-plan-0001', original, kind: 'pdf')]),
    ]);
    final damaged = [...original]..[10] = 0;
    final items = await OutboxSync(server, store, readFile: (_) async => damaged).syncAll();
    expect(items.single.status, 'failed');
    expect(items.single.lastError, contains('damaged'));
    expect(server.submissions, 0);
  });

  test('assisted items register the applicant, verify the consent recording, then pitch for that applicant', () async {
    final consentAudio = bytesOf(3000);
    final server = FakeServer();
    final store = MemoryStore();
    await store.save([
      OutboxItem(clientDraftId: 'draft-assist-01', mode: 'typed', language: 'te', status: 'queued', answers: {'sell': 'Tailoring'},
        applicant: OutboxApplicant(clientApplicantId: 'applicant-0001',
          fields: {'language': 'te', 'name': 'Synthetic Applicant', 'district': 'Ranga Reddy', 'trade': 'Tailoring'},
          consentRecording: fileFor('consent-0001', consentAudio), sharing: ['sector_partner'])),
      OutboxItem(clientDraftId: 'draft-local-02', mode: 'typed', language: 'te', status: 'draft'),
    ]);
    final items = await OutboxSync(server, store, readFile: (_) async => consentAudio).syncAll();
    expect(items.first.status, 'sent');
    expect(items.last.status, 'draft'); // still being edited, never sent
    expect(server.consents.map((consent) => consent['purpose']), ['processing', 'partner_sharing']);
    expect(server.consents.every((consent) => consent['checkboxConfirmed'] == true && consent['evidenceDocumentId'] != null), isTrue);
    expect(server.pitches.values.single['entrepreneurId'], 'applicant0');
    expect(server.calls.indexOf('POST /assisted/applicants'), lessThan(server.calls.indexOf('POST /pitches')));
  });

  test('the file store writes atomically and round-trips every field', () async {
    final dir = await Directory.systemTemp.createTemp('outbox-test');
    addTearDown(() => dir.delete(recursive: true));
    final store = FileOutboxStore(dir, 'account1');
    final item = OutboxItem(clientDraftId: 'draft-store-001', mode: 'guided', language: 'or', centreId: 'c1', status: 'queued',
      answers: {'money': '₹15,000'}, files: [fileFor('file-0001', bytesOf(10), step: 'money')]);
    await store.save([item]);
    final loaded = (await store.load()).single;
    expect(loaded.toJson(), item.toJson());
    expect(await FileOutboxStore(dir, 'account2').load(), isEmpty);
    expect(dir.listSync().whereType<File>().map((file) => file.path.split(Platform.pathSeparator).last), ['outbox-account1.json']);
  });
}
