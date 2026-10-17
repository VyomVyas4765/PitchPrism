import 'dart:io';

import 'package:file_picker/file_picker.dart';

import '../core/api.dart';
import 'device.dart';
import 'outbox.dart';

/// A file the person picked, before it is copied into app storage.
typedef PickedFile = ({String path, String name});

/// Device services for intake, passed explicitly so widget tests can fake them.
class IntakeServices {
  IntakeServices({
    required this.api,
    required this.store,
    required this.directory,
    required this.recorder,
    required this.pickFile,
  }) : sync = OutboxSync(api, store);
  final ApiClient api;
  final OutboxStore store;
  final OutboxSync sync;
  final Future<Directory> Function() directory;
  final Recorder Function() recorder;
  final Future<PickedFile?> Function() pickFile;

  /// The phone's real microphone, file picker and private storage for one account.
  factory IntakeServices.device(ApiClient api, String account) => IntakeServices(
    api: api,
    store: LazyOutboxStore(account),
    directory: intakeDirectory,
    recorder: DeviceRecorder.new,
    pickFile: () async {
      final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp']);
      final path = file?.path;
      return path == null ? null : (path: path, name: file!.name);
    },
  );

  Future<void> upsert(OutboxItem item) async {
    final items = await store.load();
    final index = items.indexWhere((existing) => existing.clientDraftId == item.clientDraftId);
    if (index < 0) {
      items.add(item);
    } else {
      items[index] = item;
    }
    await store.save(items);
  }
}

/// One outbox file per signed-in account, so a shared phone keeps each
/// facilitator's or entrepreneur's queue apart (M-18 per-applicant separation).
class LazyOutboxStore implements OutboxStore {
  LazyOutboxStore(this.account);
  final String account;
  late final Future<FileOutboxStore> _inner = intakeDirectory().then((dir) => FileOutboxStore(dir, account));
  @override
  Future<List<OutboxItem>> load() async => (await _inner).load();
  @override
  Future<void> save(List<OutboxItem> items) async => (await _inner).save(items);
}

/// The document kind and MIME type the server accepts, from a picked file's extension.
({String kind, String mime})? classifyPicked(String name) => switch (name.toLowerCase().split('.').last) {
  'pdf' => (kind: 'pdf', mime: 'application/pdf'),
  'jpg' || 'jpeg' => (kind: 'image', mime: 'image/jpeg'),
  'png' => (kind: 'image', mime: 'image/png'),
  'webp' => (kind: 'image', mime: 'image/webp'),
  _ => null,
};
