import 'dart:convert';
import 'dart:io';

import '../core/api.dart';

/// Must match the server's current consent notice (backend CONSENT_NOTICE_VERSION).
const consentNoticeVersion = 'consent-notice-2026-10-17';
const chunkBytes = 1024 * 1024;

/// One file waiting to reach the server: a guided-step recording, an upload, or
/// a spoken-consent recording. Its copy lives in app storage, so it survives
/// the source being deleted and the app being closed.
class OutboxFile {
  OutboxFile({
    required this.clientFileId,
    required this.path,
    required this.kind,
    required this.mime,
    required this.bytes,
    required this.sha256,
    this.promptStep,
    this.documentId,
    this.state = 'pending',
  });
  final String clientFileId, path, kind, mime, sha256;
  final int bytes;
  final String? promptStep;
  String? documentId;
  String state; // pending | complete | rejected

  Map<String, dynamic> toJson() => {
    'clientFileId': clientFileId, 'path': path, 'kind': kind, 'mime': mime, 'bytes': bytes,
    'sha256': sha256, 'promptStep': promptStep, 'documentId': documentId, 'state': state,
  };
  factory OutboxFile.fromJson(Map<String, dynamic> json) => OutboxFile(
    clientFileId: json['clientFileId'] as String, path: json['path'] as String, kind: json['kind'] as String,
    mime: json['mime'] as String, bytes: json['bytes'] as int, sha256: json['sha256'] as String,
    promptStep: json['promptStep'] as String?, documentId: json['documentId'] as String?, state: json['state'] as String,
  );
}

/// An assisted applicant registered on this device (M-17).
class OutboxApplicant {
  OutboxApplicant({required this.clientApplicantId, required this.fields, required this.consentRecording, this.sharing = const []});
  final String clientApplicantId;
  final Map<String, dynamic> fields; // language, name, district, pincode, trade, gender
  final OutboxFile consentRecording;
  final List<String> sharing;
  Map<String, dynamic> toJson() => {
    'clientApplicantId': clientApplicantId, 'fields': fields, 'consentRecording': consentRecording.toJson(), 'sharing': sharing,
  };
  factory OutboxApplicant.fromJson(Map<String, dynamic> json) => OutboxApplicant(
    clientApplicantId: json['clientApplicantId'] as String,
    fields: Map<String, dynamic>.from(json['fields'] as Map),
    consentRecording: OutboxFile.fromJson(Map<String, dynamic>.from(json['consentRecording'] as Map)),
    sharing: (json['sharing'] as List).cast<String>(),
  );
}

/// One pitch and everything it needs, with the server IDs learned so far.
/// `status`: draft (still editing) · queued (waiting to sync) · sent · failed.
class OutboxItem {
  OutboxItem({
    required this.clientDraftId,
    required this.mode,
    required this.language,
    this.centreId,
    this.applicant,
    Map<String, String>? answers,
    List<OutboxFile>? files,
    this.applicantId,
    this.consentRecorded = false,
    this.pitchId,
    this.submissionId,
    this.status = 'draft',
    this.lastError,
    DateTime? createdAt,
  }) : answers = answers ?? {},
       files = files ?? [],
       createdAt = createdAt ?? DateTime.now();
  final String clientDraftId, mode, language;
  String? centreId;
  final OutboxApplicant? applicant;
  final Map<String, String> answers;
  final List<OutboxFile> files;
  String? applicantId, pitchId, submissionId, lastError;
  bool consentRecorded;
  String status;
  final DateTime createdAt;

  Map<String, dynamic> toJson() => {
    'clientDraftId': clientDraftId, 'mode': mode, 'language': language, 'centreId': centreId,
    'applicant': applicant?.toJson(), 'answers': answers, 'files': files.map((file) => file.toJson()).toList(),
    'applicantId': applicantId, 'consentRecorded': consentRecorded, 'pitchId': pitchId,
    'submissionId': submissionId, 'status': status, 'lastError': lastError, 'createdAt': createdAt.toIso8601String(),
  };
  factory OutboxItem.fromJson(Map<String, dynamic> json) => OutboxItem(
    clientDraftId: json['clientDraftId'] as String, mode: json['mode'] as String, language: json['language'] as String,
    centreId: json['centreId'] as String?,
    applicant: json['applicant'] == null ? null : OutboxApplicant.fromJson(Map<String, dynamic>.from(json['applicant'] as Map)),
    answers: Map<String, String>.from(json['answers'] as Map),
    files: (json['files'] as List).map((file) => OutboxFile.fromJson(Map<String, dynamic>.from(file as Map))).toList(),
    applicantId: json['applicantId'] as String?, consentRecorded: json['consentRecorded'] as bool? ?? false,
    pitchId: json['pitchId'] as String?, submissionId: json['submissionId'] as String?,
    status: json['status'] as String, lastError: json['lastError'] as String?,
    createdAt: DateTime.parse(json['createdAt'] as String),
  );
}

abstract class OutboxStore {
  Future<List<OutboxItem>> load();
  Future<void> save(List<OutboxItem> items);
}

/// Durable store: one JSON file per signed-in account, written atomically
/// (temp file then rename), so a crash mid-write never loses the queue.
class FileOutboxStore implements OutboxStore {
  FileOutboxStore(this.directory, this.account);
  final Directory directory;
  final String account;
  File get _file => File('${directory.path}${Platform.pathSeparator}outbox-$account.json');

  @override
  Future<List<OutboxItem>> load() async {
    if (!await _file.exists()) return [];
    final data = jsonDecode(await _file.readAsString()) as List;
    return data.map((item) => OutboxItem.fromJson(Map<String, dynamic>.from(item as Map))).toList();
  }

  @override
  Future<void> save(List<OutboxItem> items) async {
    await directory.create(recursive: true);
    final temp = File('${_file.path}.tmp');
    await temp.writeAsString(jsonEncode(items.map((item) => item.toJson()).toList()), flush: true);
    await temp.rename(_file.path);
  }
}

/// Replays each queued item against the API. Every step is idempotent on the
/// server (client IDs, offset-checked uploads), so a retry after a crash or a
/// dropped connection continues where it stopped and uploads each file once.
class OutboxSync {
  OutboxSync(this.api, this.store, {Future<List<int>> Function(String path)? readFile})
    : _readFile = readFile ?? ((path) => File(path).readAsBytes());
  final ApiClient api;
  final OutboxStore store;
  final Future<List<int>> Function(String path) _readFile;
  bool _running = false;

  Future<List<OutboxItem>> syncAll() async {
    final items = await store.load();
    if (_running) return items;
    _running = true;
    try {
      for (final item in items.where((item) => item.status == 'queued' || item.status == 'failed')) {
        await _sync(item, items);
      }
      return items;
    } finally {
      _running = false;
    }
  }

  Future<void> _sync(OutboxItem item, List<OutboxItem> items) async {
    Future<void> persist() => store.save(items);
    try {
      final applicant = item.applicant;
      if (applicant != null) {
        item.applicantId ??= (await api.request('/assisted/applicants',
            body: {'clientApplicantId': applicant.clientApplicantId, ...applicant.fields}))['id'] as String;
        await persist();
        if (!item.consentRecorded) {
          final evidence = applicant.consentRecording;
          if (evidence.state != 'complete') {
            final registered = await api.request('/assisted/applicants/${item.applicantId}/evidence', body: {
              'clientFileId': evidence.clientFileId, 'bytes': evidence.bytes, 'sha256': evidence.sha256, 'mime': evidence.mime,
            });
            evidence.documentId = registered['id'] as String;
            await _upload(evidence, (registered['receivedBytes'] as num).toInt(), registered['state'] as String);
            await persist();
            if (evidence.state != 'complete') throw const ApiException('The consent recording could not be verified. Record it again.', 422);
          }
          for (final consent in [
            {'purpose': 'processing'},
            for (final scope in applicant.sharing) {'purpose': 'partner_sharing', 'scope': scope},
          ]) {
            await api.request('/assisted/applicants/${item.applicantId}/consents', body: {
              ...consent, 'noticeVersion': consentNoticeVersion, 'language': item.language,
              'evidenceDocumentId': evidence.documentId, 'checkboxConfirmed': true,
            });
          }
          item.consentRecorded = true;
          await persist();
        }
      }
      item.pitchId ??= (await api.request('/pitches', body: {
        'clientDraftId': item.clientDraftId, 'mode': item.mode, 'language': item.language,
        if (item.applicantId != null) 'entrepreneurId': item.applicantId else if (item.centreId != null) 'centreId': item.centreId,
      }))['id'] as String;
      await persist();
      if (item.answers.isNotEmpty) {
        await api.request('/pitches/${item.pitchId}/answers', method: 'PUT', body: {
          'answers': [for (final entry in item.answers.entries) if (entry.value.trim().isNotEmpty) {'step': entry.key, 'text': entry.value.trim()}],
        });
      }
      for (final file in item.files.where((file) => file.state != 'complete')) {
        final registered = await api.request('/pitches/${item.pitchId}/documents', body: {
          'clientFileId': file.clientFileId, 'kind': file.kind, 'bytes': file.bytes, 'sha256': file.sha256, 'mime': file.mime,
          if (file.promptStep != null) 'promptStep': file.promptStep,
        });
        file.documentId = registered['id'] as String;
        await _upload(file, (registered['receivedBytes'] as num).toInt(), registered['state'] as String);
        await persist();
        if (file.state == 'rejected') throw const ApiException('A file changed or was damaged on the phone. Record or choose it again.', 422);
      }
      final submitted = await api.request('/pitches/${item.pitchId}/submit', body: {});
      item.submissionId = submitted['submissionId'] as String?;
      item.status = 'sent';
      item.lastError = null;
    } on ApiException catch (error) {
      if (error.status == 401) rethrow;
      item.status = 'failed';
      item.lastError = error.message;
    } on Exception {
      // Offline or timed out: stays queued and is retried on the next sync.
      item.status = 'queued';
      item.lastError = null;
    }
    await persist();
  }

  Future<void> _upload(OutboxFile file, int received, String state) async {
    file.state = state == 'receiving' ? 'pending' : state;
    if (state != 'receiving') return;
    final data = await _readFile(file.path);
    var offset = received;
    var stalled = 0;
    while (offset < data.length) {
      final end = offset + chunkBytes < data.length ? offset + chunkBytes : data.length;
      final result = await api.uploadChunk(file.documentId!, offset, data.sublist(offset, end));
      final serverState = result['state'] as String;
      final next = (result['receivedBytes'] as num).toInt();
      if (serverState != 'receiving') {
        file.state = serverState;
        return;
      }
      // One resend at the server's offset is normal after a crash; repeated no-progress is not.
      stalled = next == offset ? stalled + 1 : 0;
      if (stalled > 2) throw const ApiException('The upload is not progressing. Try again later.', 409);
      offset = next;
    }
  }
}
